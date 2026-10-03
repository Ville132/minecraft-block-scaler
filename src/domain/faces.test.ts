import { describe, expect, it } from "vitest";
import {
  CUBE_FACE_DIRECTIONS,
  faceForOrientation,
  faceOrientation,
  rotateFaceDirection,
  unrotateFaceDirection,
  type CubeFaceDirection,
  type NinetyDegreeRotation,
} from "./faces.ts";

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

describe("rotateFaceDirection", () => {
  it("is the identity at (x:0, y:0)", () => {
    for (const direction of CUBE_FACE_DIRECTIONS) {
      expect(rotateFaceDirection(direction, 0, 0)).toBe(direction);
    }
  });

  // Hand-verified against real game data: oak_log's blockstate uses
  // exactly these rotation values for its axis=z and axis=x variants
  // (see faces.ts's header comment on rotateFaceDirection). Its base
  // model (cube_column / cube_column_horizontal) puts the end-cap
  // texture on local down/up and the side texture on local
  // north/south/east/west; the known-correct in-game result is bark
  // rings on north/south for axis=z, and on east/west for axis=x.
  it("matches oak_log's real axis=z rotation (x:90): end-caps move to north/south", () => {
    const rotated: Record<CubeFaceDirection, CubeFaceDirection> = {
      down: rotateFaceDirection("down", 90, 0),
      up: rotateFaceDirection("up", 90, 0),
      north: rotateFaceDirection("north", 90, 0),
      south: rotateFaceDirection("south", 90, 0),
      east: rotateFaceDirection("east", 90, 0),
      west: rotateFaceDirection("west", 90, 0),
    };
    expect(rotated).toEqual({
      down: "north",
      up: "south",
      north: "up",
      south: "down",
      east: "east",
      west: "west",
    });
  });

  it("matches oak_log's real axis=x rotation (x:90, y:90): end-caps move to east/west", () => {
    const rotated: Record<CubeFaceDirection, CubeFaceDirection> = {
      down: rotateFaceDirection("down", 90, 90),
      up: rotateFaceDirection("up", 90, 90),
      north: rotateFaceDirection("north", 90, 90),
      south: rotateFaceDirection("south", 90, 90),
      east: rotateFaceDirection("east", 90, 90),
      west: rotateFaceDirection("west", 90, 90),
    };
    expect(rotated).toEqual({
      down: "west",
      up: "east",
      north: "up",
      south: "down",
      east: "north",
      west: "south",
    });
  });

  it("is a bijection (6 distinct outputs) for every multiple-of-90 x/y combination", () => {
    const rotations: readonly NinetyDegreeRotation[] = [0, 90, 180, 270];
    for (const xDegrees of rotations) {
      for (const yDegrees of rotations) {
        const outputs = CUBE_FACE_DIRECTIONS.map((d) => rotateFaceDirection(d, xDegrees, yDegrees));
        expect(new Set(outputs).size).toBe(CUBE_FACE_DIRECTIONS.length);
      }
    }
  });
});

describe("unrotateFaceDirection", () => {
  it("inverts rotateFaceDirection for every direction and every multiple-of-90 x/y combination", () => {
    const rotations: readonly NinetyDegreeRotation[] = [0, 90, 180, 270];
    for (const direction of CUBE_FACE_DIRECTIONS) {
      for (const xDegrees of rotations) {
        for (const yDegrees of rotations) {
          const world = rotateFaceDirection(direction, xDegrees, yDegrees);
          expect(unrotateFaceDirection(world, xDegrees, yDegrees)).toBe(direction);
        }
      }
    }
  });
});
