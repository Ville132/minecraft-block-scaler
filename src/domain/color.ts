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

/** The mean of Oklab samples, per channel — averaging directly within Oklab space rather than averaging in linear light and converting the result, which (because of Oklab's cube-root nonlinearity) is a different point. See `palette.ts`'s `representativeAppearance` for why that distinction matters. Throws on an empty input, for the same reason as {@link averageLinearRgb}. */
export function averageOklab(samples: readonly Oklab[]): Oklab {
  if (samples.length === 0) {
    throw new RangeError("averageOklab requires at least one sample");
  }
  let lSum = 0;
  let aSum = 0;
  let bSum = 0;
  for (const sample of samples) {
    lSum += sample.L;
    aSum += sample.a;
    bSum += sample.b;
  }
  return { L: lSum / samples.length, a: aSum / samples.length, b: bSum / samples.length };
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

/** Squared Euclidean distance in Oklab space — avoids a `sqrt` when only relative ordering matters (e.g. nearest-match). */
export function oklabDistanceSquared(a: Oklab, b: Oklab): number {
  const dL = a.L - b.L;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return dL * dL + da * da + db * db;
}

/** Plain Euclidean distance in Oklab space — Oklab is designed so this already tracks perceptual difference, with no further weighting needed. */
export function oklabDistance(a: Oklab, b: Oklab): number {
  return Math.sqrt(oklabDistanceSquared(a, b));
}

export interface ScoredCandidate<T> {
  readonly color: Oklab;
  /** Mean squared Oklab distance of this candidate's own texture pixels from its `color` — how visually "busy" it is. 0 for a perfectly flat texture. */
  readonly variance: number;
  /** A small, unitless acquisition-cost score — how much harder this candidate is to gather at the scale of a real build, relative to an ordinary block (0). Only ever a tie-break between candidates already tied on both color band AND flatness (see {@link createMatcher}), never a reason to prefer a worse color or a busier texture. Omitted (treated as 0) by every caller that has no concept of cost. */
  readonly acquisitionCost?: number;
  readonly item: T;
}

/**
 * The default {@link MatchOptions.colorTolerance}: 0.02 Oklab distance —
 * on the order of one just-noticeable difference, the scale Oklab was
 * designed around (roughly the smallest difference most people can see
 * between two flat colors placed side by side). A block that close to
 * the best color match is, to a human eye, an equally good match, so
 * spending that much color accuracy to get a flatter texture is a trade
 * almost nobody would notice.
 */
export const DEFAULT_COLOR_TOLERANCE = 0.02;

/**
 * Variances closer together than this count as equally flat. 1e-6 is a
 * mean squared deviation of 0.001 Oklab — twenty times below one
 * just-noticeable difference — so two textures this close look equally
 * clean to any eye, and the gap between them is not a reason to prefer one.
 *
 * WHY it exists at all: a perfectly flat texture's measured variance is
 * not reliably 0. Its mean is a sum divided by a pixel count, which can
 * land one ulp away from the (identical) pixels, leaving a variance near
 * 1e-33 for one flat block and exactly 0 for the next. Compared exactly,
 * that noise would pick between equally flat concrete, terracotta or wool
 * blocks and ignore which of them is nearer in color.
 */
const VARIANCE_RESOLUTION = 1e-6;

/** `variance` in whole {@link VARIANCE_RESOLUTION} steps, so equally flat textures compare equal and the ordering stays transitive. */
function flatnessLevelOf(variance: number): number {
  return Math.round(variance / VARIANCE_RESOLUTION);
}

export interface MatchOptions {
  /**
   * How much WORSE than the single nearest color a candidate may be, in
   * Oklab distance units, and still count as an equally good match —
   * i.e. how much color accuracy may be traded for a flatter texture.
   * `0` is plain nearest-color matching: texture busyness only ever
   * breaks an exact color tie. Must be finite and non-negative.
   */
  readonly colorTolerance: number;
}

/**
 * Binds `candidates` and `options` once and returns a matcher: given a
 * target color, it returns the candidate that best stands in for it.
 * Color decides FIRST; texture busyness only breaks ties the eye
 * couldn't tell apart:
 *
 * 1. Find the candidate nearest to `target` — distance `d`.
 * 2. Keep every candidate within `d + colorTolerance` of `target`.
 * 3. Among those, pick the flattest texture (lowest `variance`, compared
 *    at {@link VARIANCE_RESOLUTION} — float noise is not flatness).
 * 4. Ties: the cheaper (`acquisitionCost`), then the nearer in color,
 *    then whichever is listed first — so the result is fully
 *    deterministic and never depends on iteration quirks.
 *
 * WHY not a weighted sum: this used to score `distance² + w·variance`,
 * which looked principled (it is the bias-variance decomposition of the
 * expected squared error of using a candidate as a single-color
 * stand-in) but is a bad fit for how close real matches are. A good
 * color match has `distance²` around 0.00003 while a texture's
 * `variance` is routinely 0.001–0.05 — an order of magnitude larger —
 * so among all reasonably close colors the variance term alone decided
 * the winner, and a block with 5× the color error could win simply for
 * having a flatter texture. A tolerance band keeps the useful part of
 * that idea (prefer a clean texture when the colors are equally good)
 * while making it impossible to trade a visibly wrong color for it: the
 * most color accuracy that can ever be given up is exactly
 * `colorTolerance`, a number with a physical meaning instead of an
 * abstract weight.
 *
 * Known property, by design: the rule is discontinuous in `target`. A
 * flat candidate sitting right at the band's edge can win for one
 * target and lose for a nearly identical neighbouring one, so two
 * adjacent voxels of almost the same color may resolve to different
 * (but equally good) blocks. The color error this can introduce is
 * bounded by `colorTolerance` by construction.
 *
 * Why this is a factory: the nearest-candidate search needs every
 * distance before the band can be defined, so each match is two passes.
 * Binding the pool once lets the matcher own a single scratch buffer for
 * the distances instead of allocating one per call, which matters when
 * this runs once per distinct texture cell of every face of a build.
 *
 * Failure modes: throws `RangeError` on an empty candidate list (rather
 * than returning a meaningless default match), or on a `colorTolerance`
 * that is negative or not finite.
 */
export function createMatcher<T>(
  candidates: readonly ScoredCandidate<T>[],
  options: MatchOptions,
): (target: Oklab) => ScoredCandidate<T> {
  if (candidates.length === 0) {
    throw new RangeError("createMatcher requires at least one candidate");
  }
  const { colorTolerance } = options;
  if (!Number.isFinite(colorTolerance) || colorTolerance < 0) {
    throw new RangeError(`colorTolerance must be a finite, non-negative number, got ${colorTolerance}`);
  }

  const squaredDistances = new Float64Array(candidates.length);
  const flatnessLevels = Float64Array.from(candidates, (candidate) => flatnessLevelOf(candidate.variance));

  return (target) => {
    let nearestIndex = 0;
    let nearestSquared = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const squared = oklabDistanceSquared(target, candidates[i]!.color);
      squaredDistances[i] = squared;
      if (squared < nearestSquared) {
        nearestSquared = squared;
        nearestIndex = i;
      }
    }

    // At tolerance 0 the band is exactly the nearest distance: skipping
    // the sqrt-and-square round trip is not just faster, it is what
    // keeps the band from ever excluding its own argmin — `sqrt(x) ** 2`
    // can land one ulp BELOW `x`.
    const bandLimitSquared =
      colorTolerance === 0 ? nearestSquared : (Math.sqrt(nearestSquared) + colorTolerance) ** 2;

    // Seeded with the nearest candidate, so the chosen candidate is a
    // member of its own band by construction regardless of arithmetic.
    let chosen = candidates[nearestIndex]!;
    let chosenSquared = nearestSquared;
    let chosenFlatness = flatnessLevels[nearestIndex]!;
    let chosenCost = chosen.acquisitionCost ?? 0;

    for (let i = 0; i < candidates.length; i++) {
      const squared = squaredDistances[i]!;
      if (i === nearestIndex || squared > bandLimitSquared) continue;

      const candidate = candidates[i]!;
      const cost = candidate.acquisitionCost ?? 0;
      const flatness = flatnessLevels[i]!;
      const isFlatter = flatness < chosenFlatness;
      const isAsFlat = flatness === chosenFlatness;
      const isCheaper = cost < chosenCost;
      const isAsCheap = cost === chosenCost;
      const isNearer = squared < chosenSquared;
      if (isFlatter || (isAsFlat && (isCheaper || (isAsCheap && isNearer)))) {
        chosen = candidate;
        chosenSquared = squared;
        chosenFlatness = flatness;
        chosenCost = cost;
      }
    }
    return chosen;
  };
}

/**
 * One-shot convenience over {@link createMatcher}: the `item` of the
 * candidate that best stands in for `target`. Prefer `createMatcher`
 * anywhere many targets are matched against the same pool.
 *
 * Failure modes: as {@link createMatcher}.
 */
export function findBestMatch<T>(
  target: Oklab,
  candidates: readonly ScoredCandidate<T>[],
  options: MatchOptions,
): T {
  return createMatcher(candidates, options)(target).item;
}

/**
 * Finds the closest-matching candidate to `target` by plain Oklab
 * distance, ignoring texture busyness — a thin convenience wrapper
 * around {@link findBestMatch} with every candidate's variance zeroed
 * out and a tolerance of zero, so only color ever matters.
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
  return findBestMatch(
    target,
    candidates.map((candidate) => ({ ...candidate, variance: 0 })),
    { colorTolerance: 0 },
  );
}
