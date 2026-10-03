import { describe, expect, it } from "vitest";
import { classifyScale, hollowBlockCount, listScaleOptions, solidBlockCount } from "./scale.ts";

describe("listScaleOptions", () => {
  it("matches the full option set up to 128", () => {
    expect(listScaleOptions(128)).toEqual([1, 2, 4, 8, 16, 32, 48, 64, 80, 96, 112, 128]);
  });

  it("only offers divisors when the cap is below one texture width", () => {
    expect(listScaleOptions(5)).toEqual([1, 2, 4]);
  });

  it("includes 16 exactly once even though it is both a divisor and a multiple", () => {
    expect(listScaleOptions(16)).toEqual([1, 2, 4, 8, 16]);
  });

  it("rejects a non-positive or non-integer cap", () => {
    expect(() => listScaleOptions(0)).toThrow(RangeError);
    expect(() => listScaleOptions(-5)).toThrow(RangeError);
    expect(() => listScaleOptions(1.5)).toThrow(RangeError);
  });
});

describe("classifyScale", () => {
  it.each([
    [16, 1],
    [32, 2],
    [48, 3],
    [64, 4],
  ])("edge %i is exact with %i block(s) per pixel", (edge, blocksPerPixel) => {
    expect(classifyScale(edge)).toEqual({ kind: "exact", blocksPerPixel });
  });

  it.each([
    [8, 2],
    [4, 4],
    [2, 8],
    [1, 16],
  ])("edge %i is reduced with %i pixel(s) collapsing per block", (edge, pixelsPerBlock) => {
    expect(classifyScale(edge)).toEqual({ kind: "reduced", pixelsPerBlock });
  });

  it.each([10, 24])("edge %i is distorted", (edge) => {
    expect(classifyScale(edge)).toEqual({ kind: "distorted" });
  });

  it("rejects a non-positive or non-integer edge", () => {
    expect(() => classifyScale(0)).toThrow(RangeError);
    expect(() => classifyScale(-1)).toThrow(RangeError);
    expect(() => classifyScale(2.5)).toThrow(RangeError);
  });
});

describe("block counts match the plan's worked table", () => {
  it.each([
    [8, 296, 512],
    [16, 1352, 4096],
    [32, 5768, 32768],
    [48, 13256, 110592],
    [64, 23816, 262144],
  ])("edge %i -> hollow %i, solid %i", (edge, hollow, solid) => {
    expect(hollowBlockCount(edge)).toBe(hollow);
    expect(solidBlockCount(edge)).toBe(solid);
  });

  it("a 1-block edge is entirely its own shell", () => {
    expect(hollowBlockCount(1)).toBe(1);
    expect(solidBlockCount(1)).toBe(1);
  });

  it("hollow count never exceeds solid count", () => {
    for (const edge of [1, 2, 3, 5, 16, 32, 64, 100]) {
      expect(hollowBlockCount(edge)).toBeLessThanOrEqual(solidBlockCount(edge));
    }
  });
});
