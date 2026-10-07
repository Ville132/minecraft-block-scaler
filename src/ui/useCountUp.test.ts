import { describe, expect, it } from "vitest";
import { countUpValueAt, easeOutCubic } from "./useCountUp.ts";

// Only the pure timing maths is covered here. `useCountUp` itself is a
// requestAnimationFrame loop over these functions, and vitest runs in Node
// with no DOM — see this project's other UI modules for the same split.

describe("easeOutCubic", () => {
  it("spans 0 to 1 over the unit interval", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  it("decelerates: it is already past halfway at the halfway point", () => {
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 12);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });

  it("clamps outside the unit interval rather than overshooting", () => {
    expect(easeOutCubic(-5)).toBe(0);
    expect(easeOutCubic(5)).toBe(1);
  });
});

describe("countUpValueAt", () => {
  const DURATION_MS = 400;

  it("starts at zero and finishes exactly on the target", () => {
    expect(countUpValueAt(1352, 0, DURATION_MS)).toBe(0);
    expect(countUpValueAt(1352, DURATION_MS, DURATION_MS)).toBe(1352);
  });

  it("never overshoots the target once the duration has elapsed", () => {
    expect(countUpValueAt(1352, DURATION_MS * 10, DURATION_MS)).toBe(1352);
  });

  it("climbs monotonically", () => {
    let previous = -1;
    for (let elapsed = 0; elapsed <= DURATION_MS; elapsed += 20) {
      const value = countUpValueAt(2_097_152, elapsed, DURATION_MS);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it("returns whole numbers — a counter must never show a fraction of a block", () => {
    for (const elapsed of [37, 111, 250, 399]) {
      expect(Number.isInteger(countUpValueAt(1352, elapsed, DURATION_MS))).toBe(true);
    }
  });

  it("resolves immediately for a non-positive duration instead of dividing by zero", () => {
    expect(countUpValueAt(1352, 0, 0)).toBe(1352);
    expect(countUpValueAt(1352, 0, -10)).toBe(1352);
  });

  it("handles a zero target, which every stat can legitimately be", () => {
    expect(countUpValueAt(0, 0, DURATION_MS)).toBe(0);
    expect(countUpValueAt(0, DURATION_MS, DURATION_MS)).toBe(0);
  });
});
