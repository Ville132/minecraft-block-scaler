/**
 * Optional contrast enhancement for a source block's faces.
 *
 * Matching in this app is ABSOLUTE by default: a source pixel resolves to
 * the block whose color is nearest to that pixel's real color, and
 * nothing else. This module exists for the one case where that reads as
 * too flat — a texture with very little internal light/dark variation of
 * its own, which nearest-match can collapse onto one or two blocks — and
 * it can only ever EXAGGERATE variation around a face's own average,
 * never move the average itself. See {@link amplifyLightness}.
 *
 * Why the palette is deliberately not a parameter of anything here: this
 * module used to REMAP each face's lightness range onto the whole
 * palette's lightness range ("contrast preservation", always on). On any
 * narrow, saturated texture that pushed pixels all the way to the
 * palette's lightness extremes — and since those extremes are near-
 * neutral by construction (white and black concrete), a bright-orange
 * acacia log came out white and a dark-brown mangrove log came out with
 * white in it. Hue never had a chance: the equally-weighted Oklab
 * distance let a manufactured lightness shift of up to ~0.8 dwarf the
 * palette's entire colour spread (~0.15). With no palette input anywhere
 * in this module, that mistake can't be written again without changing a
 * signature.
 */

import type { Oklab } from "./color.ts";

/** No enhancement: every pixel matches its own, true color. The default. */
export const DEFAULT_CONTRAST_GAIN = 1;

/**
 * Failure mode: throws `RangeError` unless `gain` is finite and at least
 * 1. A gain below 1 would COMPRESS lightness toward the face's mean — a
 * different feature, and a gain of 0 would flatten a whole face to one
 * color — so it is rejected loudly rather than quietly accepted.
 *
 * Called once per build, never per pixel.
 */
export function assertContrastGain(gain: number): void {
  if (!Number.isFinite(gain) || gain < 1) {
    throw new RangeError(`contrastGain must be a finite number of at least 1, got ${gain}`);
  }
}

/**
 * Exaggerates a color's lightness around `faceMeanLightness` — the mean
 * lightness of the face the color came from — by `gain`:
 * `L' = faceMeanLightness + (L - faceMeanLightness) * gain`, clamped to
 * Oklab's `[0, 1]` lightness range. `a`/`b` (hue and chroma) are never
 * touched.
 *
 * The face's average color is invariant under any gain: pixels lighter
 * than the mean move further up and pixels darker move further down by
 * the same factor, so the mean stays exactly where it was. A face with
 * no internal variation (every pixel at the mean) is therefore left
 * unchanged at every gain. And `gain === 1` returns `color` itself, so
 * the default path is provably free and provably a no-op.
 *
 * WHY lightness only: the contrast this exists to bring out — bark
 * grain, cobblestone speckle, ring patterns — is overwhelmingly a
 * light/dark pattern, not a hue one; stretching `a`/`b` too would invent
 * color shifts nothing in the source actually has.
 *
 * WHY clamp to `[0, 1]` and not to the palette's range: nothing here may
 * know about the palette (see this module's header). `[0, 1]` is only
 * the physical bound of the Oklab lightness axis — the same one
 * `dither.ts` applies to its working cells, for the same reason.
 *
 * Callers should keep `gain` modest (the UI stops at 2): amplifying far
 * enough pushes a face's darkest and lightest pixels out of their own
 * color family, which defeats the purpose.
 */
export function amplifyLightness(color: Oklab, faceMeanLightness: number, gain: number): Oklab {
  if (gain === 1) return color;
  const amplified = faceMeanLightness + (color.L - faceMeanLightness) * gain;
  return { ...color, L: Math.min(1, Math.max(0, amplified)) };
}

/**
 * Below this lightness span (brightest pixel's `L` minus darkest
 * pixel's), a face with ANY pattern at all counts as faint enough that
 * contrast enhancement is worth suggesting. A hand-picked UI threshold,
 * not a derived constant: about an eighth of the full lightness axis,
 * which is a handful of adjacent shades of one wood or one stone.
 */
export const LOW_CONTRAST_SPAN_THRESHOLD = 0.12;

export interface ContrastHeadroom {
  /** The lightness span of the faintest face that has ANY internal pattern; `null` when every face is perfectly flat (there is nothing for contrast enhancement to amplify). Perfectly flat faces are skipped on purpose: gain scales deviation from the face mean, and a flat face has none. */
  readonly faintestPatternSpan: number | null;
  /** True when {@link faintestPatternSpan} is below {@link LOW_CONTRAST_SPAN_THRESHOLD} — some face has a pattern, but a faint one, so the replica of it will read as nearly flat. That is exactly what contrast enhancement is for. */
  readonly isLowContrast: boolean;
}

/**
 * Reports whether any face of the source block has a pattern faint
 * enough that contrast enhancement would help — see
 * {@link ContrastHeadroom}.
 *
 * Reports the FAINTEST face (not the most varied one, not an average):
 * the question is "is there a face this would help?", and one faint
 * face is enough to answer yes regardless of how busy the other five
 * are. A block's end grain is the usual case — rings of nearly the same
 * orange — next to a much busier bark.
 *
 * Inputs: `faceLightnessSpans`, one non-negative span per face (this
 * module has no opinion on how a caller measures a texture, only on what
 * to make of the result).
 */
export function assessContrastHeadroom(faceLightnessSpans: readonly number[]): ContrastHeadroom {
  let faintestPatternSpan: number | null = null;
  for (const span of faceLightnessSpans) {
    if (span <= 0) continue;
    if (faintestPatternSpan === null || span < faintestPatternSpan) faintestPatternSpan = span;
  }
  return {
    faintestPatternSpan,
    isLowContrast: faintestPatternSpan !== null && faintestPatternSpan < LOW_CONTRAST_SPAN_THRESHOLD,
  };
}
