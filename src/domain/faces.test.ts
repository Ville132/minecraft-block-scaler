import { describe, expect, it } from "vitest";
import { CUBE_FACE_DIRECTIONS, faceForOrientation, faceOrientation } from "./faces.ts";

describe("faceOrientation", () => {
  it.each([
    ["down", "y", -1],
    ["up", "y", 1],
    ["north", "z", -1],
    ["south", "z", 1],
    ["west", "x", -1],
    ["east", "x", 1],
  ] as const)("%s is the %s%s end of %s", (direction, axis, sign) => {
    expect(faceOrientation(direction)).toEqual({ axis, sign });
  });

  it("gives every face a distinct (axis, sign) pair", () => {
    const pairs = CUBE_FACE_DIRECTIONS.map((direction) => {
      const { axis, sign } = faceOrientation(direction);
      return `${axis}${sign}`;
    });
    expect(new Set(pairs).size).toBe(CUBE_FACE_DIRECTIONS.length);
  });
});

describe("faceForOrientation", () => {
  it("inverts faceOrientation for every face", () => {
    for (const direction of CUBE_FACE_DIRECTIONS) {
      const { axis, sign } = faceOrientation(direction);
      expect(faceForOrientation(axis, sign)).toBe(direction);
    }
  });
});
