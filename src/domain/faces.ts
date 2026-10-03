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

/**
 * Face-direction rotation, for resolving a Minecraft blockstate
 * variant's `x`/`y` rotation fields (e.g. a log's `axis=x`/`axis=z`
 * variants, which reorient the same model rather than defining a
 * separate one — see `assets/modelResolver.ts`). Minecraft only ever
 * uses multiples of 90°, so this needs no trigonometry: a 90°/180°/270°
 * rotation around a world axis is an exact permutation of the 6 face
 * directions, computed here with plain integer arithmetic.
 */
export type NinetyDegreeRotation = 0 | 90 | 180 | 270;

interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

function directionVector(direction: CubeFaceDirection): Vector3 {
  const { axis, sign } = FACE_ORIENTATIONS[direction];
  return { x: axis === "x" ? sign : 0, y: axis === "y" ? sign : 0, z: axis === "z" ? sign : 0 };
}

function vectorToDirection(vector: Vector3): CubeFaceDirection {
  for (const direction of CUBE_FACE_DIRECTIONS) {
    const v = directionVector(direction);
    if (v.x === vector.x && v.y === vector.y && v.z === vector.z) return direction;
  }
  // Unreachable: rotateAroundX/Y always produce a unit vector along one
  // axis when given a unit input, for every multiple-of-90° rotation.
  throw new Error(`vector (${vector.x}, ${vector.y}, ${vector.z}) is not a unit face direction`);
}

/** Exact (no floating point) cosine of a multiple-of-90° angle. */
function cos90(degrees: NinetyDegreeRotation): number {
  return degrees === 0 ? 1 : degrees === 180 ? -1 : 0;
}
/** Exact (no floating point) sine of a multiple-of-90° angle. */
function sin90(degrees: NinetyDegreeRotation): number {
  return degrees === 90 ? 1 : degrees === 270 ? -1 : 0;
}

function rotateAroundX(v: Vector3, degrees: NinetyDegreeRotation): Vector3 {
  const c = cos90(degrees);
  const s = sin90(degrees);
  return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c };
}

function rotateAroundY(v: Vector3, degrees: NinetyDegreeRotation): Vector3 {
  const c = cos90(degrees);
  const s = sin90(degrees);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}

/**
 * Where a LOCAL (model-space) face direction ends up in WORLD space
 * after a blockstate variant's `x` rotation (applied first) and then
 * `y` rotation — Minecraft's own documented order. Verified by hand
 * against real game data: applying oak_log's actual `axis=z` (`x:90`)
 * and `axis=x` (`x:90,y:90`) variant rotations to its cube_column
 * model's down/up="end", north/south/east/west="side" face layout
 * reproduces the known correct result (bark rings on north/south, and
 * east/west respectively) — see faces.test.ts.
 */
export function rotateFaceDirection(
  localDirection: CubeFaceDirection,
  xDegrees: NinetyDegreeRotation,
  yDegrees: NinetyDegreeRotation,
): CubeFaceDirection {
  const rotated = rotateAroundY(rotateAroundX(directionVector(localDirection), xDegrees), yDegrees);
  return vectorToDirection(rotated);
}

/** The inverse of {@link rotateFaceDirection}: which LOCAL direction ends up at the given WORLD direction after the same rotation — what a renderer needs when it has a world face and wants the model's local face to sample. */
export function unrotateFaceDirection(
  worldDirection: CubeFaceDirection,
  xDegrees: NinetyDegreeRotation,
  yDegrees: NinetyDegreeRotation,
): CubeFaceDirection {
  for (const candidate of CUBE_FACE_DIRECTIONS) {
    if (rotateFaceDirection(candidate, xDegrees, yDegrees) === worldDirection) return candidate;
  }
  // Unreachable: rotateFaceDirection is a bijection over the 6 directions.
  throw new Error(`no local direction rotates to '${worldDirection}' at (x:${xDegrees}, y:${yDegrees})`);
}
