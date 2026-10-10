/**
 * Reduces a voxel grid's distinct block count after the fact — see
 * {@link consolidateVoxels}'s doc comment for the full rationale (in
 * short: a replica is hand-built, and every extra block TYPE is a
 * separate thing to go find, not just more blocks to place).
 */

import { oklabDistanceSquared } from "./color.ts";
import type { PaletteBlock } from "./palette.ts";
import type { Voxel } from "./shell.ts";

export interface ConsolidationResult {
  readonly voxels: readonly Voxel[];
  /** How many distinct blocks `voxels` used before consolidation. */
  readonly originalBlockCount: number;
  /** How many distinct blocks `voxels` uses after consolidation — `min(maxDistinctBlocks, originalBlockCount)`. */
  readonly consolidatedBlockCount: number;
  /** The mean Oklab distance between a re-matched voxel's ORIGINAL (dropped) block's color and the surviving block it was reassigned to — 0 when nothing was dropped. A rough, honest "how much did simplifying this cost" figure to show the user, not a claim about the true per-pixel target color (which isn't available at this stage — see this module's header comment on what "nearest" means here). */
  readonly averageColorErrorIntroduced: number;
}

/**
 * Caps a voxel grid to at most `maxDistinctBlocks` distinct block
 * types: keeps the `maxDistinctBlocks` MOST-USED blocks exactly as
 * they were, and reassigns every voxel that used a dropped block to
 * whichever SURVIVING block is nearest, in plain Oklab distance, to
 * the dropped block's own color.
 *
 * WHY: nothing upstream limits how many distinct blocks a build uses —
 * one texture can easily resolve to 50-80 of them, many used only two
 * or three times. For a tool whose output gets built by hand, one
 * block at a time, every distinct type is a separate trip to go find
 * and a separate thing to keep straight, for a visual difference that
 * is often negligible. This is a deliberately LAST step, run once on
 * the already-finished voxel grid, rather than baked into the matcher
 * itself — it only needs to know what got used and how often, which
 * the matcher can't know about any individual voxel until every voxel
 * has already been decided.
 *
 * "Nearest" is necessarily an approximation: a `Voxel` only remembers
 * which `PaletteBlock` it ended up with, not the original per-pixel
 * target color the matcher computed on the way there (recomputing that
 * would mean re-sampling the source texture here too). Using the
 * dropped block's own color as a stand-in for "what this voxel wanted"
 * is reasonable precisely because that block was already chosen as the
 * closest available match for it.
 *
 * Inputs: `voxels`, typically straight from `buildVoxelGrid`;
 * `maxDistinctBlocks`, a positive integer.
 * Output: see {@link ConsolidationResult}. A `maxDistinctBlocks` at or
 * above the grid's own distinct-block count is a no-op: the same
 * `voxels` array is returned unchanged (not a copy), `consolidatedBlockCount`
 * equals `originalBlockCount`, and `averageColorErrorIntroduced` is 0.
 * Failure mode: throws `RangeError` for a non-positive/non-integer
 * `maxDistinctBlocks`.
 */
/**
 * Picks which blocks survive the cap, by how much colour they save rather
 * than by how often they appear.
 *
 * WHY not simply the most-used: popularity says nothing about coverage. Two
 * near-identical greys used 500 times each would both survive while the one
 * block carrying a hue nothing else covers is dropped for being used 40
 * times — and every one of those 40 voxels then jumps to a colour that is
 * nowhere near it. Usage still matters, because an error is paid once per
 * voxel; it just is not the whole story.
 *
 * Greedy: seed with the most-used block, then repeatedly take whichever
 * candidate most reduces the total error everything else would suffer. That
 * is the standard k-medoids-style heuristic — not provably optimal, but
 * monotone, deterministic, and dramatically better than sorting by count.
 * Cost is `maxDistinctBlocks * candidates^2`, which at a cap of ~12 over the
 * few hundred distinct blocks a build can use is nothing.
 *
 * Error is counted as distance SQUARED, which is what makes it track how the
 * result looks. Summing plain distance rates 40 voxels pushed an
 * imperceptible 0.08 as worse than 5 voxels pushed a glaring 0.60, and would
 * drop the second to fix the first. Squaring says the opposite, and the eye
 * agrees: a handful of blocks in visibly the wrong colour ruins a wall that
 * a slight overall shift would not.
 */
function chooseSurvivors(
  countByBlockId: ReadonlyMap<string, number>,
  blockByBlockId: ReadonlyMap<string, PaletteBlock>,
  maxDistinctBlocks: number,
): PaletteBlock[] {
  // Sorted by usage first so the seed, and every tie after it, is
  // deterministic regardless of Map iteration order.
  const candidates = [...blockByBlockId.values()].sort(
    (a, b) => countByBlockId.get(b.blockId)! - countByBlockId.get(a.blockId)! || a.blockId.localeCompare(b.blockId),
  );

  const survivors = [candidates[0]!];
  // Each remaining block's distance to the nearest survivor so far, weighted
  // by how many voxels would pay it. Updated incrementally as survivors are
  // added rather than recomputed from scratch.
  const costByBlockId = new Map(
    candidates.map((block) => [
      block.blockId,
      countByBlockId.get(block.blockId)! * oklabDistanceSquared(block.color, survivors[0]!.color),
    ]),
  );

  while (survivors.length < maxDistinctBlocks) {
    let best: PaletteBlock | undefined;
    let bestSaving = -1;
    for (const candidate of candidates) {
      if (survivors.includes(candidate)) continue;
      let saving = 0;
      for (const other of candidates) {
        const improved =
          costByBlockId.get(other.blockId)! -
          countByBlockId.get(other.blockId)! * oklabDistanceSquared(other.color, candidate.color);
        if (improved > 0) saving += improved;
      }
      // Strictly greater, so the first candidate in the usage-sorted order
      // wins any tie and the result stays deterministic.
      if (saving > bestSaving) {
        bestSaving = saving;
        best = candidate;
      }
    }
    if (best === undefined) break; // unreachable: candidates outnumber survivors here
    survivors.push(best);
    for (const other of candidates) {
      const viaBest = countByBlockId.get(other.blockId)! * oklabDistanceSquared(other.color, best.color);
      if (viaBest < costByBlockId.get(other.blockId)!) costByBlockId.set(other.blockId, viaBest);
    }
  }

  return survivors;
}

export function consolidateVoxels(voxels: readonly Voxel[], maxDistinctBlocks: number): ConsolidationResult {
  if (!Number.isInteger(maxDistinctBlocks) || maxDistinctBlocks < 1) {
    throw new RangeError(`maxDistinctBlocks must be a positive integer, got ${maxDistinctBlocks}`);
  }

  // One usage count and one representative PaletteBlock object per
  // blockId — voxels sharing a blockId always share the same color
  // (domain/palette.ts resolves exactly one canonical variant per
  // block id for a given build), so any one of them is representative.
  const countByBlockId = new Map<string, number>();
  const blockByBlockId = new Map<string, PaletteBlock>();
  for (const voxel of voxels) {
    const { blockId } = voxel.paletteBlock;
    countByBlockId.set(blockId, (countByBlockId.get(blockId) ?? 0) + 1);
    if (!blockByBlockId.has(blockId)) blockByBlockId.set(blockId, voxel.paletteBlock);
  }

  const originalBlockCount = blockByBlockId.size;
  if (originalBlockCount <= maxDistinctBlocks) {
    return { voxels, originalBlockCount, consolidatedBlockCount: originalBlockCount, averageColorErrorIntroduced: 0 };
  }

  const survivors = chooseSurvivors(countByBlockId, blockByBlockId, maxDistinctBlocks);
  const survivingBlockIds = new Set(survivors.map((block) => block.blockId));

  let totalErrorIntroduced = 0;
  let voxelsRematched = 0;
  const consolidatedVoxels = voxels.map((voxel) => {
    if (survivingBlockIds.has(voxel.paletteBlock.blockId)) return voxel;

    let nearestSurvivor = survivors[0]!;
    let nearestDistanceSquared = oklabDistanceSquared(voxel.paletteBlock.color, nearestSurvivor.color);
    for (let i = 1; i < survivors.length; i++) {
      const candidate = survivors[i]!;
      const distanceSquared = oklabDistanceSquared(voxel.paletteBlock.color, candidate.color);
      if (distanceSquared < nearestDistanceSquared) {
        nearestSurvivor = candidate;
        nearestDistanceSquared = distanceSquared;
      }
    }
    totalErrorIntroduced += Math.sqrt(nearestDistanceSquared);
    voxelsRematched++;
    return { ...voxel, paletteBlock: nearestSurvivor };
  });

  return {
    voxels: consolidatedVoxels,
    originalBlockCount,
    consolidatedBlockCount: survivingBlockIds.size,
    averageColorErrorIntroduced: voxelsRematched === 0 ? 0 : totalErrorIntroduced / voxelsRematched,
  };
}
