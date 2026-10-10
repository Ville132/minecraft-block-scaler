import { describe, expect, it } from "vitest";
import {
  combineTurns,
  CUBE_FACE_DIRECTIONS,
  faceForOrientation,
  faceOrientation,
  faceTextureFrame,
  rotateFaceDirection,
  textureTurnOn,
  unrotateFaceDirection,
  type Axis,
  type CubeFaceDirection,
  type NinetyDegreeRotation,
} from "./faces.ts";

const QUARTER_TURNS: readonly NinetyDegreeRotation[] = [0, 90, 180, 270];

/** Every face's image under one rotation, as a table to compare whole. */
function rotationTable(xDegrees: NinetyDegreeRotation, yDegrees: NinetyDegreeRotation) {
  return Object.fromEntries(
    CUBE_FACE_DIRECTIONS.map((direction) => [direction, rotateFaceDirection(direction, xDegrees, yDegrees)]),
  );
}

/** Every world face's texture turn under one rotation, as a table to compare whole. */
function turnTable(xDegrees: NinetyDegreeRotation, yDegrees: NinetyDegreeRotation) {
  return Object.fromEntries(
    CUBE_FACE_DIRECTIONS.map((direction) => [direction, textureTurnOn(direction, xDegrees, yDegrees)]),
  );
}

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

  // A log cannot settle which way round Minecraft turns a model: its two end
  // caps are identical, so turning the wrong way still lands end grain on the
  // right pair of faces. These blocks have ONE distinctive face each, and
  // their real blockstates (vanilla `furnace.json`, `barrel.json`) only put
  // it where it belongs when the direction is right.
  it.each([
    ["east", 90],
    ["south", 180],
    ["west", 270],
  ] as const)("puts a furnace's front on %s at y:%s, its model having the front on north", (facing, yDegrees) => {
    expect(rotateFaceDirection("north", 0, yDegrees)).toBe(facing);
  });

  it.each([
    ["north", 90, 0],
    ["east", 90, 90],
    ["south", 90, 180],
    ["west", 90, 270],
    ["down", 180, 0],
  ] as const)("puts a barrel's lid on %s at x:%s y:%s, its model having the lid on top", (facing, xDegrees, yDegrees) => {
    expect(rotateFaceDirection("up", xDegrees, yDegrees)).toBe(facing);
  });

  it("lays a log along z at its real axis=z rotation (x:90): end caps on north and south", () => {
    expect(rotationTable(90, 0)).toEqual({
      down: "south",
      up: "north",
      north: "down",
      south: "up",
      east: "east",
      west: "west",
    });
  });

  it("lays a log along x at its real axis=x rotation (x:90, y:90): end caps on east and west", () => {
    expect(rotationTable(90, 90)).toEqual({
      down: "west",
      up: "east",
      north: "down",
      south: "up",
      east: "south",
      west: "north",
    });
  });

  it("is a bijection (6 distinct outputs) for every multiple-of-90 x/y combination", () => {
    for (const xDegrees of QUARTER_TURNS) {
      for (const yDegrees of QUARTER_TURNS) {
        const outputs = CUBE_FACE_DIRECTIONS.map((d) => rotateFaceDirection(d, xDegrees, yDegrees));
        expect(new Set(outputs).size).toBe(CUBE_FACE_DIRECTIONS.length);
      }
    }
  });
});

describe("unrotateFaceDirection", () => {
  it("inverts rotateFaceDirection for every direction and every multiple-of-90 x/y combination", () => {
    for (const direction of CUBE_FACE_DIRECTIONS) {
      for (const xDegrees of QUARTER_TURNS) {
        for (const yDegrees of QUARTER_TURNS) {
          const world = rotateFaceDirection(direction, xDegrees, yDegrees);
          expect(unrotateFaceDirection(world, xDegrees, yDegrees)).toBe(direction);
        }
      }
    }
  });
});

describe("textureTurnOn", () => {
  it("turns nothing on an unrotated block", () => {
    expect(turnTable(0, 0)).toEqual({ down: 0, up: 0, north: 0, south: 0, east: 0, west: 0 });
  });

  it("turns the top with the block under y, the bottom the other way, and never a side", () => {
    // Turning a block clockwise as seen from above turns its top clockwise to
    // someone looking down at it — and its bottom ANTI-clockwise to someone
    // looking up at it. Its sides only swap places; none of them tips over.
    expect(turnTable(0, 90)).toEqual({ down: 270, up: 90, north: 0, south: 0, east: 0, west: 0 });
  });

  it("runs a sideways log's grain along its length, on all four long sides", () => {
    // Bark grain runs top to bottom in the texture file. Laid along z, the
    // log's grain must run along z on every face that is not an end cap —
    // which needs the two side faces turned a quarter, and is exactly what
    // drawing the bark unturned got wrong.
    const grainAxisOn = (direction: CubeFaceDirection, xDegrees: NinetyDegreeRotation, yDegrees: NinetyDegreeRotation): Axis => {
      const { u, v } = faceTextureFrame(direction);
      return textureTurnOn(direction, xDegrees, yDegrees) % 180 === 0 ? v.axis : u.axis;
    };
    for (const longSide of ["down", "up", "east", "west"] as const) {
      expect(grainAxisOn(longSide, 90, 0), `axis=z, ${longSide}`).toBe("z");
    }
    for (const longSide of ["down", "up", "north", "south"] as const) {
      expect(grainAxisOn(longSide, 90, 90), `axis=x, ${longSide}`).toBe("x");
    }
  });

  it("stands both end caps of a sideways log upright once its model's own up-face turn is added", () => {
    // Vanilla's cube_column_horizontal.json — the model every sideways log
    // uses — gives its up face (end grain) `"rotation": 180` and no other
    // face any. Mojang added it so the caps would not show upside down,
    // which is only true if the turn computed here is right.
    const horizontalModelUpFaceTurn: NinetyDegreeRotation = 180;
    expect(combineTurns(textureTurnOn("north", 90, 0), horizontalModelUpFaceTurn)).toBe(0);
    expect(textureTurnOn("south", 90, 0)).toBe(0);
    expect(combineTurns(textureTurnOn("east", 90, 90), horizontalModelUpFaceTurn)).toBe(0);
    expect(textureTurnOn("west", 90, 90)).toBe(0);
  });

  it("gives every face a turn for every rotation", () => {
    for (const xDegrees of QUARTER_TURNS) {
      for (const yDegrees of QUARTER_TURNS) {
        for (const direction of CUBE_FACE_DIRECTIONS) {
          expect(QUARTER_TURNS).toContain(textureTurnOn(direction, xDegrees, yDegrees));
        }
      }
    }
  });
});

describe("combineTurns", () => {
  it("adds two clockwise turns", () => {
    expect(combineTurns(90, 90)).toBe(180);
  });

  it("wraps past a full turn", () => {
    expect(combineTurns(270, 180)).toBe(90);
    expect(combineTurns(180, 180)).toBe(0);
  });
});
