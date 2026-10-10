import { describe, expect, it } from "vitest";
import { oklabDistance, rgb8ToOklab, type Rgb8 } from "./color.ts";
import { consolidateVoxels } from "./consolidate.ts";
import { uniformAppearanceByFace, type PaletteBlock } from "./palette.ts";
import type { Voxel } from "./shell.ts";

function fakeBlock(blockId: string, rgb: Rgb8): PaletteBlock {
  return {
    blockId,
    resourceLocation: `minecraft:${blockId}`,
    color: rgb8ToOklab(rgb),
    textureVariance: 0,
    appearanceByFace: uniformAppearanceByFace(rgb8ToOklab(rgb), 0),
    costTier: "common",
    acquisitionCost: 0,
  };
}

function fakeVoxel(x: number, blockId: string, rgb: Rgb8): Voxel {
  return { x, y: 0, z: 0, paletteBlock: fakeBlock(blockId, rgb) };
}

const BLACK: Rgb8 = { r: 0, g: 0, b: 0 };
const DARK_GRAY: Rgb8 = { r: 64, g: 64, b: 64 };
const WHITE: Rgb8 = { r: 255, g: 255, b: 255 };

describe("consolidateVoxels", () => {
  it("is a no-op when the grid is already at or under the cap", () => {
    const voxels = [fakeVoxel(0, "black", BLACK), fakeVoxel(1, "white", WHITE)];
    const result = consolidateVoxels(voxels, 2);

    expect(result.voxels).toBe(voxels);
    expect(result.originalBlockCount).toBe(2);
    expect(result.consolidatedBlockCount).toBe(2);
    expect(result.averageColorErrorIntroduced).toBe(0);
  });

  it("drops the least-used block and re-matches its voxels to the nearest survivor", () => {
    const voxels = [
      ...Array.from({ length: 5 }, (_, i) => fakeVoxel(i, "black", BLACK)),
      ...Array.from({ length: 3 }, (_, i) => fakeVoxel(10 + i, "white", WHITE)),
      fakeVoxel(20, "darkgray", DARK_GRAY),
    ];

    const result = consolidateVoxels(voxels, 2);

    expect(result.originalBlockCount).toBe(3);
    expect(result.consolidatedBlockCount).toBe(2);
    expect(new Set(result.voxels.map((v) => v.paletteBlock.blockId))).toEqual(new Set(["black", "white"]));

    const rematched = result.voxels.find((v) => v.x === 20)!;
    expect(rematched.paletteBlock.blockId).toBe("black");

    const expectedError = oklabDistance(rgb8ToOklab(DARK_GRAY), rgb8ToOklab(BLACK));
    expect(result.averageColorErrorIntroduced).toBeCloseTo(expectedError, 10);

    // Survivors are returned untouched — not just equal, the SAME object.
    expect(result.voxels[0]).toBe(voxels[0]);
  });

  it("keeps a rare block that is the only one covering its colour, over a near-duplicate of a common one", () => {
    // The case popularity gets wrong. Two near-identical dark blocks are
    // both heavily used; one red block is used rarely but is the only thing
    // within reach of red. Keeping the two darks (the two most-used) would
    // strand every red voxel on a colour nowhere near it.
    const NEAR_BLACK: Rgb8 = { r: 12, g: 12, b: 12 };
    const RED: Rgb8 = { r: 220, g: 30, b: 30 };
    const voxels = [
      ...Array.from({ length: 50 }, (_, i) => fakeVoxel(i, "black", BLACK)),
      ...Array.from({ length: 40 }, (_, i) => fakeVoxel(100 + i, "near_black", NEAR_BLACK)),
      ...Array.from({ length: 5 }, (_, i) => fakeVoxel(200 + i, "red", RED)),
    ];

    const result = consolidateVoxels(voxels, 2);

    const survivors = new Set(result.voxels.map((voxel) => voxel.paletteBlock.blockId));
    expect(survivors.has("red")).toBe(true);
    expect(survivors.has("near_black")).toBe(false);
  });

  it("still prefers the more-used of two blocks when they cover the same colour equally", () => {
    // Usage has not stopped mattering — an error is paid once per voxel, so
    // between equally redundant blocks the rarer one is the cheaper to drop.
    const voxels = [
      ...Array.from({ length: 20 }, (_, i) => fakeVoxel(i, "common_white", WHITE)),
      ...Array.from({ length: 2 }, (_, i) => fakeVoxel(100 + i, "rare_white", { r: 252, g: 252, b: 252 })),
      ...Array.from({ length: 10 }, (_, i) => fakeVoxel(200 + i, "black", BLACK)),
    ];

    const result = consolidateVoxels(voxels, 2);

    expect(new Set(result.voxels.map((voxel) => voxel.paletteBlock.blockId))).toEqual(
      new Set(["common_white", "black"]),
    );
  });

  it("breaks a usage-count tie among candidate survivors by block id, for full determinism", () => {
    const voxels = [
      ...Array.from({ length: 3 }, (_, i) => fakeVoxel(i, "block_c", WHITE)),
      ...Array.from({ length: 2 }, (_, i) => fakeVoxel(10 + i, "block_a", BLACK)),
      ...Array.from({ length: 2 }, (_, i) => fakeVoxel(20 + i, "block_b", DARK_GRAY)),
    ];

    const result = consolidateVoxels(voxels, 2);

    expect(new Set(result.voxels.map((v) => v.paletteBlock.blockId))).toEqual(new Set(["block_c", "block_a"]));
    const rematched = result.voxels.filter((v) => v.x === 20 || v.x === 21);
    expect(rematched.every((v) => v.paletteBlock.blockId === "block_a")).toBe(true);
  });

  it("throws for a non-positive or non-integer cap", () => {
    const voxels = [fakeVoxel(0, "black", BLACK)];
    expect(() => consolidateVoxels(voxels, 0)).toThrow(RangeError);
    expect(() => consolidateVoxels(voxels, -1)).toThrow(RangeError);
    expect(() => consolidateVoxels(voxels, 1.5)).toThrow(RangeError);
  });
});
