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

import { createMatcher, oklabDistance, type MatchOptions, type Oklab, type ScoredCandidate } from "./color.ts";

interface MutableLab {
  L: number;
  a: number;
  b: number;
}

/** Pulls `cell` back toward `anchor` until it is no farther than `maxDrift` away (Oklab distance), keeping its direction; a no-op when it is already within reach. A `maxDrift` of 0 pins the cell to `anchor` exactly. */
function limitDrift(cell: MutableLab, anchor: Oklab, maxDrift: number): void {
  const deltaL = cell.L - anchor.L;
  const deltaA = cell.a - anchor.a;
  const deltaB = cell.b - anchor.b;
  const drift = Math.hypot(deltaL, deltaA, deltaB);
  if (drift <= maxDrift) return;
  const scale = maxDrift / drift;
  cell.L = anchor.L + deltaL * scale;
  cell.a = anchor.a + deltaA * scale;
  cell.b = anchor.b + deltaB * scale;
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
 * Each cell is also kept on a leash before it is matched: its working
 * target (its own target plus whatever error was diffused onto it) is
 * pulled back until it is no farther from the cell's own target than the
 * best block for the cell's TRUE color is from that color, and the error
 * is then measured from the pulled-back color, so the excess is discarded
 * instead of diffused on.
 *
 * WHY a leash at all: error diffusion only converges for a target the
 * palette can actually reach. For one outside every block's reach — a more
 * saturated orange than any orange block, say — the error always points
 * the same way, each cell hands the next one more of it, and the working
 * target runs away until some distant block (white, for orange) finally
 * counts as nearest: a stray pale block in the middle of the face. Seen
 * for real: 3 quartz blocks in a 16x16 orange face whose nearest block was
 * 0.025 away and whose quartz was 0.354 away.
 *
 * WHY relative to the best block's distance, not a constant: dithering
 * approximates a color BETWEEN sparse blocks by alternating them, so the
 * swing it needs scales with how far apart the blocks are — a mid-gray
 * against only black and white must swing by ~0.2, an orange with a block
 * 0.025 away has no reason to swing more than a few hundredths. The flip
 * side, by design: where a block already matches well there is no gap to
 * bridge and dithering stays out of the way instead of speckling, and a
 * target in the first quarter of the way from one block to the next stays
 * on the nearer block.
 *
 * WHY the TRUE color and not the target: a caller may deliberately shift
 * its targets (contrast enhancement pushes pixels toward the palette's
 * extremes), and a shifted target is farther from every block than its
 * true color is. Sizing the leash from it would reward the shift with a
 * longer leash when the shift is exactly what put the target out of reach.
 *
 * Every individual decision goes through `color.ts`'s `createMatcher` —
 * the SAME rule the undithered path uses, not a copy of it. Dithering
 * only changes WHICH target each cell is matched against (the original
 * plus whatever error was diffused onto it), never how a target becomes
 * a block, so the two modes can disagree about which block a position
 * lands on but never about what they were each aiming for. A copy of an
 * intricate rule like the colour-tolerance band would silently drift.
 *
 * Inputs: `targets`, row-major Oklab colors (`targets.length` must be a
 * positive multiple of `width`); `candidates`, the fill-material pool
 * (non-empty); `options`, forwarded to the shared matcher; `trueColors`,
 * the colors `targets` were derived from, one per target, when they were
 * deliberately shifted (defaults to `targets` themselves).
 * Output: one candidate's `item` per target cell, same row-major order.
 * Failure modes: throws `RangeError` for an empty `candidates` list or an
 * invalid `options.colorTolerance`, if `width` does not evenly and
 * positively divide `targets.length`, or if `trueColors` is not the same
 * length as `targets`.
 * Fully deterministic — no randomness anywhere in the algorithm.
 */
export function ditherGrid<T>(
  targets: readonly Oklab[],
  width: number,
  candidates: readonly ScoredCandidate<T>[],
  options: MatchOptions,
  trueColors: readonly Oklab[] = targets,
): T[] {
  if (candidates.length === 0) {
    throw new RangeError("ditherGrid requires at least one candidate");
  }
  if (!Number.isInteger(width) || width <= 0 || targets.length === 0 || targets.length % width !== 0) {
    throw new RangeError(
      `targets.length (${targets.length}) must be a positive multiple of a positive integer width (got width=${width})`,
    );
  }
  if (trueColors.length !== targets.length) {
    throw new RangeError(
      `trueColors.length (${trueColors.length}) must equal targets.length (${targets.length})`,
    );
  }
  const height = targets.length / width;
  const match = createMatcher(candidates, options);

  const working: MutableLab[] = targets.map((target) => ({ L: target.L, a: target.a, b: target.b }));
  const chosen = new Array<T>(targets.length);

  for (let row = 0; row < height; row++) {
    const scanningLeftToRight = row % 2 === 0;
    for (let step = 0; step < width; step++) {
      const col = scanningLeftToRight ? step : width - 1 - step;
      const index = row * width + col;
      const cell = working[index]!;
      const trueColor = trueColors[index]!;
      limitDrift(cell, targets[index]!, oklabDistance(trueColor, match(trueColor).color));
      const target: Oklab = { L: Math.min(1, Math.max(0, cell.L)), a: cell.a, b: cell.b };

      const best = match(target);
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
