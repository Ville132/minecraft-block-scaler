import { oklabToRgb8, type Oklab } from "../domain/color.ts";

/** A CSS `rgb()` string for displaying a palette block's representative color as a small swatch. Trivial composition of already-tested conversions — no dedicated test. */
export function swatchColor(color: Oklab): string {
  const { r, g, b } = oklabToRgb8(color);
  return `rgb(${r}, ${g}, ${b})`;
}
