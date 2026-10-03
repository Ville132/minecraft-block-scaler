/**
 * The six faces of a cube, and the world-axis geometry each one maps
 * to. Minecraft's own convention: down/up run along Y, north/south
 * along Z, west/east along X; "north" and "west" are the negative end
 * of their axis. A schematic's local axes are placed directly as world
 * axes (Litematica only offers whole-cube rotation at placement time),
 * so this fixed mapping is all `shell.ts` needs to know which texture
 * belongs on a boundary voxel facing a given direction.
 */

export const CUBE_FACE_DIRECTIONS = ["down", "up", "north", "south", "east", "west"] as const;
export type CubeFaceDirection = (typeof CUBE_FACE_DIRECTIONS)[number];

export type Axis = "x" | "y" | "z";

export interface FaceOrientation {
  readonly axis: Axis;
  /** -1 = the negative end of `axis`, +1 = the positive end. */
  readonly sign: -1 | 1;
}

const FACE_ORIENTATIONS: Readonly<Record<CubeFaceDirection, FaceOrientation>> = {
  down: { axis: "y", sign: -1 },
  up: { axis: "y", sign: 1 },
  north: { axis: "z", sign: -1 },
  south: { axis: "z", sign: 1 },
  west: { axis: "x", sign: -1 },
  east: { axis: "x", sign: 1 },
};

/** Which world axis and which end of it a cube face points toward. */
export function faceOrientation(direction: CubeFaceDirection): FaceOrientation {
  return FACE_ORIENTATIONS[direction];
}

/** The inverse of {@link faceOrientation}: the one face pointing toward the given end of the given axis. */
export function faceForOrientation(axis: Axis, sign: -1 | 1): CubeFaceDirection {
  for (const direction of CUBE_FACE_DIRECTIONS) {
    const orientation = FACE_ORIENTATIONS[direction];
    if (orientation.axis === axis && orientation.sign === sign) return direction;
  }
  // Unreachable: FACE_ORIENTATIONS is an exhaustive, hand-verified table
  // covering every (axis, sign) pair exactly once (see faces.test.ts).
  throw new Error(`no face for axis '${axis}' sign ${sign}`);
}
