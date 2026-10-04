import { describe, expect, it } from "vitest";
import { oklabDistance, rgb8ToOklab, type Rgb8 } from "./color.ts";
import { consolidateVoxels } from "./consolidate.ts";
import type { PaletteBlock } from "./palette.ts";
import type { Voxel } from "./shell.ts";

function fakeBlock(blockId: string, rgb: Rgb8): PaletteBlock {
  return {
    blockId,
    resourceLocation: `minecraft:${blockId}`,
    color: rgb8ToOklab(rgb),
    textureVariance: 0,
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
