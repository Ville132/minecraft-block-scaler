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
import { resolveSingleVariantCubeModel } from "../assets/modelResolver.ts";
import { decodePngTexture, type DecodedTexture } from "../assets/textureDecoder.ts";
import { CUBE_FACE_DIRECTIONS, type CubeFaceDirection } from "../domain/faces.ts";
import { buildMaterialList, type MaterialListEntry } from "../domain/materials.ts";
import type { PaletteBlock } from "../domain/palette.ts";
import { buildVoxelGrid, type FillStyle, type Voxel } from "../domain/shell.ts";
import { schematicFileName, writeSchematicBytes } from "../litematic/writeSchematic.ts";

export interface BuildReplicaParams {
  readonly archive: MinecraftArchive;
  readonly sourceBlockId: string;
  readonly edgeBlocks: number;
  readonly fillStyle: FillStyle;
  /** Candidate replacement blocks — see `domain/palette.ts`. Must include at least one entry. */
  readonly palette: readonly PaletteBlock[];
}

export interface BuildReplicaResult {
  readonly voxels: readonly Voxel[];
  readonly materialList: readonly MaterialListEntry[];
  readonly schematicBytes: Uint8Array;
  readonly fileName: string;
  /** The source block's own decoded faces — what the preview UI compares the replica against. */
  readonly sourceFaceTextures: Readonly<Record<CubeFaceDirection, DecodedTexture>>;
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
  const { archive, sourceBlockId, edgeBlocks, fillStyle, palette } = params;

  const model = resolveSingleVariantCubeModel(archive, sourceBlockId);
  if (model === undefined) {
    throw new Error(`'${sourceBlockId}' is not a usable source block (not a resolvable single-variant full cube)`);
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

  const voxels = buildVoxelGrid({ edgeBlocks, fillStyle, sourceFaceTextures, palette });
  const materialList = buildMaterialList(voxels);
  const schematicBytes = writeSchematicBytes({ sourceBlockId, edgeBlocks, fillStyle, voxels });
  const fileName = schematicFileName(sourceBlockId, edgeBlocks);

  return { voxels, materialList, schematicBytes, fileName, sourceFaceTextures };
}
