import { describe, expect, it } from "vitest";
import {
  averageLinearRgb,
  averageOklab,
  createMatcher,
  DEFAULT_COLOR_TOLERANCE,
  findBestMatch,
  findNearestOklab,
  linearRgbToOklab,
  linearRgbToRgb8,
  linearToSrgbChannel,
  oklabDistance,
  oklabDistanceSquared,
  oklabToLinearRgb,
  rgb8ToLinearRgb,
  srgbToLinearChannel,
  type LinearRgb,
  type Oklab,
  type Rgb8,
} from "./color.ts";

describe("srgbToLinearChannel / linearToSrgbChannel", () => {
  it("fixes the endpoints", () => {
    expect(srgbToLinearChannel(0)).toBe(0);
    expect(srgbToLinearChannel(1)).toBe(1);
    expect(linearToSrgbChannel(0)).toBe(0);
    // 1.055 - 0.055 is not exactly 1 in IEEE754, so this endpoint needs a tolerance.
    expect(linearToSrgbChannel(1)).toBeCloseTo(1, 10);
  });

  it("darkens mid-gray, since sRGB 0.5 is perceptually brighter than linear 0.5", () => {
    const linear = srgbToLinearChannel(0.5);
    expect(linear).toBeGreaterThan(0.2);
    expect(linear).toBeLessThan(0.25);
  });

  it("round-trips across the full range, including both curve segments", () => {
    for (const value of [0, 0.01, 0.04045, 0.1, 0.5, 0.9, 1]) {
      expect(linearToSrgbChannel(srgbToLinearChannel(value))).toBeCloseTo(value, 6);
    }
  });

  it("rejects a channel outside [0, 1]", () => {
    expect(() => srgbToLinearChannel(1.5)).toThrow(RangeError);
    expect(() => srgbToLinearChannel(-0.1)).toThrow(RangeError);
  });
});

describe("rgb8ToLinearRgb / linearRgbToRgb8", () => {
  it.each<Rgb8>([
    { r: 0, g: 0, b: 0 },
    { r: 255, g: 255, b: 255 },
    { r: 128, g: 128, b: 128 },
    { r: 255, g: 0, b: 0 },
    { r: 134, g: 90, b: 42 },
  ])("round-trips %j within rounding error", (rgb) => {
    const roundTripped = linearRgbToRgb8(rgb8ToLinearRgb(rgb));
    expect(Math.abs(roundTripped.r - rgb.r)).toBeLessThanOrEqual(1);
    expect(Math.abs(roundTripped.g - rgb.g)).toBeLessThanOrEqual(1);
    expect(Math.abs(roundTripped.b - rgb.b)).toBeLessThanOrEqual(1);
  });

  it("rejects a byte outside [0, 255]", () => {
    expect(() => rgb8ToLinearRgb({ r: 256, g: 0, b: 0 })).toThrow(RangeError);
    expect(() => rgb8ToLinearRgb({ r: 1.5, g: 0, b: 0 })).toThrow(RangeError);
  });
});

describe("averageLinearRgb", () => {
  it("averages per channel", () => {
    const result = averageLinearRgb([
      { r: 0, g: 0.2, b: 1 },
      { r: 1, g: 0.2, b: 0 },
    ]);
    expect(result).toEqual({ r: 0.5, g: 0.2, b: 0.5 });
  });

  it("throws on an empty sample list rather than returning a meaningless default", () => {
    expect(() => averageLinearRgb([])).toThrow(RangeError);
  });

  it("averaging black and white in linear light is much brighter than naive sRGB byte averaging would be", () => {
    const black = rgb8ToLinearRgb({ r: 0, g: 0, b: 0 });
    const white = rgb8ToLinearRgb({ r: 255, g: 255, b: 255 });
    const averaged = linearRgbToRgb8(averageLinearRgb([black, white]));
    // Naive sRGB-byte averaging would give 127; the correct linear-light
    // average is substantially brighter than that.
    expect(averaged.r).toBeGreaterThan(160);
    expect(averaged.r).toBeCloseTo(188, -1);
  });
});

describe("averageOklab", () => {
  it("averages per channel", () => {
    const result = averageOklab([
      { L: 0, a: 0.2, b: 1 },
      { L: 1, a: 0.2, b: 0 },
    ]);
    expect(result).toEqual({ L: 0.5, a: 0.2, b: 0.5 });
  });

  it("throws on an empty sample list rather than returning a meaningless default", () => {
    expect(() => averageOklab([])).toThrow(RangeError);
  });

  it("differs from converting the linear-light average, for black and white specifically — the whole point of this function existing (see palette.ts's representativeAppearance)", () => {
    const black: Oklab = linearRgbToOklab({ r: 0, g: 0, b: 0 });
    const white: Oklab = linearRgbToOklab({ r: 1, g: 1, b: 1 });
    const oklabAverage = averageOklab([black, white]);
    const linearLightAverage = linearRgbToOklab(averageLinearRgb([{ r: 0, g: 0, b: 0 }, { r: 1, g: 1, b: 1 }]));
    // Averaging directly in Oklab gives the exact midpoint (L=0.5, up
    // to the same floating-point tolerance linearRgbToOklab's own
    // "maps white to L=1" test uses); averaging in linear light first
    // and converting afterward does not, because of Oklab's cube-root
    // nonlinearity.
    expect(oklabAverage.L).toBeCloseTo(0.5, 7);
    expect(oklabAverage.L).not.toBeCloseTo(linearLightAverage.L, 2);
  });
});

describe("linearRgbToOklab / oklabToLinearRgb", () => {
  it("maps black to the Oklab origin", () => {
    const lab = linearRgbToOklab({ r: 0, g: 0, b: 0 });
    expect(lab.L).toBeCloseTo(0, 6);
    expect(lab.a).toBeCloseTo(0, 6);
    expect(lab.b).toBeCloseTo(0, 6);
  });

  it("maps white to L=1 with no chroma", () => {
    const lab = linearRgbToOklab({ r: 1, g: 1, b: 1 });
    expect(lab.L).toBeCloseTo(1, 3);
    expect(lab.a).toBeCloseTo(0, 3);
    expect(lab.b).toBeCloseTo(0, 3);
  });

  it.each<LinearRgb>([
    { r: 0, g: 0, b: 0 },
    { r: 1, g: 1, b: 1 },
    { r: 0.5, g: 0.5, b: 0.5 },
    { r: 1, g: 0, b: 0 },
    { r: 0, g: 1, b: 0 },
    { r: 0, g: 0, b: 1 },
    { r: 0.3, g: 0.6, b: 0.1 },
  ])("round-trips %j", (linear) => {
    const roundTripped = oklabToLinearRgb(linearRgbToOklab(linear));
    expect(roundTripped.r).toBeCloseTo(linear.r, 5);
    expect(roundTripped.g).toBeCloseTo(linear.g, 5);
    expect(roundTripped.b).toBeCloseTo(linear.b, 5);
  });
});

describe("oklabDistance", () => {
  it("is zero for identical colors", () => {
    const color = { L: 0.5, a: 0.1, b: -0.1 };
    expect(oklabDistance(color, color)).toBe(0);
  });

  it("computes plain Euclidean distance", () => {
    expect(oklabDistance({ L: 0, a: 0, b: 0 }, { L: 1, a: 0, b: 0 })).toBeCloseTo(1, 10);
    expect(oklabDistance({ L: 0, a: 0, b: 0 }, { L: 0, a: 3, b: 4 })).toBeCloseTo(5, 10);
  });

  it("is symmetric", () => {
    const a = { L: 0.2, a: 0.05, b: 0.1 };
    const b = { L: 0.8, a: -0.1, b: 0.02 };
    expect(oklabDistance(a, b)).toBeCloseTo(oklabDistance(b, a), 10);
  });
});

describe("findNearestOklab", () => {
  const candidates = [
    { color: { L: 0, a: 0, b: 0 }, item: "black" },
    { color: { L: 1, a: 0, b: 0 }, item: "white" },
    { color: { L: 0.5, a: 0.2, b: 0 }, item: "red-ish" },
  ];

  it("picks the closest candidate", () => {
    expect(findNearestOklab({ L: 0.05, a: 0, b: 0 }, candidates)).toBe("black");
    expect(findNearestOklab({ L: 0.95, a: 0, b: 0 }, candidates)).toBe("white");
    expect(findNearestOklab({ L: 0.5, a: 0.18, b: 0.01 }, candidates)).toBe("red-ish");
  });

  it("throws on an empty candidate list rather than returning a meaningless match", () => {
    expect(() => findNearestOklab({ L: 0.5, a: 0, b: 0 }, [])).toThrow(RangeError);
  });
});

describe("oklabDistanceSquared", () => {
  it("is the square of oklabDistance", () => {
    const a = { L: 0, a: 0, b: 0 };
    const b = { L: 0, a: 3, b: 4 };
    expect(oklabDistanceSquared(a, b)).toBeCloseTo(25, 10); // 3-4-5 triangle
    expect(oklabDistanceSquared(a, b)).toBeCloseTo(oklabDistance(a, b) ** 2, 10);
  });

  it("is zero for identical colors", () => {
    const color = { L: 0.5, a: 0.1, b: -0.1 };
    expect(oklabDistanceSquared(color, color)).toBe(0);
  });
});

describe("findBestMatch", () => {
  const target = { L: 0.5, a: 0, b: 0 };
  // Every candidate sits on the L axis, so its color distance from the
  // target is just |ΔL|:
  //   noisyNear: L=0.52 -> distance 0.02, variance 0.01
  //   flatNear:  L=0.53 -> distance 0.03, variance 0.0001
  //   flatFar:   L=0.60 -> distance 0.10, variance 0
  const noisyNear = { color: { L: 0.52, a: 0, b: 0 }, variance: 0.01, item: "noisy_near" };
  const flatNear = { color: { L: 0.53, a: 0, b: 0 }, variance: 0.0001, item: "flat_near" };
  const flatFar = { color: { L: 0.6, a: 0, b: 0 }, variance: 0, item: "flat_far" };
  const all = [noisyNear, flatNear, flatFar];

  it("at tolerance 0 the nearest color wins regardless of its own noise (pure color match)", () => {
    expect(findBestMatch(target, all, { colorTolerance: 0 })).toBe("noisy_near");
  });

  it("a candidate inside the tolerance band of the best color wins if its texture is flatter", () => {
    // Band = nearest distance + tolerance = 0.02 + 0.02 = 0.04: flatNear
    // (0.03) is inside it and flatter than noisyNear; flatFar (0.10) is not.
    expect(findBestMatch(target, all, { colorTolerance: 0.02 })).toBe("flat_near");
  });

  it("never lets a texture advantage buy a visibly worse color: a candidate beyond the band loses even with a perfectly flat texture", () => {
    // The failure this rule exists to prevent. The old weighted sum scored
    // distance² + variance, so flatFar (0.01 + 0) beat noisyNear
    // (0.0004 + 0.01): a color 5x worse winning purely on texture.
    expect(findBestMatch(target, [noisyNear, flatFar], { colorTolerance: DEFAULT_COLOR_TOLERANCE })).toBe(
      "noisy_near",
    );
  });

  it("a large enough tolerance DOES let a visibly worse color win — that is the knob's honest meaning", () => {
    // Band = 0.02 + 0.09 = 0.11 admits flatFar (0.10), the flattest of all.
    expect(findBestMatch(target, all, { colorTolerance: 0.09 })).toBe("flat_far");
  });

  it("two equally-colored candidates break the tie toward the flatter one, even at tolerance 0", () => {
    const flat = { color: { L: 0.7, a: 0, b: 0 }, variance: 0, item: "flat" };
    const noisySameColor = { color: { L: 0.7, a: 0, b: 0 }, variance: 0.02, item: "noisy_same_color" };
    expect(findBestMatch(target, [noisySameColor, flat], { colorTolerance: 0 })).toBe("flat");
    expect(findBestMatch(target, [noisySameColor, flat], { colorTolerance: DEFAULT_COLOR_TOLERANCE })).toBe("flat");
  });

  it("among candidates tied on flatness and cost, the nearer color wins even when it is listed later", () => {
    const farther = { color: { L: 0.54, a: 0, b: 0 }, variance: 0, item: "farther" };
    const nearer = { color: { L: 0.52, a: 0, b: 0 }, variance: 0, item: "nearer" };
    expect(findBestMatch(target, [farther, nearer], { colorTolerance: 0.05 })).toBe("nearer");
  });

  it("falls back to the first-listed candidate when everything, color included, is identical", () => {
    const first = { color: { L: 0.7, a: 0, b: 0 }, variance: 0.01, item: "first" };
    const second = { color: { L: 0.7, a: 0, b: 0 }, variance: 0.01, item: "second" };
    expect(findBestMatch(target, [first, second], { colorTolerance: 0 })).toBe("first");
    expect(findBestMatch(target, [second, first], { colorTolerance: 0 })).toBe("second");
  });

  it("throws on an empty candidate list rather than returning a meaningless match", () => {
    expect(() => findBestMatch(target, [], { colorTolerance: 0 })).toThrow(RangeError);
  });

  it("rejects a negative or non-finite tolerance instead of silently matching with it", () => {
    expect(() => findBestMatch(target, all, { colorTolerance: -0.01 })).toThrow(RangeError);
    expect(() => findBestMatch(target, all, { colorTolerance: Number.NaN })).toThrow(RangeError);
    expect(() => findBestMatch(target, all, { colorTolerance: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });

  describe("acquisitionCost tie-break", () => {
    // Two candidates with the IDENTICAL color and variance, differing
    // only in acquisitionCost — isolates the cost tie-break from
    // everything else the matcher decides on.
    const cheap = { color: { L: 0.5, a: 0, b: 0 }, variance: 0, acquisitionCost: 0, item: "cheap" };
    const costly = { color: { L: 0.5, a: 0, b: 0 }, variance: 0, acquisitionCost: 2, item: "costly" };

    it("prefers the cheaper candidate when color and flatness tie exactly", () => {
      expect(findBestMatch(target, [costly, cheap], { colorTolerance: 0 })).toBe("cheap");
    });

    it("a candidate with no acquisitionCost field is treated as cost 0, same as an explicit 0", () => {
      const noCostField = { color: { L: 0.5, a: 0, b: 0 }, variance: 0, item: "no_cost_field" };
      expect(findBestMatch(target, [costly, noCostField], { colorTolerance: 0 })).toBe("no_cost_field");
    });

    it("never outranks flatness: a flatter but costlier candidate beats a cheaper but busier one of the same color", () => {
      const cheapButBusy = { color: { L: 0.5, a: 0, b: 0 }, variance: 0.01, acquisitionCost: 0, item: "cheap_but_busy" };
      const costlyButFlat = { color: { L: 0.5, a: 0, b: 0 }, variance: 0, acquisitionCost: 2, item: "costly_but_flat" };
      expect(findBestMatch(target, [cheapButBusy, costlyButFlat], { colorTolerance: 0 })).toBe("costly_but_flat");
    });

    it("never lets a cost difference override a real, clearly-better color match", () => {
      // "nearExact" is a hair off target but far cheaper than "exact" —
      // it is also outside the tolerance band, so cost never even gets a say.
      const exact = { color: { L: 0.5, a: 0, b: 0 }, variance: 0, acquisitionCost: 2, item: "exact" };
      const nearExact = { color: { L: 0.6, a: 0, b: 0 }, variance: 0, acquisitionCost: 0, item: "near_exact" };
      expect(findBestMatch(target, [exact, nearExact], { colorTolerance: 0 })).toBe("exact");
      expect(findBestMatch(target, [exact, nearExact], { colorTolerance: DEFAULT_COLOR_TOLERANCE })).toBe("exact");
    });
  });

  describe("flatness resolution", () => {
    // A perfectly flat texture's measured variance is not reliably 0: its
    // mean is a sum divided by a pixel count, which can land one ulp away
    // from the (identical) pixels and leave a variance near 1e-33 for one
    // flat block and exactly 0 for the next. Real packs are full of flat
    // blocks (concrete, terracotta, wool), so that noise must never be what
    // picks between them. Seen for real: a dark orange resolved to
    // red_terracotta, 0.043 away, instead of orange_terracotta, 0.029 away.
    const nearerFlatWithFloatNoise = { color: { L: 0.52, a: 0, b: 0 }, variance: 3e-33, item: "nearer" };
    const fartherExactlyFlat = { color: { L: 0.54, a: 0, b: 0 }, variance: 0, item: "farther" };

    it("treats float-noise differences in variance as equally flat, so the nearer color wins in either listing order", () => {
      const options = { colorTolerance: 0.05 };
      expect(findBestMatch(target, [nearerFlatWithFloatNoise, fartherExactlyFlat], options)).toBe("nearer");
      expect(findBestMatch(target, [fartherExactlyFlat, nearerFlatWithFloatNoise], options)).toBe("nearer");
    });

    it("still prefers a texture that is genuinely flatter", () => {
      const slightlyBusyButNearer = { color: { L: 0.52, a: 0, b: 0 }, variance: 0.0004, item: "slightly_busy" };
      expect(findBestMatch(target, [slightlyBusyButNearer, fartherExactlyFlat], { colorTolerance: 0.05 })).toBe(
        "farther",
      );
    });
  });
});

describe("createMatcher", () => {
  /** A tiny deterministic LCG so the cross-check below is reproducible without a dependency. */
  function seededRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }

  it("at tolerance 0 always returns exactly the nearest candidate, first-listed on a tie (guards the band against excluding its own argmin through float rounding)", () => {
    // sqrt(x) ** 2 can land one ulp below x, so a band computed naively
    // can exclude the very candidate that defines it. Cross-checked
    // against a brute-force argmin across many arbitrary targets.
    const random = seededRandom(12345);
    const candidates = Array.from({ length: 25 }, (_, index) => ({
      color: { L: random(), a: random() * 0.4 - 0.2, b: random() * 0.4 - 0.2 },
      variance: random() * 0.05,
      item: index,
    }));
    const match = createMatcher(candidates, { colorTolerance: 0 });

    for (let trial = 0; trial < 2000; trial++) {
      const targetColor = { L: random(), a: random() * 0.4 - 0.2, b: random() * 0.4 - 0.2 };
      let bestIndex = 0;
      let bestSquared = Infinity;
      candidates.forEach((candidate, index) => {
        const squared = oklabDistanceSquared(targetColor, candidate.color);
        if (squared < bestSquared) {
          bestSquared = squared;
          bestIndex = index;
        }
      });
      expect(match(targetColor).item).toBe(bestIndex);
    }
  });

  it("holds no state between calls: the same target resolves the same way before and after other targets", () => {
    const candidates = [
      { color: { L: 0.2, a: 0, b: 0 }, variance: 0, item: "dark" },
      { color: { L: 0.8, a: 0, b: 0 }, variance: 0, item: "light" },
    ];
    const match = createMatcher(candidates, { colorTolerance: DEFAULT_COLOR_TOLERANCE });
    const first = match({ L: 0.25, a: 0, b: 0 }).item;
    match({ L: 0.9, a: 0, b: 0 });
    match({ L: 0.5, a: 0.1, b: -0.1 });
    expect(match({ L: 0.25, a: 0, b: 0 }).item).toBe(first);
    expect(first).toBe("dark");
  });

  it("returns the whole winning candidate, not just its item — callers like dithering need its color too", () => {
    const winner = { color: { L: 0.3, a: 0.05, b: 0 }, variance: 0, item: "winner" };
    const loser = { color: { L: 0.9, a: 0, b: 0 }, variance: 0, item: "loser" };
    expect(createMatcher([loser, winner], { colorTolerance: 0 })({ L: 0.3, a: 0.05, b: 0 })).toBe(winner);
  });
});
