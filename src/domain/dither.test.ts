import { describe, expect, it } from "vitest";
import type { Oklab, ScoredCandidate } from "./color.ts";
import { ditherGrid } from "./dither.ts";

const BLACK: Oklab = { L: 0, a: 0, b: 0 };
const WHITE: Oklab = { L: 1, a: 0, b: 0 };

function candidate(label: string, color: Oklab, variance = 0, acquisitionCost = 0): ScoredCandidate<string> {
  return { color, variance, acquisitionCost, item: label };
}

describe("ditherGrid", () => {
  it("picks the exact match everywhere and diffuses nothing when every target already has zero error", () => {
    const targets: Oklab[] = new Array(6).fill(BLACK);
    const candidates = [candidate("black", BLACK), candidate("white", WHITE)];
    const chosen = ditherGrid(targets, 3, candidates, { colorTolerance: 0 });
    expect(chosen).toEqual(["black", "black", "black", "black", "black", "black"]);
  });

  it("alternates between two candidates across a uniform mid-gray row, hand-traced via the 7/16 'ahead' weight", () => {
    // width=4, height=1: only the horizontal (7/16, "ahead") kernel
    // weight can ever land inside the grid - the other three all target
    // a nonexistent row below and are discarded. Exact fractions:
    //
    // col0: cell=1/2. distToBlack=distToWhite=1/4 -> exact tie -> first
    //   candidate (black) wins (same tie-break convention as
    //   findBestMatch/findNearestOklab). error = 1/2 - 0 = 1/2.
    //   diffuse (1/2)*(7/16) = 7/32 ahead -> col1 = 16/32+7/32 = 23/32.
    // col1: cell=23/32. distToBlack=(23/32)^2=529/1024;
    //   distToWhite=(9/32)^2=81/1024 -> white wins (closer).
    //   error = 23/32-1 = -9/32. diffuse -9/32*7/16=-63/512 ahead ->
    //   col2 = 256/512-63/512 = 193/512.
    // col2: cell=193/512. distToBlack=193^2; distToWhite=319^2 (same
    //   denominator) -> 37249 < 101761 -> black wins (closer).
    //   error=193/512. diffuse 193/512*7/16=1351/8192 ahead ->
    //   col3 = 4096/8192+1351/8192 = 5447/8192 ~= 0.66492.
    // col3: cell~=0.66492. distToBlack~=0.4421; distToWhite~=0.1123 ->
    //   white wins.
    const targets: Oklab[] = new Array(4).fill({ L: 0.5, a: 0, b: 0 });
    const candidates = [candidate("black", BLACK), candidate("white", WHITE)];
    const chosen = ditherGrid(targets, 4, candidates, { colorTolerance: 0 });
    expect(chosen).toEqual(["black", "white", "black", "white"]);
  });

  it("propagates error downward via the straight-down (5/16) weight even with no horizontal neighbour to diffuse into", () => {
    // width=1, height=2: "ahead"/"behind" are always out of range (the
    // only column), so only the straight-down weight ever lands.
    // Row0,col0: cell=1/2, tie -> black wins (first candidate).
    //   error=1/2. diffuse (1/2)*(5/16)=5/32 straight down.
    // Row1,col0: cell = 1/2 + 5/32 = 21/32. distToBlack=(21/32)^2=441;
    //   distToWhite=(11/32)^2=121 (same denominator) -> white wins.
    // Without the vertical diffusion, row1 would tie exactly like row0
    // and also pick black (both rows start at the identical 1/2
    // target) - the fact that it picks white instead IS the proof the
    // 5/16 weight actually fired.
    const targets: Oklab[] = [
      { L: 0.5, a: 0, b: 0 },
      { L: 0.5, a: 0, b: 0 },
    ];
    const candidates = [candidate("black", BLACK), candidate("white", WHITE)];
    const chosen = ditherGrid(targets, 1, candidates, { colorTolerance: 0 });
    expect(chosen).toEqual(["black", "white"]);
  });

  it("prefers a flatter candidate within the color tolerance, same as findBestMatch", () => {
    const targets: Oklab[] = [BLACK];
    const exactButNoisy = candidate("noisy", BLACK, 0.5);
    // 0.1 Oklab from the exact match — inside a 0.2 band, outside a 0.
    const closeButFlat = candidate("flat", { L: 0.1, a: 0, b: 0 }, 0);
    expect(ditherGrid(targets, 1, [exactButNoisy, closeButFlat], { colorTolerance: 0 })).toEqual(["noisy"]);
    // Not 0.1: a candidate sitting exactly ON the band's edge is a
    // float-rounding coin flip, not a behaviour worth pinning.
    expect(ditherGrid(targets, 1, [exactButNoisy, closeButFlat], { colorTolerance: 0.2 })).toEqual(["flat"]);
  });

  it("honors acquisitionCost exactly like the undithered matcher — the two share one rule, so dithering must not silently ignore it", () => {
    // Identical color and flatness, differing only in cost: the cheaper
    // one must win. (Dithering used to drop acquisitionCost entirely.)
    const cheap = candidate("cheap", BLACK, 0, 0);
    const costly = candidate("costly", BLACK, 0, 2);
    expect(ditherGrid([BLACK], 1, [costly, cheap], { colorTolerance: 0 })).toEqual(["cheap"]);
  });

  describe("the leash on how far a cell may drift from its target", () => {
    const ORANGE: Oklab = { L: 0.6, a: 0.07, b: 0.08 };
    const QUARTZ: Oklab = { L: 0.93, a: 0, b: 0.01 };
    const orangeAndQuartz = [candidate("orange", ORANGE), candidate("quartz", QUARTZ)];
    const GRID_WIDTH = 16;
    const CELL_COUNT = GRID_WIDTH * GRID_WIDTH;

    const uniformGrid = (color: Oklab): Oklab[] => new Array<Oklab>(CELL_COUNT).fill(color);
    const countOf = (chosen: readonly string[], label: string): number =>
      chosen.filter((item) => item === label).length;

    it("never lets a target outside every block's reach run away to a distant block", () => {
      // Slightly paler than the palest orange, and no paler orange exists:
      // every cell's error points the same way. Without the leash the
      // working target piles that error up cell after cell until quartz
      // finally counts as the nearest block, and stray quartz blocks land
      // in the middle of an orange face.
      const slightlyPalerThanAnyOrange = { ...ORANGE, L: ORANGE.L + 0.02 };
      const chosen = ditherGrid(uniformGrid(slightlyPalerThanAnyOrange), GRID_WIDTH, orangeAndQuartz, {
        colorTolerance: 0,
      });
      expect(countOf(chosen, "quartz")).toBe(0);
    });

    it("sizes the leash from the TRUE colors, so a deliberately shifted target cannot buy itself a longer leash", () => {
      // A contrast boost pushes targets toward the palette's extremes.
      // Measured from the shifted target, orange looks 0.12 away and
      // quartz comes within reach; measured from the true color, orange is
      // 0.01 away and quartz never is.
      const trueColor = { ...ORANGE, L: ORANGE.L + 0.01 };
      const shiftedPaler = { ...ORANGE, L: ORANGE.L + 0.12 };
      const options = { colorTolerance: 0 };

      const withTrueColors = ditherGrid(
        uniformGrid(shiftedPaler),
        GRID_WIDTH,
        orangeAndQuartz,
        options,
        uniformGrid(trueColor),
      );
      const withoutTrueColors = ditherGrid(uniformGrid(shiftedPaler), GRID_WIDTH, orangeAndQuartz, options);

      expect(countOf(withTrueColors, "quartz")).toBe(0);
      expect(countOf(withoutTrueColors, "quartz")).toBeGreaterThan(0);
    });

    it("still dithers where the nearest block is far: a mid-gray between only black and white alternates both", () => {
      const midGray: Oklab = { L: 0.4, a: 0, b: 0 };
      const chosen = ditherGrid(uniformGrid(midGray), GRID_WIDTH, [candidate("black", BLACK), candidate("white", WHITE)], {
        colorTolerance: 0,
      });
      const whiteShare = countOf(chosen, "white") / CELL_COUNT;
      expect(whiteShare).toBeGreaterThan(0.3);
      expect(whiteShare).toBeLessThan(0.5);
    });

    it("leaves a target in the first quarter of the way between two blocks on the nearer one — a gap that small is not worth speckling over", () => {
      const darkGray: Oklab = { L: 0.2, a: 0, b: 0 };
      const chosen = ditherGrid(uniformGrid(darkGray), GRID_WIDTH, [candidate("black", BLACK), candidate("white", WHITE)], {
        colorTolerance: 0,
      });
      expect(countOf(chosen, "white")).toBe(0);
    });
  });

  it("rejects an empty candidate list", () => {
    expect(() => ditherGrid([BLACK], 1, [], { colorTolerance: 0 })).toThrow(RangeError);
  });

  it("rejects trueColors that are not one per target", () => {
    const candidates = [candidate("black", BLACK)];
    expect(() => ditherGrid([BLACK, BLACK], 2, candidates, { colorTolerance: 0 }, [BLACK])).toThrow(RangeError);
  });

  it("rejects a width that does not evenly divide the target count", () => {
    const candidates = [candidate("black", BLACK)];
    expect(() => ditherGrid([BLACK, BLACK, BLACK], 2, candidates, { colorTolerance: 0 })).toThrow(RangeError);
  });

  it("rejects a non-positive width", () => {
    const candidates = [candidate("black", BLACK)];
    expect(() => ditherGrid([], 0, candidates, { colorTolerance: 0 })).toThrow(RangeError);
  });
});
