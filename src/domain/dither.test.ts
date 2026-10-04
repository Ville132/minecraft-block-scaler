import { describe, expect, it } from "vitest";
import type { Oklab } from "./color.ts";
import { ditherGrid, type DitherCandidate } from "./dither.ts";

const BLACK: Oklab = { L: 0, a: 0, b: 0 };
const WHITE: Oklab = { L: 1, a: 0, b: 0 };

function candidate(label: string, color: Oklab, variance = 0): DitherCandidate<string> {
  return { color, variance, item: label };
}

describe("ditherGrid", () => {
  it("picks the exact match everywhere and diffuses nothing when every target already has zero error", () => {
    const targets: Oklab[] = new Array(6).fill(BLACK);
    const candidates = [candidate("black", BLACK), candidate("white", WHITE)];
    const chosen = ditherGrid(targets, 3, candidates, { varianceWeight: 0 });
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
    const chosen = ditherGrid(targets, 4, candidates, { varianceWeight: 0 });
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
    const chosen = ditherGrid(targets, 1, candidates, { varianceWeight: 0 });
    expect(chosen).toEqual(["black", "white"]);
  });

  it("penalizes a noisy candidate via varianceWeight, same as findBestMatch", () => {
    const targets: Oklab[] = [BLACK];
    const exactButNoisy = candidate("noisy", BLACK, 0.5);
    const closeButFlat = candidate("flat", { L: 0.1, a: 0, b: 0 }, 0);
    expect(ditherGrid(targets, 1, [exactButNoisy, closeButFlat], { varianceWeight: 0 })).toEqual(["noisy"]);
    expect(ditherGrid(targets, 1, [exactButNoisy, closeButFlat], { varianceWeight: 1 })).toEqual(["flat"]);
  });

  it("rejects an empty candidate list", () => {
    expect(() => ditherGrid([BLACK], 1, [], { varianceWeight: 0 })).toThrow(RangeError);
  });

  it("rejects a width that does not evenly divide the target count", () => {
    const candidates = [candidate("black", BLACK)];
    expect(() => ditherGrid([BLACK, BLACK, BLACK], 2, candidates, { varianceWeight: 0 })).toThrow(RangeError);
  });

  it("rejects a non-positive width", () => {
    const candidates = [candidate("black", BLACK)];
    expect(() => ditherGrid([], 0, candidates, { varianceWeight: 0 })).toThrow(RangeError);
  });
});
