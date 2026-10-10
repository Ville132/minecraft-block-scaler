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
  resolveCanonicalVariantCubeModel,
  type ResolvedCubeModel,
} from "../assets/modelResolver.ts";
import { requiresScarceIngredient } from "../assets/recipes.ts";
import { decodePngTexture, type DecodedTexture } from "../assets/textureDecoder.ts";
import { applyBiomeTint, biomeTintFor } from "./biomeTint.ts";
import {
  averageOklab,
  linearRgbToOklab,
  oklabDistanceSquared,
  rgb8ToLinearRgb,
  type Oklab,
  type Rgb8,
} from "./color.ts";
import { CUBE_FACE_DIRECTIONS, type CubeFaceDirection } from "./faces.ts";

export type CostTier = "common" | "precious";

export interface PaletteBlock {
  readonly blockId: string;
  /** The fully-namespaced id to write into the schematic's block-state palette, e.g. `"minecraft:cobblestone"`. */
  readonly resourceLocation: string;
  readonly color: Oklab;
  /** Mean squared Oklab distance of this block's own texture pixels from `color` — how visually "busy" the texture is, 0 for a perfectly flat one. See `color.ts`'s `findBestMatch`, which penalizes a noisy block by this amount when picking fill material. */
  readonly textureVariance: number;
  /**
   * What each face shows on its own — see {@link BlockAppearance.byFace}.
   *
   * `color`/`textureVariance` above remain the whole-block summary, used
   * where a block needs one representative colour (the picker swatch, the
   * material-limit pass). Colour MATCHING uses this instead, because a
   * replica's surface is made of faces, not of block averages.
   */
  readonly appearanceByFace: Readonly<Record<CubeFaceDirection, FaceAppearance>>;
  readonly costTier: CostTier;
  /** See `color.ts`'s `ScoredCandidate.acquisitionCost` and `acquisitionCostOf` in this module. */
  readonly acquisitionCost: number;
  /** The blockstate properties of the specific variant this block's appearance/geometry was resolved from (see `assets/modelResolver.ts`'s `resolveCanonicalVariantCubeModel`) — e.g. `{ facing: "north" }` for a glazed terracotta. Omitted entirely for a single-variant block or an axis-pillar block (the latter relies on a schematic's own default of `axis=y` — see `litematic/writeSchematic.ts`), both of which need no `Properties` tag written at all. */
  readonly properties?: Readonly<Record<string, string>>;
}

export interface PaletteOptions {
  /** Drops "precious" cost-tier blocks (netherite/diamond/gold/emerald/iron/lapis) when true. Default true. */
  readonly survivalFriendlyOnly: boolean;
  /** Allows sand/gravel/etc, which fall when unsupported, when true. Default false. */
  readonly allowGravityBlocks: boolean;
  /** Allows grass/leaves/etc, whose colour the game mixes from the surrounding biome rather than the texture file. Default true: `domain/biomeTint.ts` now applies the temperate tint, so they match what gets built instead of coming out grey. Turn it off to build somewhere the tint would be noticeably different. */
  readonly allowBiomeTintedBlocks: boolean;
}

export const DEFAULT_PALETTE_OPTIONS: PaletteOptions = {
  survivalFriendlyOnly: true,
  allowGravityBlocks: false,
  allowBiomeTintedBlocks: true,
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
  "budding_amethyst", // never drops even with silk touch, and grows a cluster out of every exposed face
  "reinforced_deepslate", // creative/structure-only, no obtain method at all
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
  // Hazardous to stand near, stand on, or walk through at the scale this app builds:
  "magma_block",
  "powder_snow", // entities sink in and can freeze to death inside it
  "respawn_anchor", // explodes if charged and activated outside the Nether
  "sculk_catalyst", // silk-touch only to obtain; spreads sculk to nearby blocks when a mob dies near it
  // Alter player movement, breaking the shape of a static sculpture:
  "slime_block",
  "honey_block",
  "packed_ice",
  "blue_ice",
  "soul_sand",
  "mud",
  // Appearance does not stay the look it had when picked — a poor choice
  // for a build meant to stay looking like the source block:
  "tube_coral_block",
  "brain_coral_block",
  "bubble_coral_block",
  "fire_coral_block",
  "horn_coral_block", // all five lose their color within seconds once out of water
  "copper_block",
  "exposed_copper",
  "weathered_copper",
  "oxidized_copper",
  "cut_copper",
  "exposed_cut_copper",
  "weathered_cut_copper",
  "oxidized_cut_copper", // oxidizes over real time unless waxed; the waxed_* equivalents are pixel-identical and stable, and remain available
]);

/** Fall when unsupported — unsuitable for a free-floating or overhanging replica. Gated by `allowGravityBlocks`. */
const GRAVITY_BLOCK_IDS: ReadonlySet<string> = new Set([
  "sand",
  "red_sand",
  "gravel",
  "suspicious_sand",
  "suspicious_gravel",
  "white_concrete_powder",
  "orange_concrete_powder",
  "magenta_concrete_powder",
  "light_blue_concrete_powder",
  "yellow_concrete_powder",
  "lime_concrete_powder",
  "pink_concrete_powder",
  "gray_concrete_powder",
  "light_gray_concrete_powder",
  "cyan_concrete_powder",
  "purple_concrete_powder",
  "blue_concrete_powder",
  "brown_concrete_powder",
  "green_concrete_powder",
  "red_concrete_powder",
  "black_concrete_powder",
]);

/** The game mixes these blocks' colour from the surrounding biome rather than taking it from the texture file, which is stored greyscale. `domain/biomeTint.ts` supplies the temperate tint so they match, and `allowBiomeTintedBlocks` exists for a build whose biome would differ noticeably.
 *
 * NOTE: spruce, birch, and cherry leaves/foliage are deliberately NOT
 * listed — Mojang special-cased all three to a fixed color specifically
 * so they read the same regardless of biome (most notably cherry, to
 * keep its blossom pink consistent). Everything still listed here
 * (grass, oak/jungle/acacia/dark-oak/mangrove/azalea leaves) genuinely
 * does take the surrounding biome's tint. Leaf textures are also
 * typically semi-transparent in vanilla, so `opaqueTextureAverage`'s
 * alpha check already excludes most of them regardless of this list —
 * it only matters for a resource pack that overrides a leaf texture to
 * be fully opaque. */
const BIOME_TINTED_BLOCK_IDS: ReadonlySet<string> = new Set([
  "grass_block",
  "oak_leaves",
  "jungle_leaves",
  "acacia_leaves",
  "dark_oak_leaves",
  "mangrove_leaves",
  "azalea_leaves",
  "flowering_azalea_leaves",
]);

/**
 * Catches fire from a nearby flame and burns away — wool is this
 * palette's main source of saturated matte color, so this matters for
 * anything built near lava, fire, or lightning. Non-wood only: every
 * wood-family block (logs/wood/planks/stems/hyphae) is also flammable
 * and is already covered by {@link isWoodFamilyBlock} — see
 * {@link isFlammableBlock}.
 *
 * Deliberately NOT wired into {@link passesExclusionFilters} the way
 * gravity/biome-tint are: axis-pillar blocks (logs) are overwhelmingly
 * wood, so a default-excluded, archive-wide flammability filter would
 * also remove every log from the SOURCE-block picker — the exact
 * scenario this app was built around. `ui/App.tsx` instead applies
 * {@link isFlammableBlock} as a fill-material-only filter, the same way
 * it already does for `onlyWoodFillMaterial`, which never touches
 * source-block eligibility either.
 */
const FLAMMABLE_BLOCK_IDS: ReadonlySet<string> = new Set([
  "white_wool",
  "orange_wool",
  "magenta_wool",
  "light_blue_wool",
  "yellow_wool",
  "lime_wool",
  "pink_wool",
  "gray_wool",
  "light_gray_wool",
  "cyan_wool",
  "purple_wool",
  "blue_wool",
  "brown_wool",
  "green_wool",
  "red_wool",
  "black_wool",
  "hay_block",
  "bookshelf",
  "chiseled_bookshelf",
  "dried_kelp_block",
]);

/** Always rendered at this block's own fixed light level regardless of which face a replica voxel sits on, so the texture's raw pixel color reads noticeably darker than the block actually looks in-game. Used to lift `representativeAppearance`'s resolved lightness for these specific blocks — see {@link buildPalette}. */
const EMISSIVE_BLOCK_IDS: ReadonlySet<string> = new Set([
  "glowstone",
  "sea_lantern",
  "shroomlight",
  "ochre_froglight",
  "verdant_froglight",
  "pearlescent_froglight",
]);
/** How much to lift an emissive block's resolved Oklab lightness — modest and clamped to 1 rather than tuned to match any specific light level, since the point is "reads brighter than its texture," not an exact photometric match. */
const EMISSIVE_LIGHTNESS_BOOST = 0.15;

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

/** Wood blocks that don't follow the `*_log`/`*_wood`/`*_planks`/`*_stem`/`*_hyphae` naming pattern {@link isWoodFamilyBlock} otherwise matches. */
const EXTRA_WOOD_FAMILY_BLOCK_IDS: ReadonlySet<string> = new Set([
  "bamboo_block",
  "stripped_bamboo_block",
  "bamboo_planks",
  "bamboo_mosaic",
]);

/**
 * Whether a block belongs to some wood species' family: logs, "wood"
 * (the all-bark variant), planks, nether stems/hyphae, any `stripped_`
 * version of those, plus the handful of bamboo blocks that don't fit
 * that naming pattern.
 *
 * Deliberately pattern-based rather than a hardcoded species list —
 * "oak, spruce, birch, mangrove, ..." written from general knowledge
 * would silently miss any species this app doesn't already know the
 * name of, and Java 26.3 itself added one (poplar) that such a list
 * wouldn't include. Matching the suffix every wood-family block
 * actually uses means a new species just works, with nothing to update.
 */
/** The one block the wood-family suffix pattern below matches by mistake: `mushroom_stem` ends in `_stem` but is stone-textured fungus flesh, not wood — nothing to do with the nether `crimson_stem`/`warped_stem` logs the pattern exists to catch. Checked before the pattern so the general, species-agnostic approach ({@link isWoodFamilyBlock}'s own doc comment) can stay general. */
const NON_WOOD_BLOCK_IDS_MATCHING_WOOD_PATTERN: ReadonlySet<string> = new Set(["mushroom_stem"]);

export function isWoodFamilyBlock(blockId: string): boolean {
  if (NON_WOOD_BLOCK_IDS_MATCHING_WOOD_PATTERN.has(blockId)) return false;
  if (EXTRA_WOOD_FAMILY_BLOCK_IDS.has(blockId)) return true;
  return /^(stripped_)?[a-z]+(_[a-z]+)*_(log|wood|planks|stem|hyphae)$/.test(blockId);
}

export function isFlammableBlock(blockId: string): boolean {
  return isWoodFamilyBlock(blockId) || FLAMMABLE_BLOCK_IDS.has(blockId);
}

/**
 * Full cubes that are "common" cost tier but still meaningfully harder
 * to gather in bulk than an ordinary block — not farmable or minable in
 * quantity the way stone, wood, or wool are. Used only as a small
 * tie-break in color matching (see `color.ts`'s `findBestMatch`), never
 * as an exclusion: none of these are expensive enough to justify
 * removing them from the palette outright, the way the `PRECIOUS_MATERIAL_BLOCK_IDS`
 * tier does.
 */
const ELEVATED_COST_BLOCK_IDS: ReadonlySet<string> = new Set([
  "amethyst_block",
  "sponge",
  "wet_sponge",
  "prismarine",
  "prismarine_bricks",
  "dark_prismarine",
  "sea_lantern",
]);

/** A small, unitless acquisition-cost score — see `ScoredCandidate.acquisitionCost` in `color.ts`. `costTierOf` already hard-excludes true "precious" blocks under `survivalFriendlyOnly`, so this only needs to rank the remaining, always-available blocks against each other. */
export function acquisitionCostOf(blockId: string): number {
  if (costTierOf(blockId) === "precious") return 2;
  if (ELEVATED_COST_BLOCK_IDS.has(blockId)) return 1;
  return 0;
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

/** Below this alpha, a pixel is treated as genuinely translucent and disqualifies its texture. Short of 255 on purpose: real resource packs sometimes export a handful of pixels at 254/253 from lossy rounding in an otherwise fully opaque texture, which full-opacity-only would reject for no visible reason. */
const OPAQUE_ALPHA_THRESHOLD = 250;

/**
 * One raw pixel of a decoded texture, read straight off its RGBA buffer and
 * converted to Oklab — a small free function rather than a stored array entry,
 * so scanning a texture twice (mean, then variance-from-that-mean — see
 * {@link representativeAppearance}) never needs to hold more than one pixel's
 * worth of converted color at a time.
 *
 * A `tint` is multiplied in first, exactly where the renderer does it. That has
 * to happen per pixel rather than once on the texture's mean: the multiply is
 * linear in sRGB bytes but the conversion to Oklab is not, so tinting an
 * average and averaging tinted pixels give different colors.
 */
function pixelOklabAt(texture: DecodedTexture, pixelStart: number, tint: Rgb8 | undefined): Oklab {
  const stored: Rgb8 = {
    r: texture.pixels[pixelStart]!,
    g: texture.pixels[pixelStart + 1]!,
    b: texture.pixels[pixelStart + 2]!,
  };
  return tint === undefined ? linearRgbToOklab(rgb8ToLinearRgb(stored)) : applyBiomeTint(stored, tint);
}

/**
 * One texture's own Oklab mean, or `undefined` if the texture is
 * disqualified: animated (an `.mcmeta` file sits beside it), its
 * decoded pixels are not square (a strong sign of a stacked animation
 * filmstrip), or any pixel is not opaque enough (see
 * {@link OPAQUE_ALPHA_THRESHOLD}). Either case disqualifies the WHOLE
 * texture rather than averaging just the remaining pixels, since a
 * partial, unrepresentative average would be a worse match than simply
 * not offering the block at all.
 *
 * Streams the mean (a running per-channel sum divided by count at the
 * end — identical arithmetic to, and so identical floating-point
 * results as, averaging a materialized array in the same pixel order)
 * rather than building a per-pixel array first: a 512px HD texture is
 * 262,144 pixels, and this runs once per distinct texture of every
 * eligible candidate on every single `buildPalette`/
 * `listAxisVariantBlocks` call (i.e. every options toggle) — holding a
 * quarter-million short-lived objects per texture, repeatedly, is real
 * memory pressure a running sum has no reason to pay. The decoded
 * texture itself is still returned (not re-fetched) so
 * {@link representativeAppearance} can scan the same raw bytes a second
 * time for variance, once the cross-texture `color` it needs is known.
 */
async function screenedTextureMean(
  archive: MinecraftArchive,
  textureId: string,
  decodeTexture: TextureDecoder,
  tint: Rgb8 | undefined,
): Promise<{ readonly decoded: DecodedTexture; readonly meanOklab: Oklab } | undefined> {
  if (archive.getFile(textureMetaPath(textureId)) !== undefined) return undefined;

  const bytes = archive.getFile(texturePath(textureId));
  if (bytes === undefined) return undefined;

  const decoded = await decodeTexture(bytes);
  if (decoded.width !== decoded.height) return undefined;

  let sumL = 0;
  let sumA = 0;
  let sumB = 0;
  let pixelCount = 0;
  for (let pixelStart = 0; pixelStart < decoded.pixels.length; pixelStart += 4) {
    const alpha = decoded.pixels[pixelStart + 3]!;
    if (alpha < OPAQUE_ALPHA_THRESHOLD) return undefined;
    const oklab = pixelOklabAt(decoded, pixelStart, tint);
    sumL += oklab.L;
    sumA += oklab.a;
    sumB += oklab.b;
    pixelCount++;
  }
  return { decoded, meanOklab: { L: sumL / pixelCount, a: sumA / pixelCount, b: sumB / pixelCount } };
}

/** Mean squared Oklab distance of every pixel of an already-screened (opaque, square) texture from `targetColor` — a second streaming pass over the same raw buffer {@link screenedTextureMean} decoded, not a stored per-pixel array (same reasoning as that function's own doc comment). */
function meanSquaredDistanceFrom(texture: DecodedTexture, targetColor: Oklab, tint: Rgb8 | undefined): number {
  let sumSquaredDistance = 0;
  let pixelCount = 0;
  for (let pixelStart = 0; pixelStart < texture.pixels.length; pixelStart += 4) {
    sumSquaredDistance += oklabDistanceSquared(pixelOklabAt(texture, pixelStart, tint), targetColor);
    pixelCount++;
  }
  return sumSquaredDistance / pixelCount;
}

/** How one face of a block looks on its own: the colour it shows, and how busy that one texture is around that colour. */
export interface FaceAppearance {
  readonly color: Oklab;
  readonly variance: number;
}

/**
 * The per-face appearance of a block that shows the same thing on all six
 * faces — every `cube_all` block, which is most of them.
 *
 * Exported because a `PaletteBlock` cannot be built without an
 * `appearanceByFace`, and a caller holding only one colour (a test fixture, a
 * synthetic candidate) would otherwise have to spell out six identical
 * entries and get the invariant subtly wrong.
 */
export function uniformAppearanceByFace(
  color: Oklab,
  variance: number,
): Readonly<Record<CubeFaceDirection, FaceAppearance>> {
  return Object.fromEntries(CUBE_FACE_DIRECTIONS.map((direction) => [direction, { color, variance }])) as Record<
    CubeFaceDirection,
    FaceAppearance
  >;
}

export interface BlockAppearance {
  readonly color: Oklab;
  readonly variance: number;
  /**
   * The same two numbers per face, which is what a replica actually shows.
   *
   * For the common single-texture block every entry equals the block-level
   * pair above. For a log it does not, and the difference is large: oak_log's
   * blended colour sits 0.138 Oklab from BOTH its bark and its end grain —
   * seven times the whole matching tolerance — so neither colour it really
   * shows was ever available to match against.
   */
  readonly byFace: Readonly<Record<CubeFaceDirection, FaceAppearance>>;
}

/**
 * A block's representative appearance: its color, plus how visually
 * busy its texture is around that color.
 *
 * `color` is the Oklab average across each of its DISTINCT face textures
 * (deduplicated by texture id, each counted once regardless of how many
 * of the 6 faces use it) — each texture's own pixels are first converted
 * to Oklab and averaged THERE (not averaged in linear light and then
 * converted), so `color` is the true Oklab centroid of the block's own
 * pixels. For the common case — a `cube_all`-style block where all six
 * faces share one texture — this is exactly that texture's own Oklab
 * average. Blocks whose faces use several different textures (e.g. a
 * distinct top texture) get an equal-weight average across those
 * distinct textures rather than one weighted by face count; no candidate
 * block this app ships exclusion rules for actually has that shape, so
 * the simplification is untested in practice but documented here in
 * case a resource pack introduces one.
 *
 * Averaging directly in Oklab (rather than linear-light-then-convert)
 * matters for `variance`: Oklab's cube-root nonlinearity means those two
 * averages are different points, and only the true centroid makes
 * `variance` (the mean squared distance from `color`) a true variance
 * of the texture around its own center. For a perfectly flat texture
 * both methods agree (every pixel is the same point either way), which
 * is why this does not disturb any color pinned by a uniform-texture
 * test.
 *
 * `variance` is the mean squared Oklab distance of every pixel of every
 * distinct texture from the block's own `color`, pooled with the same
 * equal-weight-per-texture convention as `color` itself (a texture's own
 * mean-squared-distance is computed first, then those per-texture
 * numbers are averaged) — so a block whose faces differ wildly from each
 * other is correctly scored as a poor single-color stand-in, not only a
 * block that is noisy within one face. Zero for a perfectly flat texture
 * up to float rounding (the mean is a sum divided by a pixel count and can
 * land an ulp off the identical pixels, leaving a variance near 1e-33):
 * `color.ts`'s matcher compares variances at a coarser resolution for
 * exactly that reason, so this is deliberately not snapped to 0 here.
 *
 * `byFace` carries what each face shows on its own, which is what a
 * replica's surface is actually made of. Note its per-face `variance` is
 * measured around THAT face's own mean, not the block's: measuring a log's
 * flat bark against the blended block colour reported it as wildly busy
 * (~0.0033, thousands of `color.ts` flatness steps) and made every
 * two-texture block lose the matcher's flatness tie-break to any
 * single-texture one. Per face, flat bark scores flat.
 */
async function representativeAppearance(
  archive: MinecraftArchive,
  model: ResolvedCubeModel,
  decodeTexture: TextureDecoder,
  tint: Rgb8 | undefined,
): Promise<BlockAppearance | undefined> {
  // Keyed by texture AND whether it is tinted, not by texture alone: a block
  // can show the same file on a tinted face and an untinted one, and those
  // are two different colours. (A grass block's sides and top, if a pack
  // builds them from one file.)
  const screenedByKey = new Map<string, { readonly decoded: DecodedTexture; readonly meanOklab: Oklab }>();
  const keyFor = (direction: CubeFaceDirection) =>
    `${model.faceTextureIds[direction]}|${model.tintedFaces[direction] ? "tinted" : "plain"}`;

  for (const direction of CUBE_FACE_DIRECTIONS) {
    const key = keyFor(direction);
    if (screenedByKey.has(key)) continue;
    const faceTint = model.tintedFaces[direction] ? tint : undefined;
    const screened = await screenedTextureMean(archive, model.faceTextureIds[direction], decodeTexture, faceTint);
    if (screened === undefined) return undefined;
    screenedByKey.set(key, screened);
  }
  const screenedTextures = [...screenedByKey.values()];

  const color = averageOklab(screenedTextures.map((texture) => texture.meanOklab));

  const tintForKey = (key: string): Rgb8 | undefined => (key.endsWith("|tinted") ? tint : undefined);
  const perTextureVariances = [...screenedByKey].map(([key, texture]) =>
    meanSquaredDistanceFrom(texture.decoded, color, tintForKey(key)),
  );
  const variance = perTextureVariances.reduce((sum, value) => sum + value, 0) / perTextureVariances.length;

  // Per distinct texture, not per face: six faces share at most a handful of
  // textures, and each of these is a full scan of a texture that can be 262k
  // pixels on an HD pack.
  const appearanceByKey = new Map(
    [...screenedByKey].map(([key, screened]) => [
      key,
      {
        color: screened.meanOklab,
        variance: meanSquaredDistanceFrom(screened.decoded, screened.meanOklab, tintForKey(key)),
      },
    ]),
  );
  const byFace = Object.fromEntries(
    // Safe to assert: the map was keyed by this very function.
    CUBE_FACE_DIRECTIONS.map((direction) => [direction, appearanceByKey.get(keyFor(direction))!]),
  ) as Record<CubeFaceDirection, FaceAppearance>;

  return { color, variance, byFace };
}

/** {@link applyEmissiveBoost} across every face, so a glowing block reads brighter whichever way it is matched. */
function applyEmissiveBoostPerFace(
  blockId: string,
  byFace: Readonly<Record<CubeFaceDirection, FaceAppearance>>,
): Readonly<Record<CubeFaceDirection, FaceAppearance>> {
  if (!EMISSIVE_BLOCK_IDS.has(blockId)) return byFace;
  return Object.fromEntries(
    CUBE_FACE_DIRECTIONS.map((direction) => [
      direction,
      { ...byFace[direction], color: applyEmissiveBoost(blockId, byFace[direction].color) },
    ]),
  ) as Record<CubeFaceDirection, FaceAppearance>;
}

/** Lifts an emissive block's resolved lightness — see {@link EMISSIVE_BLOCK_IDS}. A no-op for every other block. */
function applyEmissiveBoost(blockId: string, color: Oklab): Oklab {
  if (!EMISSIVE_BLOCK_IDS.has(blockId)) return color;
  return { ...color, L: Math.min(1, color.L + EMISSIVE_LIGHTNESS_BOOST) };
}

/**
 * Builds the full candidate palette from an archive.
 *
 * Inputs: `archive`, the user's parsed jar/resource pack;
 * `options`, which optional exclusion categories to relax;
 * `decodeTexture`, the PNG decoder (defaults to the real browser-based
 * one; tests inject a fake).
 * Output: one entry per eligible block, each with its representative
 * appearance already resolved — ready for `color.ts`'s `findBestMatch`.
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
    // Axis-pillar blocks get their own dedicated resolver and list (see
    // listAxisVariantBlocks below) — skipped here explicitly so a log
    // never lands in both lists, which palette.test.ts's disjointness
    // test pins. resolveCanonicalVariantCubeModel has no reason of its
    // own to treat an `axis=` property any differently from any other,
    // so without this check it would happily "resolve" one too.
    if (hasAxisVariants(archive, blockId)) continue;

    const canonicalVariant = resolveCanonicalVariantCubeModel(archive, blockId);
    if (canonicalVariant === undefined) continue;

    const appearance = await representativeAppearance(archive, canonicalVariant.model, decodeTexture, biomeTintFor(blockId));
    if (appearance === undefined) continue;

    paletteBlocks.push({
      blockId,
      resourceLocation: `minecraft:${blockId}`,
      color: applyEmissiveBoost(blockId, appearance.color),
      textureVariance: appearance.variance,
      appearanceByFace: applyEmissiveBoostPerFace(blockId, appearance.byFace),
      costTier: costTierOf(blockId),
      acquisitionCost: acquisitionCostOf(blockId),
      ...(Object.keys(canonicalVariant.properties).length > 0 && { properties: canonicalVariant.properties }),
    });
  }

  return paletteBlocks;
}

/**
 * Lists axis-pillar blocks (logs, wood, basalt, quartz/purpur pillars,
 * etc. — see `assets/modelResolver.ts`'s `hasAxisVariants`), each
 * resolved in its `"upright"` orientation (`axis=y`).
 *
 * A separate list from {@link buildPalette}, not because these blocks
 * are unfit as fill material — the UI merges this list into
 * `buildPalette`'s before passing either to `buildVoxelGrid`, and the
 * `"upright"` color computed here is exactly right for that: a
 * schematic entry with no `Properties` defaults to `axis=y`, so the
 * color this function resolves is what actually gets placed. The
 * separation exists because only THIS list needs an orientation choice
 * exposed in the picker (for when one of these is picked as the scale
 * *source*, not as fill) — `buildPalette`'s candidates have no
 * orientation concept to begin with. The same exclusion rules apply
 * either way — an axis-pillar block makes no exception for being
 * precious, gravity-affected, or biome-tinted.
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

    const appearance = await representativeAppearance(archive, model, decodeTexture, biomeTintFor(blockId));
    if (appearance === undefined) continue;

    blocks.push({
      blockId,
      resourceLocation: `minecraft:${blockId}`,
      color: applyEmissiveBoost(blockId, appearance.color),
      textureVariance: appearance.variance,
      appearanceByFace: applyEmissiveBoostPerFace(blockId, appearance.byFace),
      costTier: costTierOf(blockId),
      acquisitionCost: acquisitionCostOf(blockId),
    });
  }

  return blocks;
}
