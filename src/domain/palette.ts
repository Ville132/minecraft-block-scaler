/**
 * Builds the set of blocks a replica is allowed to be built from: every
 * block in the user's archive that is both a resolvable full cube (see
 * `assets/modelResolver.ts`) and not excluded for being unbuildable,
 * unstable, or (optionally) expensive — paired with its representative
 * color for nearest-match lookups via `color.ts`.
 */

import { listBlockIds, texturePath, textureMetaPath, type MinecraftArchive } from "../assets/archiveReader.ts";
import {
  hasAxisVariants,
  resolveAxisVariantCubeModel,
  resolveSingleVariantCubeModel,
  type ResolvedCubeModel,
} from "../assets/modelResolver.ts";
import { requiresScarceIngredient } from "../assets/recipes.ts";
import { decodePngTexture, type DecodedTexture } from "../assets/textureDecoder.ts";
import { averageLinearRgb, linearRgbToOklab, rgb8ToLinearRgb, type LinearRgb, type Oklab } from "./color.ts";

export type CostTier = "common" | "precious";

export interface PaletteBlock {
  readonly blockId: string;
  /** The fully-namespaced id to write into the schematic's block-state palette, e.g. `"minecraft:cobblestone"`. */
  readonly resourceLocation: string;
  readonly color: Oklab;
  readonly costTier: CostTier;
}

export interface PaletteOptions {
  /** Drops "precious" cost-tier blocks (netherite/diamond/gold/emerald/iron/lapis) when true. Default true. */
  readonly survivalFriendlyOnly: boolean;
  /** Allows sand/gravel/etc, which fall when unsupported, when true. Default false. */
  readonly allowGravityBlocks: boolean;
  /** Allows grass/leaves/etc, whose real color depends on biome tint we cannot sample, when true. Default false. */
  readonly allowBiomeTintedBlocks: boolean;
}

export const DEFAULT_PALETTE_OPTIONS: PaletteOptions = {
  survivalFriendlyOnly: true,
  allowGravityBlocks: false,
  allowBiomeTintedBlocks: false,
};

/**
 * Creative-only, unobtainable, or otherwise unbuildable-with blocks.
 * Excluded unconditionally — there is no toggle to re-enable these,
 * unlike the gravity/biome-tint exclusions below.
 */
const UNBUILDABLE_BLOCK_IDS: ReadonlySet<string> = new Set([
  // Not obtainable in survival:
  "barrier",
  "bedrock",
  "command_block",
  "chain_command_block",
  "repeating_command_block",
  "spawner",
  "light",
  "jigsaw",
  "structure_block",
  "structure_void",
  "trial_spawner",
  "vault",
  // Visually identical to their host block, but spawn silverfish when broken:
  "infested_stone",
  "infested_cobblestone",
  "infested_stone_bricks",
  "infested_mossy_stone_bricks",
  "infested_cracked_stone_bricks",
  "infested_chiseled_stone_bricks",
  // Interactive — would not behave like a static decorative block:
  "observer",
  "piston",
  "sticky_piston",
  "note_block",
  "target",
  "tnt",
  // Hazardous to stand near or walk on at the scale this app builds:
  "magma_block",
  // Alter player movement, breaking the shape of a static sculpture:
  "slime_block",
  "honey_block",
]);

/** Fall when unsupported — unsuitable for a free-floating or overhanging replica. Gated by `allowGravityBlocks`. */
const GRAVITY_BLOCK_IDS: ReadonlySet<string> = new Set([
  "sand",
  "red_sand",
  "gravel",
  "suspicious_sand",
  "suspicious_gravel",
]);

/** Real in-game color depends on the surrounding biome's tint, which a resource-pack texture alone cannot tell us. Gated by `allowBiomeTintedBlocks`. */
const BIOME_TINTED_BLOCK_IDS: ReadonlySet<string> = new Set([
  "grass_block",
  "oak_leaves",
  "spruce_leaves",
  "birch_leaves",
  "jungle_leaves",
  "acacia_leaves",
  "dark_oak_leaves",
  "mangrove_leaves",
  "cherry_leaves",
  "azalea_leaves",
  "flowering_azalea_leaves",
]);

/**
 * Full cubes whose defining material is itself a precious resource — a
 * replica can need tens of thousands of blocks, and burning through
 * that many ingots/gems is exactly what "survival-friendly" guards
 * against. Deliberately narrower than "anything valuable": common,
 * farmable, or stack-cheap full cubes (copper, amethyst, quartz,
 * redstone, coal) are left as "common".
 */
const PRECIOUS_MATERIAL_BLOCK_IDS: ReadonlySet<string> = new Set([
  "netherite_block",
  "diamond_block",
  "gold_block",
  "raw_gold_block",
  "emerald_block",
  "iron_block",
  "raw_iron_block",
  "lapis_block",
]);

export function isUnbuildableBlock(blockId: string): boolean {
  return UNBUILDABLE_BLOCK_IDS.has(blockId);
}

export function isGravityBlock(blockId: string): boolean {
  return GRAVITY_BLOCK_IDS.has(blockId);
}

export function isBiomeTintedBlock(blockId: string): boolean {
  return BIOME_TINTED_BLOCK_IDS.has(blockId);
}

export function costTierOf(blockId: string): CostTier {
  return PRECIOUS_MATERIAL_BLOCK_IDS.has(blockId) ? "precious" : "common";
}

/**
 * The exclusion-category checks shared by {@link buildPalette} and
 * {@link listAxisVariantBlocks} — unbuildable is absolute, the rest
 * are gated by `options`.
 *
 * Two independent checks gate on `survivalFriendlyOnly`: `costTierOf`
 * catches a block that IS a precious material (`gold_block`), and
 * `requiresScarceIngredient` catches one that is merely CRAFTED FROM
 * one despite not being named after it (`jukebox`, from a diamond) —
 * a block's own id can't tell you that, only its recipe can.
 */
function passesExclusionFilters(archive: MinecraftArchive, blockId: string, options: PaletteOptions): boolean {
  if (isUnbuildableBlock(blockId)) return false;
  if (!options.allowGravityBlocks && isGravityBlock(blockId)) return false;
  if (!options.allowBiomeTintedBlocks && isBiomeTintedBlock(blockId)) return false;
  if (options.survivalFriendlyOnly && costTierOf(blockId) === "precious") return false;
  if (options.survivalFriendlyOnly && requiresScarceIngredient(archive, blockId)) return false;
  return true;
}

/** Injected so tests can supply a deterministic fake instead of a real PNG decoder (see `textureDecoder.ts`'s header comment for why that decoder itself has no automated test). */
export type TextureDecoder = (pngBytes: Uint8Array) => Promise<DecodedTexture>;

/**
 * The linear-light average color of one texture, or `undefined` if the
 * texture is disqualified: animated (an `.mcmeta` file sits beside it,
 * or its decoded pixels are not square — a strong sign of a stacked
 * animation filmstrip) or not fully opaque everywhere. Either case
 * disqualifies the WHOLE texture rather than averaging just the
 * remaining pixels, since a partial, unrepresentative average would be
 * a worse match than simply not offering the block at all.
 */
async function opaqueTextureAverage(
  archive: MinecraftArchive,
  textureId: string,
  decodeTexture: TextureDecoder,
): Promise<LinearRgb | undefined> {
  if (archive.getFile(textureMetaPath(textureId)) !== undefined) return undefined;

  const bytes = archive.getFile(texturePath(textureId));
  if (bytes === undefined) return undefined;

  const decoded = await decodeTexture(bytes);
  if (decoded.width !== decoded.height) return undefined;

  const samples: LinearRgb[] = [];
  for (let pixelStart = 0; pixelStart < decoded.pixels.length; pixelStart += 4) {
    const alpha = decoded.pixels[pixelStart + 3]!;
    if (alpha !== 255) return undefined;
    samples.push(
      rgb8ToLinearRgb({
        r: decoded.pixels[pixelStart]!,
        g: decoded.pixels[pixelStart + 1]!,
        b: decoded.pixels[pixelStart + 2]!,
      }),
    );
  }
  return averageLinearRgb(samples);
}

/**
 * A block's representative color: the linear-light average across each
 * of its DISTINCT face textures (deduplicated by texture id, each
 * counted once regardless of how many of the 6 faces use it). For the
 * common case — a `cube_all`-style block where all six faces share one
 * texture — this is exactly that texture's own average. Blocks whose
 * faces use several different textures (e.g. a distinct top texture)
 * get an equal-weight average across those distinct textures rather
 * than one weighted by face count; no candidate block this app ships
 * exclusion rules for actually has that shape, so the simplification is
 * untested in practice but documented here in case a resource pack
 * introduces one.
 */
async function representativeColor(
  archive: MinecraftArchive,
  model: ResolvedCubeModel,
  decodeTexture: TextureDecoder,
): Promise<Oklab | undefined> {
  const distinctTextureIds = new Set(Object.values(model.faceTextureIds));
  const perTextureAverages: LinearRgb[] = [];
  for (const textureId of distinctTextureIds) {
    const average = await opaqueTextureAverage(archive, textureId, decodeTexture);
    if (average === undefined) return undefined;
    perTextureAverages.push(average);
  }
  return linearRgbToOklab(averageLinearRgb(perTextureAverages));
}

/**
 * Builds the full candidate palette from an archive.
 *
 * Inputs: `archive`, the user's parsed jar/resource pack;
 * `options`, which optional exclusion categories to relax;
 * `decodeTexture`, the PNG decoder (defaults to the real browser-based
 * one; tests inject a fake).
 * Output: one entry per eligible block, each with its representative
 * color already resolved — ready for `color.ts`'s `findNearestOklab`.
 * Blocks that fail any eligibility check are silently omitted (this is
 * the expected, common case for most of the game's blocks, not a
 * failure); nothing here throws except through a genuinely broken
 * archive, which `archiveReader.ts` already throws on while unzipping.
 */
export async function buildPalette(
  archive: MinecraftArchive,
  options: PaletteOptions = DEFAULT_PALETTE_OPTIONS,
  decodeTexture: TextureDecoder = decodePngTexture,
): Promise<PaletteBlock[]> {
  const paletteBlocks: PaletteBlock[] = [];

  for (const blockId of listBlockIds(archive)) {
    if (!passesExclusionFilters(archive, blockId, options)) continue;

    const model = resolveSingleVariantCubeModel(archive, blockId);
    if (model === undefined) continue;

    const color = await representativeColor(archive, model, decodeTexture);
    if (color === undefined) continue;

    paletteBlocks.push({ blockId, resourceLocation: `minecraft:${blockId}`, color, costTier: costTierOf(blockId) });
  }

  return paletteBlocks;
}

/**
 * Lists axis-pillar blocks (logs, wood, basalt, quartz/purpur pillars,
 * etc. — see `assets/modelResolver.ts`'s `hasAxisVariants`) the user
 * can pick as a scale *source*, each resolved in its `"upright"`
 * orientation for the picker's color swatch. A separate list from
 * {@link buildPalette} rather than merged into it: fill material never
 * needs an orientation choice, so keeping that palette exactly as
 * single-variant-only avoids giving every other part of the app a
 * concept it has no use for. The same exclusion rules still apply —
 * an axis-pillar block makes no exception for being precious,
 * gravity-affected, or biome-tinted.
 */
export async function listAxisVariantBlocks(
  archive: MinecraftArchive,
  options: PaletteOptions = DEFAULT_PALETTE_OPTIONS,
  decodeTexture: TextureDecoder = decodePngTexture,
): Promise<PaletteBlock[]> {
  const blocks: PaletteBlock[] = [];

  for (const blockId of listBlockIds(archive)) {
    if (!passesExclusionFilters(archive, blockId, options)) continue;
    if (!hasAxisVariants(archive, blockId)) continue;

    const model = resolveAxisVariantCubeModel(archive, blockId, "upright");
    if (model === undefined) continue;

    const color = await representativeColor(archive, model, decodeTexture);
    if (color === undefined) continue;

    blocks.push({ blockId, resourceLocation: `minecraft:${blockId}`, color, costTier: costTierOf(blockId) });
  }

  return blocks;
}
