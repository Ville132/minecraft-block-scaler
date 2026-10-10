import { describe, expect, it } from "vitest";
import { rgb8ToOklab } from "./color.ts";
import { uniformAppearanceByFace, type PaletteBlock } from "./palette.ts";
import type { Voxel } from "./shell.ts";
import {
  breakdownQuantity,
  buildLayerBreakdown,
  buildMaterialList,
  ITEMS_PER_INVENTORY_LOAD,
  ITEMS_PER_SHULKER_BOX,
  summarizeMaterialList,
  totalBlockCount,
} from "./materials.ts";

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

function fakePaletteBlock(blockId: string, properties?: Readonly<Record<string, string>>): PaletteBlock {
  return {
    blockId,
    resourceLocation: `minecraft:${blockId}`,
    color: rgb8ToOklab({ r: 100, g: 100, b: 100 }),
    textureVariance: 0,
    appearanceByFace: uniformAppearanceByFace(rgb8ToOklab({ r: 100, g: 100, b: 100 }), 0),
    costTier: "common",
    acquisitionCost: 0,
    ...(properties !== undefined && { properties }),
  };
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

describe("buildMaterialList properties passthrough", () => {
  it("carries a block's properties through to its material list entry", () => {
    const paletteBlock = fakePaletteBlock("orange_glazed_terracotta", { facing: "north" });
    const list = buildMaterialList([{ x: 0, y: 0, z: 0, paletteBlock }]);
    expect(list[0]?.properties).toEqual({ facing: "north" });
  });

  it("leaves properties undefined for a block that has none", () => {
    const list = buildMaterialList(fakeVoxels({ stone: 1 }));
    expect(list[0]?.properties).toBeUndefined();
  });
});

describe("summarizeMaterialList", () => {
  it("is all zero for an empty list", () => {
    expect(summarizeMaterialList([])).toEqual({
      totalBlocks: 0,
      shulkerBoxes: 0,
      inventoryLoads: 0,
      recommendedWithSpares: 0,
    });
  });

  it("matches a hand-checkable example", () => {
    // 1 shulker box of cobblestone (1728) + 1 single stone = 1729 blocks.
    const list = buildMaterialList(fakeVoxels({ cobblestone: ITEMS_PER_SHULKER_BOX, stone: 1 }));
    const totals = summarizeMaterialList(list);
    expect(totals.totalBlocks).toBe(ITEMS_PER_SHULKER_BOX + 1);
    expect(totals.shulkerBoxes).toBe(1);
    expect(totals.inventoryLoads).toBe(Math.ceil((ITEMS_PER_SHULKER_BOX + 1) / ITEMS_PER_INVENTORY_LOAD));
    expect(totals.recommendedWithSpares).toBe(Math.ceil((ITEMS_PER_SHULKER_BOX + 1) * 1.1));
  });

  it("sums shulker boxes across multiple block types rather than combining their leftovers", () => {
    // Each type alone has fewer than ITEMS_PER_SHULKER_BOX, but together
    // the total exceeds it — the grand total must stay 0, not 1, since
    // this module deliberately doesn't pack different blocks' leftovers
    // into a shared box.
    const list = buildMaterialList(fakeVoxels({ cobblestone: 1000, stone: 1000 }));
    expect(summarizeMaterialList(list).shulkerBoxes).toBe(0);
  });

  it("rounds inventory loads and spares up, never down", () => {
    const list = buildMaterialList(fakeVoxels({ stone: 1 }));
    const totals = summarizeMaterialList(list);
    expect(totals.inventoryLoads).toBe(1);
    expect(totals.recommendedWithSpares).toBe(2);
  });
});

describe("buildLayerBreakdown", () => {
  function voxelAt(y: number, blockId: string): Voxel {
    return { x: 0, y, z: 0, paletteBlock: fakePaletteBlock(blockId) };
  }

  it("returns an empty list for no voxels", () => {
    expect(buildLayerBreakdown([])).toEqual([]);
  });

  it("groups voxels by y and sorts layers bottom to top", () => {
    const voxels = [voxelAt(2, "stone"), voxelAt(0, "dirt"), voxelAt(1, "andesite")];
    expect(buildLayerBreakdown(voxels).map((layer) => layer.y)).toEqual([0, 1, 2]);
  });

  it("tallies each layer's own blocks independently of other layers", () => {
    const voxels = [
      voxelAt(0, "stone"),
      voxelAt(0, "stone"),
      voxelAt(0, "andesite"),
      voxelAt(1, "andesite"),
    ];
    const layers = buildLayerBreakdown(voxels);
    expect(layers).toEqual([
      {
        y: 0,
        totalCount: 3,
        entries: [
          { blockId: "stone", resourceLocation: "minecraft:stone", count: 2 },
          { blockId: "andesite", resourceLocation: "minecraft:andesite", count: 1 },
        ],
      },
      {
        y: 1,
        totalCount: 1,
        entries: [{ blockId: "andesite", resourceLocation: "minecraft:andesite", count: 1 }],
      },
    ]);
  });

  it("every layer's totalCount sums to the grid's total voxel count", () => {
    const voxels = fakeVoxels({ cobblestone: 50, andesite: 20 }).map((voxel, i) => ({ ...voxel, y: i % 4 }));
    const layers = buildLayerBreakdown(voxels);
    const sumOfLayers = layers.reduce((sum, layer) => sum + layer.totalCount, 0);
    expect(sumOfLayers).toBe(voxels.length);
  });
});
