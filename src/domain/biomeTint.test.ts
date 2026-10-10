import { describe, expect, it } from "vitest";
import { applyBiomeTint, biomeTintFor } from "./biomeTint.ts";
import { oklabDistance, oklabToRgb8, rgb8ToOklab } from "./color.ts";

/** Roughly what the jar stores for grass_block_top: a mid grey carrying only the texture's light/dark pattern. */
const STORED_GREY = { r: 150, g: 150, b: 150 };

describe("biomeTintFor", () => {
  it("knows the blocks the game tints", () => {
    for (const blockId of ["grass_block", "oak_leaves", "jungle_leaves", "mangrove_leaves"]) {
      expect(biomeTintFor(blockId), blockId).toBeDefined();
    }
  });

  it("gives birch and spruce their own fixed colours, which the game does not take from the biome", () => {
    expect(biomeTintFor("birch_leaves")).not.toEqual(biomeTintFor("oak_leaves"));
    expect(biomeTintFor("spruce_leaves")).not.toEqual(biomeTintFor("oak_leaves"));
  });

  it("leaves every untinted block alone — a tint applied to stone would be a colour the game never shows", () => {
    for (const blockId of ["stone", "oak_planks", "white_concrete", "warped_stem"]) {
      expect(biomeTintFor(blockId), blockId).toBeUndefined();
    }
  });
});

describe("applyBiomeTint", () => {
  it("turns the stored grey into the green the game actually draws", () => {
    const tinted = oklabToRgb8(applyBiomeTint(STORED_GREY, biomeTintFor("grass_block")!));
    expect(tinted.g).toBeGreaterThan(tinted.r);
    expect(tinted.g).toBeGreaterThan(tinted.b);
  });

  it("moves the colour far enough to matter: an untinted grass block is ~10x the matching tolerance off", () => {
    // 0.02 Oklab is the matcher's whole budget for trading colour accuracy.
    // This is the error the app used to carry, and the reason these blocks
    // were excluded instead of used.
    const stored = rgb8ToOklab(STORED_GREY);
    const shown = applyBiomeTint(STORED_GREY, biomeTintFor("grass_block")!);
    expect(oklabDistance(stored, shown)).toBeGreaterThan(0.15);
  });

  it("darkens rather than brightens, because a tint is a multiply and never exceeds the stored value", () => {
    const tinted = oklabToRgb8(applyBiomeTint(STORED_GREY, biomeTintFor("grass_block")!));
    for (const channel of ["r", "g", "b"] as const) {
      expect(tinted[channel], channel).toBeLessThanOrEqual(STORED_GREY[channel] + 1);
    }
  });

  it("leaves white untouched by a white tint, and black black under any tint", () => {
    const white = { r: 255, g: 255, b: 255 };
    expect(oklabToRgb8(applyBiomeTint(white, { r: 255, g: 255, b: 255 }))).toEqual(white);
    const black = { r: 0, g: 0, b: 0 };
    expect(oklabToRgb8(applyBiomeTint(black, biomeTintFor("oak_leaves")!))).toEqual(black);
  });
});
