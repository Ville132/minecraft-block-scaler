import { describe, expect, it } from "vitest";
import {
  averageLinearRgb,
  averageOklab,
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
  // Hand-computed costs at target (L=0.5,a=0,b=0):
  //   noisyNear: color (L=0.52) -> distanceSquared = 0.02^2 = 0.0004; variance 0.01
  //     cost(weight=0) = 0.0004            cost(weight=1) = 0.0104
  //   flatFar:   color (L=0.6)  -> distanceSquared = 0.1^2  = 0.01;   variance 0
  //     cost(weight=0) = 0.01              cost(weight=1) = 0.01
  const noisyNear = { color: { L: 0.52, a: 0, b: 0 }, variance: 0.01, item: "noisy_near" };
  const flatFar = { color: { L: 0.6, a: 0, b: 0 }, variance: 0, item: "flat_far" };

  it("at weight 0, the nearer candidate wins regardless of its own noise (pure color match)", () => {
    expect(findBestMatch(target, [noisyNear, flatFar], 0)).toBe("noisy_near");
  });

  it("at weight 1, a flatter-but-farther candidate can outscore a closer-but-noisier one", () => {
    // 0.0004 + 1*0.01 = 0.0104  >  0.01 + 1*0 = 0.01 -> flatFar wins
    expect(findBestMatch(target, [noisyNear, flatFar], 1)).toBe("flat_far");
  });

  it("two equally-colored candidates break the tie toward the flatter one once variance is weighted", () => {
    const flat = { color: { L: 0.7, a: 0, b: 0 }, variance: 0, item: "flat" };
    const noisySameColor = { color: { L: 0.7, a: 0, b: 0 }, variance: 0.02, item: "noisy_same_color" };
    expect(findBestMatch(target, [noisySameColor, flat], 1)).toBe("flat");
    // At weight 0 the two are an exact cost tie; findBestMatch keeps the
    // first-listed candidate, same tie-break convention as findNearestOklab.
    expect(findBestMatch(target, [noisySameColor, flat], 0)).toBe("noisy_same_color");
  });

  it("throws on an empty candidate list rather than returning a meaningless match", () => {
    expect(() => findBestMatch(target, [], 1)).toThrow(RangeError);
  });

  describe("acquisitionCost tie-break", () => {
    // Two candidates with the IDENTICAL color and variance, differing
    // only in acquisitionCost — isolates the cost term from everything
    // else findBestMatch scores on.
    const cheap = { color: { L: 0.5, a: 0, b: 0 }, variance: 0, acquisitionCost: 0, item: "cheap" };
    const costly = { color: { L: 0.5, a: 0, b: 0 }, variance: 0, acquisitionCost: 2, item: "costly" };

    it("prefers the cheaper candidate when colors tie exactly", () => {
      expect(findBestMatch(target, [costly, cheap], 0, 0.001)).toBe("cheap");
    });

    it("a candidate with no acquisitionCost field is treated as cost 0, same as an explicit 0", () => {
      const noCostField = { color: { L: 0.5, a: 0, b: 0 }, variance: 0, item: "no_cost_field" };
      expect(findBestMatch(target, [costly, noCostField], 0, 0.001)).toBe("no_cost_field");
    });

    it("costWeight 0 ignores acquisitionCost entirely, keeping the first-listed candidate on a full tie", () => {
      expect(findBestMatch(target, [costly, cheap], 0, 0)).toBe("costly");
    });

    it("never lets a cost difference override a real, clearly-better color match (the default weight is deliberately tiny)", () => {
      // "nearExact" is a hair off target but far cheaper than "exact";
      // at the principled default cost weight, color accuracy still wins.
      const exact = { color: { L: 0.5, a: 0, b: 0 }, variance: 0, acquisitionCost: 2, item: "exact" };
      const nearExact = { color: { L: 0.6, a: 0, b: 0 }, variance: 0, acquisitionCost: 0, item: "near_exact" };
      // costWeight omitted -> DEFAULT_COST_WEIGHT, the same default the real app uses.
      expect(findBestMatch(target, [exact, nearExact], 0)).toBe("exact");
    });
  });
});
