import { describe, expect, it } from "vitest";
import { rgb8ToOklab, type Oklab } from "./color.ts";
import {
  amplifyLightness,
  assertContrastGain,
  assessContrastHeadroom,
  LOW_CONTRAST_SPAN_THRESHOLD,
} from "./contrast.ts";

const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

describe("amplifyLightness", () => {
  const FACE_MEAN = 0.5;

  it("returns the very same object at gain 1, so the default path is provably a no-op", () => {
    const color: Oklab = { L: 0.62, a: 0.08, b: 0.05 };
    expect(amplifyLightness(color, FACE_MEAN, 1)).toBe(color);
  });

  it("scales a pixel's distance from the face mean by the gain", () => {
    expect(amplifyLightness({ L: 0.55, a: 0, b: 0 }, FACE_MEAN, 2).L).toBeCloseTo(0.6, 12);
    expect(amplifyLightness({ L: 0.45, a: 0, b: 0 }, FACE_MEAN, 2).L).toBeCloseTo(0.4, 12);
    expect(amplifyLightness({ L: 0.55, a: 0, b: 0 }, FACE_MEAN, 1.5).L).toBeCloseTo(0.575, 12);
  });

  it("leaves hue and chroma (a/b) exactly as they were", () => {
    const stretched = amplifyLightness({ L: 0.6, a: 0.08, b: -0.03 }, FACE_MEAN, 2);
    expect(stretched.a).toBe(0.08);
    expect(stretched.b).toBe(-0.03);
  });

  it("leaves a pixel sitting exactly on the face mean unchanged at any gain — a flat face never moves", () => {
    for (const gain of [1, 1.5, 2, 5]) {
      expect(amplifyLightness({ L: FACE_MEAN, a: 0.04, b: 0.02 }, FACE_MEAN, gain).L).toBeCloseTo(FACE_MEAN, 12);
    }
  });

  it("never changes a face's AVERAGE lightness, at any gain — the property a remap onto the palette's range cannot have", () => {
    // Real acacia-log-top and mangrove-log pixels (sRGB), so this is the
    // case that actually broke rather than a tidy symmetric toy: three
    // uneven shades whose average is NOT their midpoint. Amplified
    // lightnesses must average back to the original — with the palette's
    // extremes nowhere in sight, because nothing here can see a palette.
    const faces = [
      [
        { r: 140, g: 76, b: 42 },
        { r: 169, g: 92, b: 51 },
        { r: 190, g: 110, b: 65 },
      ],
      [
        { r: 72, g: 41, b: 36 },
        { r: 102, g: 58, b: 51 },
        { r: 118, g: 66, b: 57 },
      ],
    ];
    for (const face of faces) {
      const pixels = face.map(rgb8ToOklab);
      const faceMean = mean(pixels.map((pixel) => pixel.L));
      for (const gain of [1, 1.5, 2, 3]) {
        const amplified = pixels.map((pixel) => amplifyLightness(pixel, faceMean, gain));
        expect(mean(amplified.map((pixel) => pixel.L))).toBeCloseTo(faceMean, 12);
      }
    }
  });

  it("clamps to the Oklab lightness axis [0, 1], not to anything palette-shaped", () => {
    expect(amplifyLightness({ L: 0.95, a: 0, b: 0 }, 0.9, 3).L).toBe(1); // 0.9 + 0.05*3 = 1.05
    expect(amplifyLightness({ L: 0.05, a: 0, b: 0 }, 0.1, 3).L).toBe(0); // 0.1 - 0.05*3 = -0.05
  });
});

describe("assertContrastGain", () => {
  it("accepts 1 (no enhancement) and anything above it", () => {
    for (const gain of [1, 1.5, 2, 5]) expect(() => assertContrastGain(gain)).not.toThrow();
  });

  it("rejects a gain below 1, which would compress toward the face mean instead of amplifying", () => {
    expect(() => assertContrastGain(0)).toThrow(RangeError);
    expect(() => assertContrastGain(0.5)).toThrow(RangeError);
    expect(() => assertContrastGain(-2)).toThrow(RangeError);
  });

  it("rejects a non-finite gain", () => {
    expect(() => assertContrastGain(Number.NaN)).toThrow(RangeError);
    expect(() => assertContrastGain(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("assessContrastHeadroom", () => {
  it("flags a block when some face has a faint light/dark pattern", () => {
    const headroom = assessContrastHeadroom([0.095, 0.3, 0.3, 0.3, 0.3, 0.3]);
    expect(headroom.isLowContrast).toBe(true);
    expect(headroom.faintestPatternSpan).toBeCloseTo(0.095, 12);
  });

  it("reports the FAINTEST face — one faint face is enough, however busy the other five are", () => {
    // The question is "is there a face contrast enhancement would help?",
    // not "how varied is the block on the whole?" — a log's end grain
    // next to a much busier bark is the usual case.
    expect(assessContrastHeadroom([0.05, 0.9, 0.9, 0.9, 0.9, 0.9]).faintestPatternSpan).toBeCloseTo(0.05, 12);
  });

  it("does not flag a block whose every patterned face has strong internal contrast", () => {
    const headroom = assessContrastHeadroom([0.25, 0.4, 0.4, 0.4, 0.4, 0.4]);
    expect(headroom.isLowContrast).toBe(false);
    expect(headroom.faintestPatternSpan).toBeCloseTo(0.25, 12);
  });

  it("ignores perfectly flat faces: gain scales deviation from the mean, and a flat face has none, so there is nothing to help", () => {
    // Without this a block with one plain flat face (span 0) would always
    // read as "low contrast" and the tip would never mean anything.
    const headroom = assessContrastHeadroom([0, 0.3, 0.3, 0.3, 0.3, 0.3]);
    expect(headroom.faintestPatternSpan).toBeCloseTo(0.3, 12);
    expect(headroom.isLowContrast).toBe(false);
  });

  it("is neither flagged nor given a span when every face is perfectly flat", () => {
    expect(assessContrastHeadroom([0, 0, 0, 0, 0, 0])).toEqual({ faintestPatternSpan: null, isLowContrast: false });
  });

  it("treats a span exactly at the threshold as NOT low — only strictly fainter counts", () => {
    expect(assessContrastHeadroom([LOW_CONTRAST_SPAN_THRESHOLD]).isLowContrast).toBe(false);
    expect(assessContrastHeadroom([LOW_CONTRAST_SPAN_THRESHOLD - 0.001]).isLowContrast).toBe(true);
  });
});
