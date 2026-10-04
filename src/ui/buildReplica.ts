/**
 * The "Build" button's orchestration: wires together already-tested
 * units (model resolution, texture decoding, voxel grid, material
 * list, schematic writing) into one pipeline. Deliberately thin — the
 * logic worth testing in isolation already has its own unit tests in
 * the modules this calls; what's left here is sequencing, which the
 * manual verification step in PLAN.md exercises end-to-end instead of
 * an automated test (replicating the injected-decoder trick from
 * `palette.ts` here would only be re-testing that same sequencing).
 */

import { texturePath, type MinecraftArchive } from "../assets/archiveReader.ts";
import {
  hasAxisVariants,
  resolveAxisVariantCubeModel,
  resolveCanonicalVariantCubeModel,
  type AxisOrientation,
} from "../assets/modelResolver.ts";
import { decodePngTexture, readPngWidth, type DecodedTexture } from "../assets/textureDecoder.ts";
import { CUBE_FACE_DIRECTIONS, type CubeFaceDirection } from "../domain/faces.ts";
import { consolidateVoxels } from "../domain/consolidate.ts";
import { buildMaterialList, type MaterialListEntry } from "../domain/materials.ts";
import type { PaletteBlock } from "../domain/palette.ts";
import type { ContrastHeadroom } from "../domain/contrast.ts";
import { assessReplicaContrastHeadroom, buildVoxelGrid, type DitherOptions, type FillStyle, type Voxel } from "../domain/shell.ts";
import { schematicFileName, writeSchematicBytes } from "../litematic/writeSchematic.ts";

export interface BuildReplicaParams {
  readonly archive: MinecraftArchive;
  readonly sourceBlockId: string;
  /** `null` for an ordinary single-variant source block; set for an axis-pillar block (see `assets/modelResolver.ts`'s `hasAxisVariants`), which has no single default appearance to resolve without one. */
  readonly sourceBlockOrientation: AxisOrientation | null;
  readonly edgeBlocks: number;
  readonly fillStyle: FillStyle;
  /** Candidate replacement blocks — see `domain/palette.ts`. Must include at least one entry. */
  readonly palette: readonly PaletteBlock[];
  /** Forwarded to `buildVoxelGrid` — see its doc comment. Optional; `buildVoxelGrid` supplies its own default when omitted. */
  readonly varianceWeight?: number;
  /** Forwarded to `buildVoxelGrid` — see its doc comment. Omitted entirely disables dithering. */
  readonly dither?: DitherOptions;
  /** Caps the number of distinct block types in the finished build — see `domain/consolidate.ts`'s `consolidateVoxels`. Omitted entirely disables the cap (every voxel keeps whatever block the matcher originally picked). */
  readonly maxDistinctBlocks?: number;
}

export interface BuildReplicaResult {
  readonly voxels: readonly Voxel[];
  readonly materialList: readonly MaterialListEntry[];
  readonly schematicBytes: Uint8Array;
  readonly fileName: string;
  /** The source block's own decoded faces — what the preview UI compares the replica against. */
  readonly sourceFaceTextures: Readonly<Record<CubeFaceDirection, DecodedTexture>>;
  /** One representative decoded texture per DISTINCT block id actually used as fill (keyed by `blockId`, matching `materialList`'s own entries) — lets the preview UI render each voxel's real texture instead of its flat averaged color. Missing an entry only if that block's texture became unresolvable or unreadable between the palette build and this build, which `voxels`/`materialList` having already resolved it moments earlier makes exceedingly unlikely, not impossible. */
  readonly usedBlockTextures: ReadonlyMap<string, DecodedTexture>;
  /** Which block was auto-picked for the invisible interior — see {@link pickInteriorFillBlock} — or `null` when `fillStyle` wasn't `"solid-cheap-core"`. Surfaced purely so the UI can tell the user what it chose; `materialList`'s own count for this block already reflects the choice either way. */
  readonly interiorFillBlockId: string | null;
  /** How much `maxDistinctBlocks` simplified this build — `null` when no cap was requested, or the build was already at or under it (a genuine no-op, not worth mentioning). See `domain/consolidate.ts`. */
  readonly consolidation: ConsolidationSummary | null;
  /** Whether the source block's own contrast outstrips what the enabled palette can reach, even after `buildVoxelGrid`'s automatic per-face stretch — see `domain/contrast.ts`. Always present (every build has some answer to this), unlike `consolidation`: the UI decides whether `isPaletteLimited` is worth surfacing. */
  readonly contrastHeadroom: ContrastHeadroom;
}

/** The parts of `domain/consolidate.ts`'s `ConsolidationResult` worth showing the user — its `voxels` are already this result's own top-level `voxels`, so repeating them here would just be a second, stale copy. */
export interface ConsolidationSummary {
  readonly originalBlockCount: number;
  readonly consolidatedBlockCount: number;
  readonly averageColorErrorIntroduced: number;
}

/**
 * Picks which block fills every invisible interior voxel of a
 * `"solid-cheap-core"` build: the cheapest candidate in `palette` (see
 * `domain/palette.ts`'s `acquisitionCostOf`), tie-broken by the flattest
 * texture, tie-broken by block id for full determinism. Texture
 * busyness has no real effect on a block nobody will ever see — it only
 * exists to make an otherwise-arbitrary final tie-break reproducible
 * rather than dependent on archive iteration order.
 *
 * Inputs: `palette`, the fill candidate pool — must be non-empty (same
 * precondition `buildVoxelGrid` itself already has).
 * Output: the chosen block.
 */
export function pickInteriorFillBlock(palette: readonly PaletteBlock[]): PaletteBlock {
  let best = palette[0]!;
  for (const candidate of palette) {
    const isCheaper = candidate.acquisitionCost < best.acquisitionCost;
    const isTiedOnCostButFlatter =
      candidate.acquisitionCost === best.acquisitionCost && candidate.textureVariance < best.textureVariance;
    const isTiedOnCostAndVarianceButEarlierId =
      candidate.acquisitionCost === best.acquisitionCost &&
      candidate.textureVariance === best.textureVariance &&
      candidate.blockId.localeCompare(best.blockId) < 0;
    if (isCheaper || isTiedOnCostButFlatter || isTiedOnCostAndVarianceButEarlierId) {
      best = candidate;
    }
  }
  return best;
}

/**
 * One representative decoded texture for `blockId`, re-resolving its
 * model the same way `palette.ts` originally did (canonical variant
 * first, axis-pillar "upright" as a fallback) — a `PaletteBlock` itself
 * only carries a precomputed averaged `color`, not a texture reference,
 * so getting an actual texture back for the preview means resolving it
 * again here, same as `buildReplica` already does for the source block.
 * Picks the "up" face as the one representative texture; a block with
 * several distinct face textures (e.g. a `cube_bottom_top` shape) is
 * still shown as ONE tile in the preview, which is a simplification
 * worth making for a single small preview swatch rather than rendering
 * per-voxel-face accuracy that would be lost at that size anyway.
 *
 * Output: the decoded texture, or `undefined` if `blockId` no longer
 * resolves or its texture can't be read — the preview simply falls back
 * to that voxel's flat averaged color in that case (see
 * `ui/PreviewCanvas.tsx`), same as every voxel did before this existed.
 */
async function resolveRepresentativeTexture(
  archive: MinecraftArchive,
  blockId: string,
  decodedByTextureId: Map<string, DecodedTexture>,
): Promise<DecodedTexture | undefined> {
  const model =
    resolveCanonicalVariantCubeModel(archive, blockId)?.model ??
    (hasAxisVariants(archive, blockId) ? resolveAxisVariantCubeModel(archive, blockId, "upright") : undefined);
  if (model === undefined) return undefined;

  const textureId = model.faceTextureIds.up;
  let decoded = decodedByTextureId.get(textureId);
  if (decoded === undefined) {
    const bytes = archive.getFile(texturePath(textureId));
    if (bytes === undefined) return undefined;
    decoded = await decodePngTexture(bytes);
    decodedByTextureId.set(textureId, decoded);
  }
  return decoded;
}

/**
 * The source block's own texture resolution in pixels per side — e.g.
 * `16` for vanilla, `32` or more for a HD resource pack. `scale.ts`'s
 * size picker defaults to vanilla's 16px when this isn't known yet
 * (before a block is selected), but using the REAL resolution once one
 * is matters: on a non-16px resource pack, classifying sizes against
 * the wrong resolution would offer a size as "exact" that actually
 * skips or repeats source pixels non-uniformly (see `domain/scale.ts`'s
 * `classifyScale`).
 *
 * Deliberately synchronous — unlike {@link buildReplica}'s full texture
 * decode, `readPngWidth` only reads a few header bytes, so the size
 * picker can reflect the real resolution immediately after a block is
 * chosen, without waiting on a canvas-based async decode.
 *
 * Output: the resolution, or `undefined` if the source block/orientation
 * doesn't resolve to a usable model, its texture is missing from the
 * archive, or that texture's bytes aren't a readable PNG — every one of
 * which `buildReplica` itself will also surface, more specifically, if
 * the user goes on to actually build.
 */
export function resolveSourceTexturePixelsPerSide(
  archive: MinecraftArchive,
  sourceBlockId: string,
  sourceBlockOrientation: AxisOrientation | null,
): number | undefined {
  const model =
    sourceBlockOrientation === null
      ? resolveCanonicalVariantCubeModel(archive, sourceBlockId)?.model
      : resolveAxisVariantCubeModel(archive, sourceBlockId, sourceBlockOrientation);
  if (model === undefined) return undefined;

  // Any one face is representative: this app already requires every
  // face of a usable source block to be square (buildVoxelGrid's own
  // invariant check), and in practice a block's distinct face textures
  // always share one resolution.
  const textureId = model.faceTextureIds.up;
  const bytes = archive.getFile(texturePath(textureId));
  if (bytes === undefined) return undefined;

  try {
    return readPngWidth(bytes);
  } catch {
    return undefined;
  }
}

/**
 * Failure modes: throws `Error` if `sourceBlockId` does not resolve to
 * a usable full-cube model, or if the archive is missing a texture its
 * own model references (a malformed archive, not an expected outcome
 * at this point — unlike in `palette.ts`, `sourceBlockId` is expected to
 * have already come from a `buildPalette` result, which only lists
 * blocks that passed this exact check once already).
 */
export async function buildReplica(params: BuildReplicaParams): Promise<BuildReplicaResult> {
  const {
    archive,
    sourceBlockId,
    sourceBlockOrientation,
    edgeBlocks,
    fillStyle,
    palette,
    varianceWeight,
    dither,
    maxDistinctBlocks,
  } = params;

  const model =
    sourceBlockOrientation === null
      ? resolveCanonicalVariantCubeModel(archive, sourceBlockId)?.model
      : resolveAxisVariantCubeModel(archive, sourceBlockId, sourceBlockOrientation);
  if (model === undefined) {
    throw new Error(`'${sourceBlockId}' is not a usable source block in the requested orientation`);
  }

  const decodedByTextureId = new Map<string, DecodedTexture>();
  const sourceFaceTextures = {} as Record<CubeFaceDirection, DecodedTexture>;
  for (const direction of CUBE_FACE_DIRECTIONS) {
    const textureId = model.faceTextureIds[direction];
    let decoded = decodedByTextureId.get(textureId);
    if (decoded === undefined) {
      const bytes = archive.getFile(texturePath(textureId));
      if (bytes === undefined) {
        throw new Error(`texture '${textureId}' referenced by '${sourceBlockId}' is missing from the archive`);
      }
      decoded = await decodePngTexture(bytes);
      decodedByTextureId.set(textureId, decoded);
    }
    sourceFaceTextures[direction] = decoded;
  }

  const interiorFillBlock = fillStyle === "solid-cheap-core" ? pickInteriorFillBlock(palette) : undefined;

  const rawVoxels = buildVoxelGrid({
    edgeBlocks,
    fillStyle,
    sourceFaceTextures,
    palette,
    ...(varianceWeight !== undefined && { varianceWeight }),
    ...(dither !== undefined && { dither }),
    ...(interiorFillBlock !== undefined && { interiorFillBlock }),
  });

  let voxels: readonly Voxel[] = rawVoxels;
  let consolidation: ConsolidationSummary | null = null;
  if (maxDistinctBlocks !== undefined) {
    const result = consolidateVoxels(rawVoxels, maxDistinctBlocks);
    voxels = result.voxels;
    if (result.consolidatedBlockCount < result.originalBlockCount) {
      consolidation = {
        originalBlockCount: result.originalBlockCount,
        consolidatedBlockCount: result.consolidatedBlockCount,
        averageColorErrorIntroduced: result.averageColorErrorIntroduced,
      };
    }
  }

  const materialList = buildMaterialList(voxels);
  const schematicBytes = writeSchematicBytes({ sourceBlockId, edgeBlocks, fillStyle, voxels });
  const fileName = schematicFileName(sourceBlockId, edgeBlocks);

  const usedBlockTextures = new Map<string, DecodedTexture>();
  for (const entry of materialList) {
    const texture = await resolveRepresentativeTexture(archive, entry.blockId, decodedByTextureId);
    if (texture !== undefined) usedBlockTextures.set(entry.blockId, texture);
  }

  return {
    voxels,
    materialList,
    schematicBytes,
    fileName,
    sourceFaceTextures,
    usedBlockTextures,
    interiorFillBlockId: interiorFillBlock?.blockId ?? null,
    consolidation,
    contrastHeadroom: assessReplicaContrastHeadroom(sourceFaceTextures, palette),
  };
}
