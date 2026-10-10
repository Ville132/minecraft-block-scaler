/**
 * The colours Minecraft multiplies into grass and foliage when it draws them.
 *
 * WHY this has to exist: the game ships these textures GREYSCALE and tints
 * them at render time from the biome the block stands in. Read straight off
 * the file, `grass_block_top` is a mid grey — about 0.19 Oklab from the green
 * it appears as in a plains biome, ten times the matcher's whole colour
 * tolerance. Without tinting, the only honest thing the app could do was
 * exclude these blocks, which also removed the best greens a builder has.
 *
 * WHY one constant per block rather than a biome picker: the tint really is
 * biome-dependent — the same leaves are olive in a swamp and blue-green in a
 * dark forest — so any single number is a choice. These are the temperate /
 * plains values, which is what the overwhelming majority of builds sit in,
 * and the UI says so rather than pretending the number is universal.
 */

import { rgb8ToOklab, type Oklab } from "./color.ts";
import type { Rgb8 } from "./color.ts";

/** Plains grass, from the default position in the game's grass colormap. */
const GRASS_TINT: Rgb8 = { r: 145, g: 189, b: 89 };
/** Plains foliage, from the default position in the foliage colormap. */
const FOLIAGE_TINT: Rgb8 = { r: 119, g: 171, b: 47 };
/** Birch and spruce ignore the colormap entirely and use a fixed colour wherever they grow. */
const BIRCH_TINT: Rgb8 = { r: 128, g: 167, b: 85 };
const SPRUCE_TINT: Rgb8 = { r: 97, g: 153, b: 97 };

const TINT_BY_BLOCK_ID: ReadonlyMap<string, Rgb8> = new Map([
  ["grass_block", GRASS_TINT],
  ["birch_leaves", BIRCH_TINT],
  ["spruce_leaves", SPRUCE_TINT],
  ...(
    [
      "oak_leaves",
      "jungle_leaves",
      "acacia_leaves",
      "dark_oak_leaves",
      "mangrove_leaves",
      "cherry_leaves",
      "azalea_leaves",
      "flowering_azalea_leaves",
      "vine",
      "sugar_cane",
    ] as const
  ).map((blockId) => [blockId, FOLIAGE_TINT] as const),
]);

/**
 * The tint for `blockId`, or `undefined` when the game draws it as stored.
 *
 * A block only gets tinted where its MODEL also marks the face
 * (`tintindex`); this table answers "with what", not "whether". Both have to
 * agree, which is what keeps an untinted face of a partly-tinted block — a
 * grass block's dirt sides — at its real colour.
 */
export function biomeTintFor(blockId: string): Rgb8 | undefined {
  return TINT_BY_BLOCK_ID.get(blockId);
}

/**
 * Applies a tint the way the renderer does: a per-channel multiply in sRGB
 * byte space, the operation the game performs on the texture before it ever
 * reaches a colour space anyone would call perceptual.
 *
 * Inputs: a stored (greyscale) pixel colour and the tint to multiply in.
 * Output: the colour the block actually appears as, in Oklab.
 */
export function applyBiomeTint(stored: Rgb8, tint: Rgb8): Oklab {
  return rgb8ToOklab({
    r: Math.round((stored.r * tint.r) / 255),
    g: Math.round((stored.g * tint.g) / 255),
    b: Math.round((stored.b * tint.b) / 255),
  });
}
