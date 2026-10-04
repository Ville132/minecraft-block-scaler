/**
 * Floyd-Steinberg error-diffusion dithering over a 2D grid of target
 * colors. Pure and generic — knows nothing about textures, voxels, or
 * `PaletteBlock`; `shell.ts` supplies the grid and reads the result back
 * into its own per-face structure (see that module's `buildDitheredFaceGrid`).
 *
 * WHY: a plain nearest-match (see `color.ts`'s `findBestMatch`) always
 * makes the SAME error at every pixel of a given color when no single
 * candidate hits it exactly — a smooth gradient collapses into hard
 * bands, each one flatly wrong by the same amount. Diffusing each
 * pixel's leftover error onto its not-yet-decided neighbours lets
 * adjacent pixels alternate between two (or more) candidates so that an
 * AREA's average color converges on the true target, trading a flat,
 * uniformly-off look up close for one that is more accurate from a
 * normal viewing distance but speckled up close — the standard
 * image-dithering tradeoff, applied here to picking real materials
 * rather than screen pixels.
 */

import { oklabDistanceSquared, type Oklab } from "./color.ts";

export interface DitherCandidate<T> {
  readonly color: Oklab;
  /** Same meaning as `color.ts`'s `findBestMatch` — see `DitherOptions.varianceWeight`. */
  readonly variance: number;
  readonly item: T;
}

export interface DitherOptions {
  /** Identical in meaning to `color.ts`'s `findBestMatch`'s `varianceWeight` — dithering still accounts for a candidate's own texture noise at every decision; it additionally diffuses whatever color error is LEFT onto not-yet-decided neighbours, rather than discarding it. */
  readonly varianceWeight: number;
}

interface MutableLab {
  L: number;
  a: number;
  b: number;
}

/** Mutates `grid[index]` by adding a weighted error, or does nothing if `index` names a cell outside the grid — out-of-bounds weight is simply discarded, not renormalized onto the remaining neighbours. That is a one-cell-wide loss along each border, a fair trade for not special-casing every edge and corner differently. */
function diffuseErrorInto(
  grid: readonly (MutableLab | undefined)[],
  index: number,
  errorL: number,
  errorA: number,
  errorB: number,
  weight: number,
): void {
  const cell = grid[index];
  if (cell === undefined) return;
  cell.L += errorL * weight;
  cell.a += errorA * weight;
  cell.b += errorB * weight;
}

/**
 * Picks one candidate per cell of a row-major 2D target-color grid via
 * Floyd-Steinberg dithering: serpentine scan (alternating left-to-right
 * and right-to-left per row, so error always diffuses into
 * not-yet-visited cells), the standard 7/16 (ahead) - 3/16
 * (behind-diagonal, next row) - 5/16 (straight ahead, next row) - 1/16
 * (ahead-diagonal, next row) kernel, mirrored horizontally on
 * right-to-left rows so "ahead" and "behind" always mean scan order, not
 * a fixed screen direction.
 *
 * Each cell's own target is clamped to `L` in `[0, 1]` before matching —
 * accumulated error could otherwise push a cell's working lightness
 * outside any color a real candidate could ever have, chasing an
 * impossible target instead of converging. `a`/`b` (chroma) are left
 * unclamped: Oklab does not define a comparable hard bound for them.
 *
 * Inputs: `targets`, row-major Oklab colors (`targets.length` must be a
 * positive multiple of `width`); `candidates`, the fill-material pool
 * (non-empty); `options`.
 * Output: one candidate's `item` per target cell, same row-major order.
 * Failure modes: throws `RangeError` for an empty `candidates` list, or
 * if `width` does not evenly and positively divide `targets.length`.
 * Fully deterministic — no randomness anywhere in the algorithm.
 */
export function ditherGrid<T>(
  targets: readonly Oklab[],
  width: number,
  candidates: readonly DitherCandidate<T>[],
  options: DitherOptions,
): T[] {
  if (candidates.length === 0) {
    throw new RangeError("ditherGrid requires at least one candidate");
  }
  if (!Number.isInteger(width) || width <= 0 || targets.length === 0 || targets.length % width !== 0) {
    throw new RangeError(
      `targets.length (${targets.length}) must be a positive multiple of a positive integer width (got width=${width})`,
    );
  }
  const height = targets.length / width;

  const working: MutableLab[] = targets.map((target) => ({ L: target.L, a: target.a, b: target.b }));
  const chosen = new Array<T>(targets.length);

  for (let row = 0; row < height; row++) {
    const scanningLeftToRight = row % 2 === 0;
    for (let step = 0; step < width; step++) {
      const col = scanningLeftToRight ? step : width - 1 - step;
      const index = row * width + col;
      const cell = working[index]!;
      const target: Oklab = { L: Math.min(1, Math.max(0, cell.L)), a: cell.a, b: cell.b };

      let best = candidates[0]!;
      let bestCost = oklabDistanceSquared(target, best.color) + options.varianceWeight * best.variance;
      for (let i = 1; i < candidates.length; i++) {
        const candidate = candidates[i]!;
        const cost = oklabDistanceSquared(target, candidate.color) + options.varianceWeight * candidate.variance;
        if (cost < bestCost) {
          best = candidate;
          bestCost = cost;
        }
      }
      chosen[index] = best.item;

      const errorL = cell.L - best.color.L;
      const errorA = cell.a - best.color.a;
      const errorB = cell.b - best.color.b;
      const ahead = scanningLeftToRight ? 1 : -1;
      const aheadCol = col + ahead;
      const behindCol = col - ahead;
      const nextRow = row + 1;

      if (aheadCol >= 0 && aheadCol < width) {
        diffuseErrorInto(working, index + ahead, errorL, errorA, errorB, 7 / 16);
      }
      if (nextRow < height) {
        const nextRowIndex = nextRow * width;
        if (behindCol >= 0 && behindCol < width) {
          diffuseErrorInto(working, nextRowIndex + behindCol, errorL, errorA, errorB, 3 / 16);
        }
        diffuseErrorInto(working, nextRowIndex + col, errorL, errorA, errorB, 5 / 16);
        if (aheadCol >= 0 && aheadCol < width) {
          diffuseErrorInto(working, nextRowIndex + aheadCol, errorL, errorA, errorB, 1 / 16);
        }
      }
    }
  }

  return chosen;
}
