/**
 * Turns the voxel grid from `shell.ts` into a shopping list: how many
 * of each block, broken into shulker boxes / stacks / loose items.
 */

import type { Voxel } from "./shell.ts";

export const ITEMS_PER_STACK = 64;
/** A shulker box has 27 inventory slots. */
export const STACKS_PER_SHULKER_BOX = 27;
export const ITEMS_PER_SHULKER_BOX = ITEMS_PER_STACK * STACKS_PER_SHULKER_BOX;

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

export interface MaterialListEntry {
  readonly blockId: string;
  readonly resourceLocation: string;
  readonly count: number;
  readonly breakdown: QuantityBreakdown;
}

/**
 * Tallies every voxel's block into a material list, most-needed block
 * first (ties broken alphabetically by block id, for a stable, scan-
 * able order rather than depending on voxel iteration order).
 */
export function buildMaterialList(voxels: readonly Voxel[]): MaterialListEntry[] {
  const countByBlockId = new Map<string, { readonly resourceLocation: string; count: number }>();
  for (const voxel of voxels) {
    const { blockId, resourceLocation } = voxel.paletteBlock;
    const existing = countByBlockId.get(blockId);
    if (existing === undefined) {
      countByBlockId.set(blockId, { resourceLocation, count: 1 });
    } else {
      existing.count += 1;
    }
  }

  return Array.from(countByBlockId.entries())
    .map(([blockId, { resourceLocation, count }]) => ({
      blockId,
      resourceLocation,
      count,
      breakdown: breakdownQuantity(count),
    }))
    .sort((a, b) => b.count - a.count || a.blockId.localeCompare(b.blockId));
}

/** The total block count across a material list — also what the schematic's `Metadata.TotalBlocks` field must equal (see `litematic/writeSchematic.ts`). */
export function totalBlockCount(materialList: readonly MaterialListEntry[]): number {
  return materialList.reduce((sum, entry) => sum + entry.count, 0);
}
