/**
 * Keeps a source texture's own light/dark pattern from collapsing into
 * a single near-flat block during nearest-match — see
 * {@link stretchLightness}'s doc comment for the mechanism, and
 * BACKLOG.md 2.1 for the original bug report this addresses ("most of
 * it was one color").
 */

import type { Oklab } from "./color.ts";

export interface LightnessRange {
  readonly min: number;
  readonly max: number;
}

/** Failure mode: throws `RangeError` for an empty input — a lightness range needs at least one sample to be meaningful. */
export function lightnessRangeOf(colors: readonly Oklab[]): LightnessRange {
  if (colors.length === 0) {
    throw new RangeError("lightnessRangeOf requires at least one color");
  }
  let min = Infinity;
  let max = -Infinity;
  for (const color of colors) {
    if (color.L < min) min = color.L;
    if (color.L > max) max = color.L;
  }
  return { min, max };
}

/**
 * Linearly remaps `color`'s lightness from its relative position within
 * `sourceRange` to the same relative position within `targetRange`,
 * leaving a/b (hue and chroma) untouched.
 *
 * WHY lightness only: the contrast this exists to preserve — bark
 * grain, cobblestone speckle, deepslate mottling — is overwhelmingly a
 * light/dark pattern, not a hue pattern; stretching a/b too would risk
 * inventing color shifts nothing in the source actually has.
 *
 * WHY stretch at all: nearest-match picks each pixel's single closest
 * available candidate independently. When the enabled palette's
 * candidates near the source's own (possibly narrow) lightness range
 * are sparse, pixels spanning a real light/dark pattern can all land on
 * the very same nearest candidate, flattening the pattern even though
 * the palette AS A WHOLE spans a much wider range than this particular
 * texture ever uses. Stretching the texture's own range to use more of
 * what the palette can actually reach spreads those pixels across more
 * distinct candidates, trading absolute color accuracy (the stretched
 * value is no longer the texture's literal color) for the pattern a
 * giant replica is actually recognized by — nobody judges a giant log's
 * absolute hue against anything; everybody recognizes the bark pattern.
 *
 * Degenerate inputs are handled, not rejected: a perfectly flat source
 * (`sourceRange.min === sourceRange.max`, e.g. a texture with no
 * internal variation at all) has nothing to stretch, so `color` is
 * returned unchanged rather than dividing by zero. A collapsed target
 * (every candidate the same lightness) correctly maps every input to
 * that single value.
 */
export function stretchLightness(color: Oklab, sourceRange: LightnessRange, targetRange: LightnessRange): Oklab {
  const sourceSpan = sourceRange.max - sourceRange.min;
  if (sourceSpan <= 0) return color;
  const t = (color.L - sourceRange.min) / sourceSpan;
  return { ...color, L: targetRange.min + t * (targetRange.max - targetRange.min) };
}

export interface ContrastHeadroom {
  /** The widest per-face lightness span found across the source block's own faces. */
  readonly sourceLightnessSpan: number;
  readonly paletteLightnessSpan: number;
  /** True when some face of the source block has more lightness range than the enabled palette can reach at all — the honest case where stretching can reduce the damage but not eliminate it, no matter how matching is tuned. The fix is enabling more blocks, not a better algorithm. */
  readonly isPaletteLimited: boolean;
}

/**
 * Compares a source block's own per-face lightness ranges against what
 * the enabled palette can reach — see {@link ContrastHeadroom}. Reports
 * the WORST face (the one with the widest range) rather than an average
 * or a total across faces, since any single face that outstrips the
 * palette is a real, visible loss of detail on that face, regardless of
 * how the other five faces look.
 *
 * Inputs: `sourceColorsByFace`, one color population per face (this
 * module has no opinion on how a caller samples a texture into colors,
 * only on what to do with the result); `paletteColors`, every enabled
 * candidate's own representative color. Both must be non-empty.
 */
export function assessContrastHeadroom(
  sourceColorsByFace: readonly (readonly Oklab[])[],
  paletteColors: readonly Oklab[],
): ContrastHeadroom {
  const paletteRange = lightnessRangeOf(paletteColors);
  const paletteLightnessSpan = paletteRange.max - paletteRange.min;

  let sourceLightnessSpan = 0;
  for (const faceColors of sourceColorsByFace) {
    const faceRange = lightnessRangeOf(faceColors);
    const span = faceRange.max - faceRange.min;
    if (span > sourceLightnessSpan) sourceLightnessSpan = span;
  }

  return {
    sourceLightnessSpan,
    paletteLightnessSpan,
    isPaletteLimited: sourceLightnessSpan > paletteLightnessSpan,
  };
}
