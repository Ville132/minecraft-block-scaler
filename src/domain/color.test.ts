import { describe, expect, it } from "vitest";
import {
  averageLinearRgb,
  findNearestOklab,
  linearRgbToOklab,
  linearRgbToRgb8,
  linearToSrgbChannel,
  oklabDistance,
  oklabToLinearRgb,
  rgb8ToLinearRgb,
  srgbToLinearChannel,
  type LinearRgb,
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
