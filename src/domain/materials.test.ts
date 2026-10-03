import { describe, expect, it } from "vitest";
import { rgb8ToOklab } from "./color.ts";
import type { PaletteBlock } from "./palette.ts";
import type { Voxel } from "./shell.ts";
import { breakdownQuantity, buildMaterialList, ITEMS_PER_SHULKER_BOX, totalBlockCount } from "./materials.ts";

describe("breakdownQuantity", () => {
  it("matches the plan's worked example: 1800 -> 1 shulker + 1 stack + 8", () => {
    expect(breakdownQuantity(1800)).toEqual({ shulkerBoxes: 1, stacks: 1, singles: 8, totalCount: 1800 });
  });

  it.each([
    [0, { shulkerBoxes: 0, stacks: 0, singles: 0, totalCount: 0 }],
    [63, { shulkerBoxes: 0, stacks: 0, singles: 63, totalCount: 63 }],
    [64, { shulkerBoxes: 0, stacks: 1, singles: 0, totalCount: 64 }],
    [1727, { shulkerBoxes: 0, stacks: 26, singles: 63, totalCount: 1727 }],
    [1728, { shulkerBoxes: 1, stacks: 0, singles: 0, totalCount: 1728 }],
    [1729, { shulkerBoxes: 1, stacks: 0, singles: 1, totalCount: 1729 }],
  ] as const)("breaks down %i", (count, expected) => {
    expect(breakdownQuantity(count)).toEqual(expected);
  });

  it("rejects a negative or non-integer count", () => {
    expect(() => breakdownQuantity(-1)).toThrow(RangeError);
    expect(() => breakdownQuantity(1.5)).toThrow(RangeError);
  });
});

function fakePaletteBlock(blockId: string): PaletteBlock {
  return { blockId, resourceLocation: `minecraft:${blockId}`, color: rgb8ToOklab({ r: 100, g: 100, b: 100 }), costTier: "common" };
}

function fakeVoxels(blockIdCounts: Readonly<Record<string, number>>): Voxel[] {
  const voxels: Voxel[] = [];
  let i = 0;
  for (const [blockId, count] of Object.entries(blockIdCounts)) {
    const paletteBlock = fakePaletteBlock(blockId);
    for (let n = 0; n < count; n++) {
      voxels.push({ x: i, y: 0, z: 0, paletteBlock });
      i++;
    }
  }
  return voxels;
}

describe("buildMaterialList", () => {
  it("tallies counts per block with a correct breakdown", () => {
    const list = buildMaterialList(fakeVoxels({ cobblestone: 1800, stone: 64 }));
    const cobblestone = list.find((entry) => entry.blockId === "cobblestone");
    expect(cobblestone?.count).toBe(1800);
    expect(cobblestone?.resourceLocation).toBe("minecraft:cobblestone");
    expect(cobblestone?.breakdown).toEqual({ shulkerBoxes: 1, stacks: 1, singles: 8, totalCount: 1800 });
  });

  it("sorts most-needed block first", () => {
    const list = buildMaterialList(fakeVoxels({ stone: 5, cobblestone: 50, andesite: 20 }));
    expect(list.map((entry) => entry.blockId)).toEqual(["cobblestone", "andesite", "stone"]);
  });

  it("breaks ties alphabetically by block id", () => {
    const list = buildMaterialList(fakeVoxels({ zebra_block: 10, apple_block: 10 }));
    expect(list.map((entry) => entry.blockId)).toEqual(["apple_block", "zebra_block"]);
  });

  it("returns an empty list for no voxels", () => {
    expect(buildMaterialList([])).toEqual([]);
  });

  it("every count sums to the total number of voxels", () => {
    const voxels = fakeVoxels({ cobblestone: 1352, andesite: 300, gravel: 7 });
    const list = buildMaterialList(voxels);
    expect(totalBlockCount(list)).toBe(voxels.length);
  });
});

describe("totalBlockCount", () => {
  it("is zero for an empty list", () => {
    expect(totalBlockCount([])).toBe(0);
  });

  it("matches a hand-checkable total across several entries", () => {
    const list = buildMaterialList(fakeVoxels({ a: ITEMS_PER_SHULKER_BOX, b: 5 }));
    expect(totalBlockCount(list)).toBe(ITEMS_PER_SHULKER_BOX + 5);
  });
});
