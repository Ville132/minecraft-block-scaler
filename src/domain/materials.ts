/**
 * Turns the voxel grid from `shell.ts` into a shopping list: how many
 * of each block, broken into shulker boxes / stacks / loose items.
 */

import type { Voxel } from "./shell.ts";

export const ITEMS_PER_STACK = 64;
/** A shulker box has 27 inventory slots. */
export const STACKS_PER_SHULKER_BOX = 27;
export const ITEMS_PER_SHULKER_BOX = ITEMS_PER_STACK * STACKS_PER_SHULKER_BOX;
/** A player inventory has 36 slots (27 main + 9 hotbar) — used to estimate how many full-inventory trips carrying materials to the build site would take. */
export const SLOTS_PER_INVENTORY = 36;
export const ITEMS_PER_INVENTORY_LOAD = SLOTS_PER_INVENTORY * ITEMS_PER_STACK;
/** How much extra to recommend gathering beyond the exact count, as a hedge against misclicks and placement mistakes — a rough rule of thumb, not a precise recommendation. */
const SPARE_MARGIN_FRACTION = 0.1;

export interface QuantityBreakdown {
  readonly shulkerBoxes: number;
  readonly stacks: number;
  readonly singles: number;
  readonly totalCount: number;
}

/**
 * Splits a raw item count into full shulker boxes, then full stacks,
 * then loose singles — the largest unit first, so a shopping list reads
 * as "grab N shulkers, M stacks, and K loose blocks" rather than a bare
 * number.
 *
 * Failure mode: throws `RangeError` for a negative or non-integer
 * count, since a fractional or negative block count cannot occur from
 * real voxel data and signals a caller bug rather than a value to clamp.
 */
export function breakdownQuantity(totalCount: number): QuantityBreakdown {
  if (!Number.isInteger(totalCount) || totalCount < 0) {
    throw new RangeError(`totalCount must be a non-negative integer, got ${totalCount}`);
  }
  const shulkerBoxes = Math.floor(totalCount / ITEMS_PER_SHULKER_BOX);
  const afterShulkerBoxes = totalCount % ITEMS_PER_SHULKER_BOX;
  const stacks = Math.floor(afterShulkerBoxes / ITEMS_PER_STACK);
  const singles = afterShulkerBoxes % ITEMS_PER_STACK;
  return { shulkerBoxes, stacks, singles, totalCount };
}

interface BlockTally {
  readonly resourceLocation: string;
  readonly properties?: Readonly<Record<string, string>>;
  count: number;
}

/**
 * Tallies how many voxels use each distinct block id. Every voxel
 * sharing a block id always shares the same `resourceLocation` and
 * `properties` too (`domain/palette.ts` resolves exactly one canonical
 * variant per block id for a given build, and every matching voxel
 * reuses that same `PaletteBlock` object) — so recording them once, off
 * the first voxel seen for that id, is exact, not a first-wins
 * approximation.
 */
function tallyByBlockId(voxels: Iterable<Voxel>): Map<string, BlockTally> {
  const tally = new Map<string, BlockTally>();
  for (const voxel of voxels) {
    const { blockId, resourceLocation, properties } = voxel.paletteBlock;
    const existing = tally.get(blockId);
    if (existing === undefined) {
      tally.set(blockId, { resourceLocation, ...(properties !== undefined && { properties }), count: 1 });
    } else {
      existing.count += 1;
    }
  }
  return tally;
}

interface SortedTallyEntry {
  readonly blockId: string;
  readonly resourceLocation: string;
  readonly properties?: Readonly<Record<string, string>>;
  readonly count: number;
}

/** Most-used block first, ties broken alphabetically by block id — a stable, scannable order rather than one that depends on voxel iteration order. */
function sortedByCountThenBlockId(tally: ReadonlyMap<string, BlockTally>): SortedTallyEntry[] {
  return Array.from(tally.entries())
    .map(([blockId, { resourceLocation, properties, count }]) => ({
      blockId,
      resourceLocation,
      ...(properties !== undefined && { properties }),
      count,
    }))
    .sort((a, b) => b.count - a.count || a.blockId.localeCompare(b.blockId));
}

export interface MaterialListEntry {
  readonly blockId: string;
  readonly resourceLocation: string;
  readonly count: number;
  readonly breakdown: QuantityBreakdown;
  /** The blockstate properties to set when placing this block, if any — e.g. `{ facing: "north" }` for a glazed terracotta. See `domain/palette.ts`'s `PaletteBlock.properties`. */
  readonly properties?: Readonly<Record<string, string>>;
}

/** Tallies every voxel's block into a material list, most-needed block first. */
export function buildMaterialList(voxels: readonly Voxel[]): MaterialListEntry[] {
  return sortedByCountThenBlockId(tallyByBlockId(voxels)).map((entry) => ({
    ...entry,
    breakdown: breakdownQuantity(entry.count),
  }));
}

/** The total block count across a material list — also what the schematic's `Metadata.TotalBlocks` field must equal (see `litematic/writeSchematic.ts`). */
export function totalBlockCount(materialList: readonly MaterialListEntry[]): number {
  return materialList.reduce((sum, entry) => sum + entry.count, 0);
}

export interface MaterialListTotals {
  readonly totalBlocks: number;
  /** Sum of each block's own full-shulker-box count (`breakdown.shulkerBoxes`) — how many boxes you'd need packing each block type separately, same "full units first" convention as a single entry's own breakdown. Not a cross-block bin-packing plan: leftover stacks/singles of different block types are never combined into a shared box here. */
  readonly shulkerBoxes: number;
  /** `ceil(totalBlocks / ITEMS_PER_INVENTORY_LOAD)` — how many full-inventory trips it would take to carry everything to the build site, ignoring tools/other items taking up slots too. */
  readonly inventoryLoads: number;
  /** `totalBlocks` plus a 10% spare margin, rounded up — a rough hedge against misclicks and placement mistakes, not a precise requirement. */
  readonly recommendedWithSpares: number;
}

/** Grand totals across an entire material list — see {@link MaterialListTotals} for what each figure means and doesn't promise. */
export function summarizeMaterialList(materialList: readonly MaterialListEntry[]): MaterialListTotals {
  const totalBlocks = totalBlockCount(materialList);
  return {
    totalBlocks,
    shulkerBoxes: materialList.reduce((sum, entry) => sum + entry.breakdown.shulkerBoxes, 0),
    inventoryLoads: totalBlocks === 0 ? 0 : Math.ceil(totalBlocks / ITEMS_PER_INVENTORY_LOAD),
    recommendedWithSpares: Math.ceil(totalBlocks * (1 + SPARE_MARGIN_FRACTION)),
  };
}

export interface LayerMaterialEntry {
  readonly blockId: string;
  readonly resourceLocation: string;
  readonly count: number;
}

export interface MaterialLayer {
  /** The schematic's own Y coordinate for this layer (0 = bottom, matching both the `.litematic` file and Litematica's in-game per-layer view) — not a separate 1-indexed "layer number". */
  readonly y: number;
  readonly entries: readonly LayerMaterialEntry[];
  readonly totalCount: number;
}

/**
 * Breaks the material list down one horizontal (Y) slice at a time, so
 * someone building by hand can work upward one layer at a time instead
 * of hunting through one flat total — the single highest-value view for
 * that workflow (see BACKLOG.md 1.3). Layers are returned bottom-to-top
 * (ascending `y`), omitting any `y` with no voxels at all (only
 * possible for a non-cube-shaped build, which this app does not
 * currently produce, but costs nothing to handle correctly regardless).
 */
export function buildLayerBreakdown(voxels: readonly Voxel[]): MaterialLayer[] {
  const voxelsByY = new Map<number, Voxel[]>();
  for (const voxel of voxels) {
    let layerVoxels = voxelsByY.get(voxel.y);
    if (layerVoxels === undefined) {
      layerVoxels = [];
      voxelsByY.set(voxel.y, layerVoxels);
    }
    layerVoxels.push(voxel);
  }

  return Array.from(voxelsByY.entries())
    .sort(([yA], [yB]) => yA - yB)
    .map(([y, layerVoxels]) => ({
      y,
      entries: sortedByCountThenBlockId(tallyByBlockId(layerVoxels)),
      totalCount: layerVoxels.length,
    }));
}
