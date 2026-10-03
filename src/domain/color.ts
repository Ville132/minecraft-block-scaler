/**
 * Color conversions for matching build blocks to texture pixels.
 *
 * Two choices drive this module, both load-bearing for how convincing
 * the final replica looks (see PLAN.md's "Colour pipeline" section):
 *
 * 1. Pixels are averaged in LINEAR light, never in gamma-encoded sRGB.
 *    Averaging sRGB bytes directly darkens midtones, because sRGB
 *    compresses the upper half of the brightness range into a smaller
 *    numeric span than it occupies perceptually.
 * 2. Palette matching is nearest-neighbour in Oklab, not raw RGB
 *    distance. Oklab's axes are built to match human perceptual
 *    difference, so equal distances in Oklab look like roughly equal
 *    differences in color — RGB distance does not have that property
 *    and picks visibly wrong blocks for some hues.
 *
 * Oklab conversion constants are Björn Ottosson's published Oklab
 * matrices (https://bottosson.github.io/posts/oklab/).
 */

export interface Rgb8 {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Each channel in [0, 1], linear light (no gamma curve). */
export interface LinearRgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface Oklab {
  readonly L: number;
  readonly a: number;
  readonly b: number;
}

function assertUnitRange(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be a finite number in [0, 1], got ${value}`);
  }
}

function assertByteRange(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new RangeError(`${label} must be an integer in [0, 255], got ${value}`);
  }
}

/** The sRGB electro-optical transfer function for one channel in [0, 1]. */
export function srgbToLinearChannel(channel: number): number {
  assertUnitRange(channel, "channel");
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** The inverse of {@link srgbToLinearChannel}. */
export function linearToSrgbChannel(channel: number): number {
  assertUnitRange(channel, "channel");
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
}

/** Converts 8-bit sRGB (as decoded straight from a PNG) to linear light. */
export function rgb8ToLinearRgb(rgb: Rgb8): LinearRgb {
  assertByteRange(rgb.r, "r");
  assertByteRange(rgb.g, "g");
  assertByteRange(rgb.b, "b");
  return {
    r: srgbToLinearChannel(rgb.r / 255),
    g: srgbToLinearChannel(rgb.g / 255),
    b: srgbToLinearChannel(rgb.b / 255),
  };
}

/** The inverse of {@link rgb8ToLinearRgb}, rounding to the nearest byte and clamping to [0, 255] in case of small numerical overshoot from a round-tripped Oklab value. */
export function linearRgbToRgb8(linear: LinearRgb): Rgb8 {
  const toByte = (channel: number): number => {
    const srgb = linearToSrgbChannel(Math.min(1, Math.max(0, channel)));
    return Math.round(srgb * 255);
  };
  return { r: toByte(linear.r), g: toByte(linear.g), b: toByte(linear.b) };
}

/** The mean of linear-light samples, per channel — the only correct way to average pixel colors (see this module's header comment). Throws on an empty input, since the mean of nothing is undefined, not zero. */
export function averageLinearRgb(samples: readonly LinearRgb[]): LinearRgb {
  if (samples.length === 0) {
    throw new RangeError("averageLinearRgb requires at least one sample");
  }
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  for (const sample of samples) {
    rSum += sample.r;
    gSum += sample.g;
    bSum += sample.b;
  }
  return { r: rSum / samples.length, g: gSum / samples.length, b: bSum / samples.length };
}

export function linearRgbToOklab(linear: LinearRgb): Oklab {
  const l = 0.4122214708 * linear.r + 0.5363325363 * linear.g + 0.0514459929 * linear.b;
  const m = 0.2119034982 * linear.r + 0.6806995451 * linear.g + 0.1073969566 * linear.b;
  const s = 0.0883024619 * linear.r + 0.2817188376 * linear.g + 0.6299787005 * linear.b;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

/** The inverse of {@link linearRgbToOklab}. */
export function oklabToLinearRgb(lab: Oklab): LinearRgb {
  const l_ = lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b;
  const m_ = lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
  const s_ = lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

/** Convenience composition of {@link rgb8ToLinearRgb} + {@link linearRgbToOklab}. */
export function rgb8ToOklab(rgb: Rgb8): Oklab {
  return linearRgbToOklab(rgb8ToLinearRgb(rgb));
}

/** Convenience composition of {@link oklabToLinearRgb} + {@link linearRgbToRgb8}. */
export function oklabToRgb8(lab: Oklab): Rgb8 {
  return linearRgbToRgb8(oklabToLinearRgb(lab));
}

/** Plain Euclidean distance in Oklab space — Oklab is designed so this already tracks perceptual difference, with no further weighting needed. */
export function oklabDistance(a: Oklab, b: Oklab): number {
  const dL = a.L - b.L;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

/**
 * Finds the closest-matching candidate to `target` by Oklab distance.
 *
 * Inputs: `target`, the color to match; `candidates`, each paired with
 * the item it should resolve to if nearest.
 * Output: the nearest candidate's `item`.
 * Failure mode: throws `RangeError` on an empty candidate list, rather
 * than returning a meaningless default match.
 */
export function findNearestOklab<T>(
  target: Oklab,
  candidates: readonly { readonly color: Oklab; readonly item: T }[],
): T {
  if (candidates.length === 0) {
    throw new RangeError("findNearestOklab requires at least one candidate");
  }
  let best = candidates[0]!;
  let bestDistance = oklabDistance(target, best.color);
  for (let i = 1; i < candidates.length; i++) {
    const candidate = candidates[i]!;
    const distance = oklabDistance(target, candidate.color);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best.item;
}
