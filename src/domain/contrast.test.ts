import { describe, expect, it } from "vitest";
import { assessContrastHeadroom, lightnessRangeOf, stretchLightness } from "./contrast.ts";
import { rgb8ToOklab, type Oklab } from "./color.ts";

const BLACK = rgb8ToOklab({ r: 0, g: 0, b: 0 });
const WHITE = rgb8ToOklab({ r: 255, g: 255, b: 255 });
const GRAY_100 = rgb8ToOklab({ r: 100, g: 100, b: 100 });
const GRAY_130 = rgb8ToOklab({ r: 130, g: 130, b: 130 });

describe("lightnessRangeOf", () => {
  it("finds the min and max L across several colors", () => {
    expect(lightnessRangeOf([GRAY_130, BLACK, WHITE, GRAY_100])).toEqual({ min: BLACK.L, max: WHITE.L });
  });

  it("collapses to a single value for one color", () => {
    expect(lightnessRangeOf([GRAY_100])).toEqual({ min: GRAY_100.L, max: GRAY_100.L });
  });

  it("throws for an empty input", () => {
    expect(() => lightnessRangeOf([])).toThrow(RangeError);
  });
});

describe("stretchLightness", () => {
  it("maps a source range's min and max exactly onto the target range's min and max", () => {
    const sourceRange = lightnessRangeOf([GRAY_100, GRAY_130]);
    const targetRange = lightnessRangeOf([BLACK, WHITE]);
    expect(stretchLightness(GRAY_100, sourceRange, targetRange).L).toBeCloseTo(BLACK.L, 10);
    expect(stretchLightness(GRAY_130, sourceRange, targetRange).L).toBeCloseTo(WHITE.L, 10);
  });

  it("maps a midpoint to the target range's own midpoint", () => {
    const midGray: Oklab = { L: (GRAY_100.L + GRAY_130.L) / 2, a: 0, b: 0 };
    const sourceRange = lightnessRangeOf([GRAY_100, GRAY_130]);
    const targetRange = lightnessRangeOf([BLACK, WHITE]);
    expect(stretchLightness(midGray, sourceRange, targetRange).L).toBeCloseTo((BLACK.L + WHITE.L) / 2, 10);
  });

  it("leaves a/b untouched", () => {
    const colorful: Oklab = { L: GRAY_100.L, a: 0.08, b: -0.03 };
    const sourceRange = lightnessRangeOf([GRAY_100, GRAY_130]);
    const targetRange = lightnessRangeOf([BLACK, WHITE]);
    const stretched = stretchLightness(colorful, sourceRange, targetRange);
    expect(stretched.a).toBe(0.08);
    expect(stretched.b).toBe(-0.03);
  });

  it("is a no-op for a perfectly flat (zero-span) source range, rather than dividing by zero", () => {
    const flatRange = lightnessRangeOf([GRAY_100]);
    const targetRange = lightnessRangeOf([BLACK, WHITE]);
    expect(stretchLightness(GRAY_100, flatRange, targetRange)).toEqual(GRAY_100);
  });

  it("collapses every input to the same value for a zero-span target", () => {
    const sourceRange = lightnessRangeOf([GRAY_100, GRAY_130]);
    const collapsedTarget = lightnessRangeOf([GRAY_100]);
    expect(stretchLightness(GRAY_100, sourceRange, collapsedTarget).L).toBeCloseTo(GRAY_100.L, 10);
    expect(stretchLightness(GRAY_130, sourceRange, collapsedTarget).L).toBeCloseTo(GRAY_100.L, 10);
  });

  it("is the identity when source and target ranges are the same", () => {
    const range = lightnessRangeOf([GRAY_100, GRAY_130]);
    expect(stretchLightness(GRAY_100, range, range).L).toBeCloseTo(GRAY_100.L, 10);
  });
});

describe("assessContrastHeadroom", () => {
  it("is not palette-limited when every face's range fits inside the palette's", () => {
    const headroom = assessContrastHeadroom([[GRAY_100, GRAY_130]], [BLACK, WHITE]);
    expect(headroom.isPaletteLimited).toBe(false);
    expect(headroom.sourceLightnessSpan).toBeCloseTo(GRAY_130.L - GRAY_100.L, 10);
    expect(headroom.paletteLightnessSpan).toBeCloseTo(WHITE.L - BLACK.L, 10);
  });

  it("is palette-limited when a face's own range exceeds the palette's", () => {
    const headroom = assessContrastHeadroom([[BLACK, WHITE]], [GRAY_100, GRAY_130]);
    expect(headroom.isPaletteLimited).toBe(true);
  });

  it("reports the widest face, not an average or a sum across faces", () => {
    const narrowFace = [GRAY_100, GRAY_100];
    const wideFace = [BLACK, WHITE];
    const headroom = assessContrastHeadroom([narrowFace, wideFace], [GRAY_100, GRAY_130]);
    expect(headroom.sourceLightnessSpan).toBeCloseTo(WHITE.L - BLACK.L, 10);
  });

  it("throws if a face has no colors at all", () => {
    expect(() => assessContrastHeadroom([[]], [BLACK, WHITE])).toThrow(RangeError);
  });
});
