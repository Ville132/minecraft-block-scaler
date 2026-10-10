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
const AXES: readonly Axis[] = ["x", "y", "z"];

/** One way along one world axis: where a face points, or which way a texture's columns or rows advance. */
export interface AxisDirection {
  readonly axis: Axis;
  /** -1 = toward the negative end of `axis`, +1 = toward the positive end. */
  readonly sign: -1 | 1;
}

const FACE_ORIENTATIONS: Readonly<Record<CubeFaceDirection, AxisDirection>> = {
  down: { axis: "y", sign: -1 },
  up: { axis: "y", sign: 1 },
  north: { axis: "z", sign: -1 },
  south: { axis: "z", sign: 1 },
  west: { axis: "x", sign: -1 },
  east: { axis: "x", sign: 1 },
};

/** Which world axis and which end of it a cube face points toward. */
export function faceOrientation(direction: CubeFaceDirection): AxisDirection {
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

/** How a face's texture lies on the world: the directions its columns (`u`) and rows (`v`) advance in. */
export interface FaceTextureFrame {
  readonly u: AxisDirection;
  readonly v: AxisDirection;
}

/**
 * How Minecraft lays a full-cube block's texture onto each of its six faces —
 * the block model format's default per-face UVs.
 *
 * Every face shows its texture the way an observer standing outside that face
 * sees it: never mirrored. Geometrically, that is exactly the condition that
 * `u × v` points INTO the cube, and `shell.test.ts` asserts it for all six
 * faces of a real build, so this table cannot drift back into a mirror
 * without a test failing.
 *
 * WHY a table per FACE rather than a rule per AXIS: opposite faces are seen
 * from opposite sides, so the same world axis has to run in opposite
 * directions across them. The rule this replaced gave north and south one
 * direction, east and west one, and up and down one — which drew north, east
 * and down as mirror images. On a log, whose four sides carry the identical
 * bark, that made two of the four sides visibly different from the other two;
 * it was reported from inside the game on a mangrove log. The rule had been
 * left that way on purpose while Minecraft's horizontal convention was
 * unverified, and the in-game report is what settled it.
 *
 * Rows advance DOWN the world (`v` sign -1 on every side face) because a
 * decoded texture is row-major from its top while world y grows upward. The
 * bottom face's rows run toward -z, the top face's toward +z: seen from below,
 * the bottom face is the top face viewed through the block, so one of its axes
 * has to reverse for it not to come out mirrored.
 */
const TEXTURE_FRAME_BY_FACE: Readonly<Record<CubeFaceDirection, FaceTextureFrame>> = {
  down: { u: { axis: "x", sign: 1 }, v: { axis: "z", sign: -1 } },
  up: { u: { axis: "x", sign: 1 }, v: { axis: "z", sign: 1 } },
  north: { u: { axis: "x", sign: -1 }, v: { axis: "y", sign: -1 } },
  south: { u: { axis: "x", sign: 1 }, v: { axis: "y", sign: -1 } },
  west: { u: { axis: "z", sign: 1 }, v: { axis: "y", sign: -1 } },
  east: { u: { axis: "z", sign: -1 }, v: { axis: "y", sign: -1 } },
};

/** How Minecraft lays a texture onto the `direction` face of an unrotated cube — see {@link TEXTURE_FRAME_BY_FACE}. */
export function faceTextureFrame(direction: CubeFaceDirection): FaceTextureFrame {
  return TEXTURE_FRAME_BY_FACE[direction];
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

function axisDirectionVector({ axis, sign }: AxisDirection): Vector3 {
  return { x: axis === "x" ? sign : 0, y: axis === "y" ? sign : 0, z: axis === "z" ? sign : 0 };
}

function vectorToAxisDirection(vector: Vector3): AxisDirection {
  for (const axis of AXES) {
    const component = vector[axis];
    if (component === 1 || component === -1) return { axis, sign: component };
  }
  // Unreachable: a quarter-turn rotation carries a unit vector along one
  // axis onto a unit vector along one axis.
  throw new Error(`vector (${vector.x}, ${vector.y}, ${vector.z}) is not a unit axis direction`);
}

/** Exact (no floating point) cosine of a multiple-of-90° angle. */
function cos90(degrees: NinetyDegreeRotation): number {
  return degrees === 0 ? 1 : degrees === 180 ? -1 : 0;
}
/** Exact (no floating point) sine of a multiple-of-90° angle. */
function sin90(degrees: NinetyDegreeRotation): number {
  return degrees === 90 ? 1 : degrees === 270 ? -1 : 0;
}

/*
 * WHY clockwise: Minecraft turns a model CLOCKWISE as seen from the positive
 * end of the axis looking back at the origin — the opposite sense to the
 * right-hand rule. faces.test.ts pins it with two facts any player can
 * check: a furnace facing east is its north-fronted model at `y: 90`, and a
 * barrel facing north is its lid-up model at `x: 90`.
 */
function turnClockwiseAroundX(v: Vector3, degrees: NinetyDegreeRotation): Vector3 {
  const c = cos90(degrees);
  const s = sin90(degrees);
  return { x: v.x, y: v.y * c + v.z * s, z: -v.y * s + v.z * c };
}

function turnClockwiseAroundY(v: Vector3, degrees: NinetyDegreeRotation): Vector3 {
  const c = cos90(degrees);
  const s = sin90(degrees);
  return { x: v.x * c - v.z * s, y: v.y, z: v.x * s + v.z * c };
}

/** Where `direction` points after a blockstate variant's `x` rotation (applied first) and then its `y` rotation — Minecraft's own documented order. */
function rotateAxisDirection(
  direction: AxisDirection,
  xDegrees: NinetyDegreeRotation,
  yDegrees: NinetyDegreeRotation,
): AxisDirection {
  return vectorToAxisDirection(turnClockwiseAroundY(turnClockwiseAroundX(axisDirectionVector(direction), xDegrees), yDegrees));
}

/**
 * Where a LOCAL (model-space) face direction ends up in WORLD space after a
 * blockstate variant's `x` and `y` rotation. A log cannot pin which way round
 * the rotation goes — its two end caps are identical, so a turn the wrong way
 * still puts end grain on the right pair of faces — which is why the tests
 * use a furnace and a barrel, whose one distinctive face only lands right
 * when the direction is.
 */
export function rotateFaceDirection(
  localDirection: CubeFaceDirection,
  xDegrees: NinetyDegreeRotation,
  yDegrees: NinetyDegreeRotation,
): CubeFaceDirection {
  const { axis, sign } = rotateAxisDirection(FACE_ORIENTATIONS[localDirection], xDegrees, yDegrees);
  return faceForOrientation(axis, sign);
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

const CLOCKWISE_TURN_BY_QUARTER_TURNS: readonly NinetyDegreeRotation[] = [0, 90, 180, 270];

function opposite({ axis, sign }: AxisDirection): AxisDirection {
  return { axis, sign: sign === 1 ? -1 : 1 };
}

/**
 * How far CLOCKWISE the texture on world face `worldDirection` is turned,
 * compared with how that face shows a texture on an unrotated cube, once a
 * blockstate variant's `x`/`y` rotation has carried the model's own face
 * there.
 *
 * WHY this exists: a rotated model takes its textures with it. A sideways
 * log's bark is the same file as an upright one's, but on its long sides the
 * grain runs along the log — across the face rather than up it — and its end
 * caps arrive turned too. Sampling the texture file as if it lay in the world
 * face's own frame would draw all of that the wrong way round.
 *
 * Inputs: the world face, and the variant's `x` and `y` rotation.
 * Output: 0, 90, 180 or 270 — how far to turn the texture clockwise so it
 * reads correctly in the world face's own {@link faceTextureFrame}. Does not
 * include the face's own `rotation` field, which the model adds on top.
 * Failure modes: none for valid inputs; an internal inconsistency throws.
 */
export function textureTurnOn(
  worldDirection: CubeFaceDirection,
  xDegrees: NinetyDegreeRotation,
  yDegrees: NinetyDegreeRotation,
): NinetyDegreeRotation {
  const localDirection = unrotateFaceDirection(worldDirection, xDegrees, yDegrees);
  const carriedU = rotateAxisDirection(TEXTURE_FRAME_BY_FACE[localDirection].u, xDegrees, yDegrees);
  const { u, v } = TEXTURE_FRAME_BY_FACE[worldDirection];
  // Where a texture's rightward axis points after 0, 1, 2 and 3 clockwise
  // quarter turns: right, down, left, up. Its rows need no separate check —
  // neither frame is mirrored, so once `u` is placed, `v` can only follow.
  const uAfterQuarterTurns = [u, v, opposite(u), opposite(v)];
  const quarterTurns = uAfterQuarterTurns.findIndex(
    (candidate) => candidate.axis === carriedU.axis && candidate.sign === carriedU.sign,
  );
  if (quarterTurns === -1) {
    // Unreachable: the rotation carries the local face onto the world face,
    // so its texture's `u` lies in the world face's own plane.
    throw new Error(`texture on '${worldDirection}' left its plane at (x:${xDegrees}, y:${yDegrees})`);
  }
  return CLOCKWISE_TURN_BY_QUARTER_TURNS[quarterTurns]!;
}

/** Two clockwise turns applied one after the other, as one turn in 0..270. */
export function combineTurns(first: NinetyDegreeRotation, second: NinetyDegreeRotation): NinetyDegreeRotation {
  return ((first + second) % 360) as NinetyDegreeRotation;
}
