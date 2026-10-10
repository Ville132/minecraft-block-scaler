/**
 * Builds the actual voxel grid for a replica: which positions are
 * filled (hollow shell vs. solid), and which palette block each filled
 * position should be, by sampling the corresponding region of the
 * source block's own face texture and nearest-matching its color.
 *
 * Pure domain logic — it takes already-decoded pixel data in, so it has
 * no browser dependency and is fully deterministic and unit-testable
 * (see shell.test.ts), unlike `assets/textureDecoder.ts`.
 */

import type { DecodedTexture } from "../assets/textureDecoder.ts";
import {
  averageOklab,
  createMatcher,
  DEFAULT_COLOR_TOLERANCE,
  linearRgbToOklab,
  rgb8ToLinearRgb,
  type MatchOptions,
  type Oklab,
  type ScoredCandidate,
} from "./color.ts";
import {
  amplifyLightness,
  assertContrastGain,
  assessContrastHeadroom,
  DEFAULT_CONTRAST_GAIN,
  type ContrastHeadroom,
} from "./contrast.ts";
import { ditherGrid } from "./dither.ts";
import {
  CUBE_FACE_DIRECTIONS,
  faceForOrientation,
  faceOrientation,
  type Axis,
  type CubeFaceDirection,
} from "./faces.ts";
import type { PaletteBlock } from "./palette.ts";

/**
 * `"hollow"` fills only the outer shell (see {@link isShellVoxel}).
 * `"solid-cheap-core"` and `"solid-full"` both fill every position, but
 * differ in what the INTERIOR — the part no one will ever see once the
 * shell closes over it — is made of: `"solid-full"` color-matches every
 * interior voxel exactly like a shell voxel, which for a large build
 * means tens of thousands of individually-gathered blocks chosen for a
 * color nobody can look at; `"solid-cheap-core"` instead fills the
 * entire interior with one fixed, cheap block (see
 * {@link BuildVoxelGridParams.interiorFillBlock}), which is both honest
 * (a hidden block has no "right" color to match) and a large material
 * saving.
 */
export type FillStyle = "hollow" | "solid-cheap-core" | "solid-full";

export interface Voxel {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly paletteBlock: PaletteBlock;
}

export interface BuildVoxelGridParams {
  readonly edgeBlocks: number;
  readonly fillStyle: FillStyle;
  /** The source block's own decoded face textures — what every voxel's color is sampled from. */
  readonly sourceFaceTextures: Readonly<Record<CubeFaceDirection, DecodedTexture>>;
  /** Candidate replacement blocks (see `palette.ts`); must be non-empty. */
  readonly palette: readonly PaletteBlock[];
  /** How much worse than the single nearest color a candidate block may be and still win on having a flatter texture — see `color.ts`'s `MatchOptions.colorTolerance`. `0` reproduces plain nearest-color matching. Defaults to {@link DEFAULT_COLOR_TOLERANCE}. */
  readonly colorTolerance?: number;
  /** Opt-in contrast enhancement: how much to exaggerate each face's own light/dark pattern around that face's own average lightness — see `contrast.ts`'s `amplifyLightness`. `1` (the default) means none: every pixel matches its own true color. A face's average color never moves at any gain. Must be finite and at least 1. */
  readonly contrastGain?: number;
  /** Enables Floyd-Steinberg error-diffusion dithering (see `dither.ts`) when `true`; `false` or omitted disables it, reproducing plain per-pixel nearest-match exactly as before dithering existed. Off by default — dithering trades a flat, uniformly-off look for a more accurate one from a distance at the cost of a speckled look up close, and that tradeoff is the user's call. */
  readonly dither?: boolean;
  /** Required when `fillStyle` is `"solid-cheap-core"` (and ignored otherwise): the single block every interior voxel is filled with, skipping color-matching for that voxel entirely. */
  readonly interiorFillBlock?: PaletteBlock;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive integer, got ${value}`);
  }
}

/** Whether (x, y, z) sits on the outer surface of an `edgeBlocks`-sided cube — the set of positions a hollow shell fills. */
export function isShellVoxel(x: number, y: number, z: number, edgeBlocks: number): boolean {
  const max = edgeBlocks - 1;
  return x === 0 || x === max || y === 0 || y === max || z === 0 || z === max;
}

interface AxisBoundary {
  readonly distance: number;
  readonly sign: -1 | 1;
}

/** How close `coord` is to either end of `[0, edgeBlocks - 1]`, and which end is nearer. Ties within one axis default to the negative end — arbitrary but deterministic, since a voxel exactly centered on one axis has no principled "more correct" side. */
function nearestBoundary(coord: number, edgeBlocks: number): AxisBoundary {
  const distanceToMin = coord;
  const distanceToMax = edgeBlocks - 1 - coord;
  return distanceToMin <= distanceToMax
    ? { distance: distanceToMin, sign: -1 }
    : { distance: distanceToMax, sign: 1 };
}

/**
 * Which face(s) "own" a voxel's appearance — usually exactly one, but a
 * voxel on a SIDE-TO-SIDE edge (e.g. where west meets north) returns
 * BOTH tied candidates, for {@link buildVoxelGrid} to blend, rather
 * than arbitrarily picking one: unlike Y, neither side face has a
 * principled claim to override the other there.
 *
 * Implements PLAN.md's edge-ownership rule (Y beats the rest) for
 * boundary voxels that touch more than one face, and extends the same
 * priority to interior voxels (relevant only for solid fill, where
 * every position still needs some texture to sample): the governing
 * axis/axes are whichever is closest to its boundary. Y wins outright
 * whenever it is at or within that minimum distance — "the cap owns
 * the rim" (and, by the same reasoning, every corner too, since a
 * corner is just a rim position where two sides also tie). Only when Y
 * is strictly farther, and Z and X are tied with each other, is there
 * a genuine side-to-side tie with no such reason to prefer one, which
 * is the one case this returns two faces for.
 */
export function governingFaces(
  x: number,
  y: number,
  z: number,
  edgeBlocks: number,
): readonly [CubeFaceDirection] | readonly [CubeFaceDirection, CubeFaceDirection] {
  const yBoundary = nearestBoundary(y, edgeBlocks);
  const zBoundary = nearestBoundary(z, edgeBlocks);
  const xBoundary = nearestBoundary(x, edgeBlocks);
  const minDistance = Math.min(yBoundary.distance, zBoundary.distance, xBoundary.distance);

  if (yBoundary.distance === minDistance) {
    return [faceForOrientation("y", yBoundary.sign)];
  }
  const zTied = zBoundary.distance === minDistance;
  const xTied = xBoundary.distance === minDistance;
  if (zTied && xTied) {
    return [faceForOrientation("z", zBoundary.sign), faceForOrientation("x", xBoundary.sign)];
  }
  return zTied ? [faceForOrientation("z", zBoundary.sign)] : [faceForOrientation("x", xBoundary.sign)];
}

interface FaceScreenAxes {
  readonly uAxis: Axis;
  readonly vAxis: Axis;
  /** Whether the voxel's raw world coordinate along `vAxis` must be mirrored (`edgeBlocks - 1 - coord`) before use as a texture row — see this function's doc comment. `u` is never flipped: this app has not independently verified Minecraft's default per-face horizontal (U) handedness convention (east/west and north/south may legitimately be mirror images of each other; a modding reference that documents the vertical convention explicitly flags the horizontal one as genuinely hard to get right without a visual tool), so it is left as-is rather than "corrected" on an unverified guess. */
  readonly vFlip: boolean;
}

/**
 * The screen-space (u, v) axes for a face, chosen so "up" in texture
 * space is always the block's real vertical (Y) axis on the four SIDE
 * faces — the semantically correct choice for any texture with a top
 * and bottom, like bark. The two CAP faces (up/down) have no natural
 * vertical of their own, so they keep a fixed, arbitrary-but-consistent
 * (x, z) convention, and no flip (there is no "upside down" for them).
 *
 * This replaced a generic "the two non-governing axes in x-y-z order"
 * rule that put z (depth) on the vertical axis of the east/west faces
 * instead of y — a real bug, reported against a real resource pack's
 * mangrove_log: it rendered the bark pattern rotated 90° on east/west
 * relative to north/south. Every test up to that point used a flat,
 * single-color texture, which can never reveal a rotation bug, since
 * rotating a solid color changes nothing.
 *
 * `vFlip` on the side faces fixes a second, separate bug: a decoded PNG
 * is row-major from the TOP-left (`textureDecoder.ts`), so texture row 0
 * is the texture's top, but world y=0 is the build's BOTTOM — using y
 * directly as the texture row therefore sampled the texture's top at the
 * build's bottom and vice versa, rendering every side face upside down.
 * Mirroring y before use corrects that. (Confirmed against the block
 * model format's own documented convention: "the v coordinate ... is
 * upside down, i.e. [0,0] is the top left corner" — this is independent
 * of, and not to be confused with, the unresolved horizontal question
 * above.)
 */
function faceScreenAxes(governingAxis: Axis): FaceScreenAxes {
  switch (governingAxis) {
    case "x":
      return { uAxis: "z", vAxis: "y", vFlip: true }; // east/west: horizontal = around (z), vertical = true up (y), mirrored
    case "z":
      return { uAxis: "x", vAxis: "y", vFlip: true }; // north/south: horizontal = around (x), vertical = true up (y), mirrored
    case "y":
      return { uAxis: "x", vAxis: "z", vFlip: false }; // up/down: no natural vertical; fixed (x, z) convention, no flip
  }
}

/** Mirrors a coordinate within `[0, edgeBlocks - 1]` — its own inverse, so the same call correctly undoes itself in {@link positionOnFace}. */
function flipCoord(coord: number, edgeBlocks: number): number {
  return edgeBlocks - 1 - coord;
}

/** The voxel's position along the face's screen-space (u, v) axes — see {@link faceScreenAxes}. */
function faceLocalCoordinates(
  direction: CubeFaceDirection,
  x: number,
  y: number,
  z: number,
  edgeBlocks: number,
): { readonly uCoord: number; readonly vCoord: number } {
  const { axis: governingAxis } = faceOrientation(direction);
  const coordByAxis: Readonly<Record<Axis, number>> = { x, y, z };
  const { uAxis, vAxis, vFlip } = faceScreenAxes(governingAxis);
  const rawV = coordByAxis[vAxis];
  return { uCoord: coordByAxis[uAxis], vCoord: vFlip ? flipCoord(rawV, edgeBlocks) : rawV };
}

/**
 * The inverse of {@link faceLocalCoordinates}: the world position lying
 * on `direction`'s own boundary plane at local coordinates (u, v).
 * Used by the preview UI to read off, face by face, what the finished
 * replica would actually look like from outside — since every position
 * on a face's plane already holds whichever voxel the edge-ownership
 * rule in {@link governingFace} resolved it to, reading the grid this
 * way automatically reflects that rule with no special-casing.
 */
export function positionOnFace(
  direction: CubeFaceDirection,
  uCoord: number,
  vCoord: number,
  edgeBlocks: number,
): { readonly x: number; readonly y: number; readonly z: number } {
  const { axis: governingAxis, sign } = faceOrientation(direction);
  const { uAxis, vAxis, vFlip } = faceScreenAxes(governingAxis);
  const coordByAxis: Record<Axis, number> = { x: 0, y: 0, z: 0 };
  coordByAxis[governingAxis] = sign === -1 ? 0 : edgeBlocks - 1;
  coordByAxis[uAxis] = uCoord;
  coordByAxis[vAxis] = vFlip ? flipCoord(vCoord, edgeBlocks) : vCoord;
  return { x: coordByAxis.x, y: coordByAxis.y, z: coordByAxis.z };
}

export interface PixelRegion {
  readonly start: number;
  readonly endExclusive: number;
}

/**
 * The span of source-texture pixels one voxel coordinate corresponds
 * to, along one axis.
 *
 * Output: for an up-scale (`edgeBlocks` a multiple of `textureSize`,
 * `classifyScale`'s `"exact"`) this is always a single pixel; for a
 * down-scale (`"reduced"`) it is the block of pixels that collapse into
 * this one voxel. The same formula produces both without branching —
 * `endExclusive` is clamped to at least `start + 1` because the naive
 * `floor((voxelCoord + 1) * textureSize / edgeBlocks)` collapses to the
 * same value as `start` whenever several voxels share one pixel (every
 * up-scaled voxel except the last of each group), which would otherwise
 * produce an empty, unaverageable region instead of that shared pixel.
 * Failure mode: throws `RangeError` for invalid inputs; callers are
 * expected to only pass `edgeBlocks` values `classifyScale` would not
 * call `"distorted"` — this function does not re-check that, since
 * `scale.ts` already owns that decision.
 */
export function pixelRegionForVoxelCoord(
  voxelCoord: number,
  edgeBlocks: number,
  textureSize: number,
): PixelRegion {
  assertPositiveInteger(edgeBlocks, "edgeBlocks");
  assertPositiveInteger(textureSize, "textureSize");
  if (!Number.isInteger(voxelCoord) || voxelCoord < 0 || voxelCoord >= edgeBlocks) {
    throw new RangeError(`voxelCoord must be an integer in [0, ${edgeBlocks - 1}], got ${voxelCoord}`);
  }
  const start = Math.floor((voxelCoord * textureSize) / edgeBlocks);
  const naiveEnd = Math.floor(((voxelCoord + 1) * textureSize) / edgeBlocks);
  return { start, endExclusive: Math.max(start + 1, naiveEnd) };
}

interface LightnessStats {
  /** Mean Oklab lightness over every pixel — what contrast enhancement amplifies AROUND. */
  readonly mean: number;
  /** Brightest pixel's lightness minus darkest pixel's — how much internal light/dark pattern the texture has. */
  readonly span: number;
}

/**
 * One streaming pass over every pixel of `texture`, for its mean and
 * span of Oklab lightness — no per-pixel array, same reasoning as
 * `palette.ts`'s `screenedTextureMean`. Full resolution, independent of
 * `edgeBlocks` or how coarsely a particular build happens to sample this
 * same texture (see {@link pixelRegionForVoxelCoord}). Alpha is ignored,
 * same trust-the-source-is-opaque reasoning as {@link averageColorInRegion}.
 */
function lightnessStatsOf(texture: DecodedTexture): LightnessStats {
  let sum = 0;
  let darkest = Infinity;
  let brightest = -Infinity;
  let pixelCount = 0;
  for (let i = 0; i < texture.pixels.length; i += 4) {
    const lightness = linearRgbToOklab(
      rgb8ToLinearRgb({ r: texture.pixels[i]!, g: texture.pixels[i + 1]!, b: texture.pixels[i + 2]! }),
    ).L;
    sum += lightness;
    if (lightness < darkest) darkest = lightness;
    if (lightness > brightest) brightest = lightness;
    pixelCount++;
  }
  return { mean: sum / pixelCount, span: brightest - darkest };
}

/** {@link lightnessStatsOf} for each face, scanning a texture that several faces share only once — every `cube_all` block hands all six faces the same decoded texture object (see `ui/buildReplica.ts`). */
function lightnessStatsByFace(
  sourceFaceTextures: Readonly<Record<CubeFaceDirection, DecodedTexture>>,
): ReadonlyMap<CubeFaceDirection, LightnessStats> {
  const statsByTexture = new Map<DecodedTexture, LightnessStats>();
  return new Map(
    CUBE_FACE_DIRECTIONS.map((direction) => {
      const texture = sourceFaceTextures[direction];
      let stats = statsByTexture.get(texture);
      if (stats === undefined) {
        stats = lightnessStatsOf(texture);
        statsByTexture.set(texture, stats);
      }
      return [direction, stats];
    }),
  );
}

/**
 * Whether any face of the source block has a light/dark pattern faint
 * enough that contrast enhancement would help — see `contrast.ts`'s
 * `assessContrastHeadroom` for what the result means. A thin, texture-
 * aware wrapper: this module owns reading pixels out of a
 * `DecodedTexture`, `contrast.ts` owns the judgement, and this is where
 * the two meet. Takes no palette: whether a face is faint is a property
 * of the source alone.
 */
export function assessReplicaContrastHeadroom(
  sourceFaceTextures: Readonly<Record<CubeFaceDirection, DecodedTexture>>,
): ContrastHeadroom {
  const spans = [...lightnessStatsByFace(sourceFaceTextures).values()].map((stats) => stats.span);
  return assessContrastHeadroom(spans);
}

/**
 * The average color across a rectangular pixel region of a decoded texture,
 * as the Oklab centroid of those pixels.
 *
 * Averaged IN Oklab rather than in linear light and converted once, because
 * Oklab's cube-root nonlinearity makes those two different points — the same
 * reasoning `palette.ts`'s `representativeAppearance` sets out for candidate
 * colors. This is the other half of that: it produces every voxel's TARGET
 * color, so until both sides averaged the same way the two were being
 * compared across a systematic gap. A no-op when one pixel fills the region
 * (every exact up-scale), real on any down-scale, where many pixels collapse
 * into one voxel.
 *
 * Alpha is ignored: unlike `palette.ts`'s candidates, the source block's
 * texture is trusted to be opaque by construction (see this module's header).
 */
function averageColorInRegion(texture: DecodedTexture, uRegion: PixelRegion, vRegion: PixelRegion): Oklab {
  const samples: Oklab[] = [];
  for (let v = vRegion.start; v < vRegion.endExclusive; v++) {
    for (let u = uRegion.start; u < uRegion.endExclusive; u++) {
      const pixelIndex = (v * texture.width + u) * 4;
      samples.push(
        linearRgbToOklab(
          rgb8ToLinearRgb({
            r: texture.pixels[pixelIndex]!,
            g: texture.pixels[pixelIndex + 1]!,
            b: texture.pixels[pixelIndex + 2]!,
          }),
        ),
      );
    }
  }
  return averageOklab(samples);
}

interface FaceSample {
  readonly texture: DecodedTexture;
  readonly uRegion: PixelRegion;
  readonly vRegion: PixelRegion;
}

/** The pixel region each of `directions` (1 for most voxels, 2 for a side-to-side edge — see {@link governingFaces}) samples at (x, y, z), region info only — no pixel scanning yet, so this is cheap enough to compute before checking the cache. */
function faceSamplesAt(
  directions: readonly CubeFaceDirection[],
  x: number,
  y: number,
  z: number,
  edgeBlocks: number,
  sourceFaceTextures: Readonly<Record<CubeFaceDirection, DecodedTexture>>,
): FaceSample[] {
  return directions.map((direction) => {
    const texture = sourceFaceTextures[direction];
    const { uCoord, vCoord } = faceLocalCoordinates(direction, x, y, z, edgeBlocks);
    return {
      texture,
      uRegion: pixelRegionForVoxelCoord(uCoord, edgeBlocks, texture.width),
      vRegion: pixelRegionForVoxelCoord(vCoord, edgeBlocks, texture.height),
    };
  });
}

/**
 * The sorted, distinct pixel regions {@link pixelRegionForVoxelCoord}
 * produces as `voxelCoord` ranges over `[0, edgeBlocks)` — i.e. one
 * entry per texture "cell" a voxel along this axis can land on. For an
 * up-scale (`edgeBlocks` a multiple of `textureSize`) this is every
 * single pixel, in order; for a down-scale it is the (fewer) coarser
 * regions several pixels collapse into. `pixelRegionForVoxelCoord`'s own
 * `start` is monotonically non-decreasing in `voxelCoord`, so collapsing
 * consecutive repeats is sufficient — no separate sort/dedup needed.
 */
function distinctPixelRegions(edgeBlocks: number, textureSize: number): PixelRegion[] {
  const regions: PixelRegion[] = [];
  for (let voxelCoord = 0; voxelCoord < edgeBlocks; voxelCoord++) {
    const region = pixelRegionForVoxelCoord(voxelCoord, edgeBlocks, textureSize);
    const previous = regions[regions.length - 1];
    if (previous === undefined || previous.start !== region.start) regions.push(region);
  }
  return regions;
}

/**
 * Scores every palette block by what it would actually SHOW on `directions`
 * — the faces this voxel turns outward.
 *
 * This is the difference between matching a log and matching the idea of a
 * log. A block's single blended colour is a colour that appears on none of
 * its faces: oak_log's sits 0.138 Oklab from both its bark and its end
 * grain, seven times the entire matching tolerance. On the replica's top
 * face what you see is the end grain, on a side you see bark, and those are
 * the colours worth comparing against.
 *
 * `variance` comes per face too, which matters as much as the colour: scored
 * against the block's blend, a log's perfectly flat bark looked wildly busy
 * and lost the matcher's flatness tie-break to any single-texture block.
 *
 * An edge voxel shows two faces at once and gets the average of the two,
 * matched against the equally blended target — the same convention the
 * caller uses on the source side.
 */
export function candidatesFacing(
  palette: readonly PaletteBlock[],
  directions: readonly CubeFaceDirection[],
): ScoredCandidate<PaletteBlock>[] {
  return palette.map((block) => {
    const faces = directions.map((direction) => block.appearanceByFace[direction]);
    return {
      color: faces.length === 1 ? faces[0]!.color : averageOklab(faces.map((face) => face.color)),
      variance: faces.reduce((sum, face) => sum + face.variance, 0) / faces.length,
      acquisitionCost: block.acquisitionCost,
      item: block,
    };
  });
}

/** One face's contrast enhancement: its own mean lightness (what to amplify around) and the gain. */
interface FaceContrast {
  readonly meanLightness: number;
  readonly gain: number;
}

interface DitheredFaceGrid {
  /** Row-major over (vIndex, uIndex); length === uRegions.length * vRegions.length. */
  readonly chosen: readonly PaletteBlock[];
  readonly uRegions: readonly PixelRegion[];
  readonly vRegions: readonly PixelRegion[];
  readonly uIndexByStart: ReadonlyMap<number, number>;
  readonly vIndexByStart: ReadonlyMap<number, number>;
}

/**
 * Dithers one face's entire texture up front, cell by cell in scan
 * order (see `dither.ts`) — the reason dithered mode cannot reuse
 * {@link buildVoxelGrid}'s own per-voxel `resolvedColorCache`: a
 * dithered cell's choice depends on the (also dithered) choices of
 * cells already visited, so it cannot be resolved independently, one
 * voxel at a time, the way the undithered path resolves each position.
 * Doing it once per face, up front, keeps the cost bounded by
 * `textureSize^2` regardless of replica size, same as the undithered
 * cache already was.
 *
 * When `contrast` is given, each cell's raw averaged color is amplified
 * (see `contrast.ts`'s `amplifyLightness`) around THIS face's own mean
 * lightness before dithering ever sees it, so dithering spreads error
 * around the same targets the undithered path matches against — the two
 * modes disagree about WHICH block a position lands on, never about what
 * color they were each aiming for. The un-amplified colors go along too:
 * how far dithering may wander from a cell is sized by how well the
 * palette matches the pixel's TRUE color (see `ditherGrid`), so a boost
 * that pushes a target out of the palette's reach cannot buy it the
 * freedom to wander into another color family.
 */
function buildDitheredFaceGrid(
  texture: DecodedTexture,
  edgeBlocks: number,
  paletteCandidates: readonly ScoredCandidate<PaletteBlock>[],
  matchOptions: MatchOptions,
  contrast: FaceContrast | undefined,
): DitheredFaceGrid {
  const uRegions = distinctPixelRegions(edgeBlocks, texture.width);
  const vRegions = distinctPixelRegions(edgeBlocks, texture.height);

  const trueColors: Oklab[] = [];
  for (const vRegion of vRegions) {
    for (const uRegion of uRegions) {
      trueColors.push(averageColorInRegion(texture, uRegion, vRegion));
    }
  }
  const targets =
    contrast === undefined
      ? trueColors
      : trueColors.map((trueColor) => amplifyLightness(trueColor, contrast.meanLightness, contrast.gain));

  const chosen = ditherGrid(targets, uRegions.length, paletteCandidates, matchOptions, trueColors);
  return {
    chosen,
    uRegions,
    vRegions,
    uIndexByStart: new Map(uRegions.map((region, index) => [region.start, index])),
    vIndexByStart: new Map(vRegions.map((region, index) => [region.start, index])),
  };
}

/** Reads a dithered face grid back by the same (uStart, vStart) pair `faceSamplesAt` produces for a voxel — safe to assert present: every voxel's region necessarily came from the same `pixelRegionForVoxelCoord` sweep {@link distinctPixelRegions} built the grid from. */
function lookupDitheredBlock(grid: DitheredFaceGrid, uStart: number, vStart: number): PaletteBlock {
  const uIndex = grid.uIndexByStart.get(uStart);
  const vIndex = grid.vIndexByStart.get(vStart);
  if (uIndex === undefined || vIndex === undefined) {
    throw new Error(`internal invariant violated: (${uStart}, ${vStart}) is not a cell of its own dithered grid`);
  }
  return grid.chosen[vIndex * grid.uRegions.length + uIndex]!;
}

/**
 * Builds every filled voxel of a replica, each already resolved to a
 * concrete palette block.
 *
 * Matching is ABSOLUTE: each voxel resolves to the block whose color is
 * nearest to its source pixel's real color, so the replica's colors are
 * the source's colors regardless of what else happens to be in the
 * palette. Adding or removing a block can only ever change the voxels
 * that block itself wins or loses — never move a target. (An earlier
 * "contrast preservation" step remapped each face's lightness range
 * onto the whole palette's and broke exactly that, turning orange
 * acacia white; see `contrast.ts`'s header.) `contrastGain` is the opt-in
 * way to bring out a face's own faint pattern, and it works around that
 * face's own average, so average colors never move either.
 *
 * Failure modes: throws `RangeError` for a non-positive/non-integer
 * `edgeBlocks` or an empty `palette`; throws `Error` if a source face
 * texture is not square, which is an internal invariant (the caller is
 * expected to supply a source block that passed the same opaque/square
 * eligibility check `palette.ts` applies to its own candidates) rather
 * than a condition this function's own caller chain can produce from
 * ordinary user input.
 */
export function buildVoxelGrid(params: BuildVoxelGridParams): Voxel[] {
  const {
    edgeBlocks,
    fillStyle,
    sourceFaceTextures,
    palette,
    colorTolerance = DEFAULT_COLOR_TOLERANCE,
    contrastGain = DEFAULT_CONTRAST_GAIN,
    dither = false,
    interiorFillBlock,
  } = params;
  assertPositiveInteger(edgeBlocks, "edgeBlocks");
  assertContrastGain(contrastGain);
  if (palette.length === 0) {
    throw new RangeError("buildVoxelGrid requires at least one palette block to build with");
  }
  if (fillStyle === "solid-cheap-core" && interiorFillBlock === undefined) {
    throw new RangeError("buildVoxelGrid requires an interiorFillBlock when fillStyle is 'solid-cheap-core'");
  }
  for (const direction of CUBE_FACE_DIRECTIONS) {
    const texture = sourceFaceTextures[direction];
    if (texture.width !== texture.height) {
      throw new Error(
        `internal invariant violated: source face texture '${direction}' is not square (${texture.width}x${texture.height})`,
      );
    }
  }

  const matchOptions: MatchOptions = { colorTolerance };
  // One candidate pool per set of faces a voxel can present, bound once each
  // — the matcher owns a scratch buffer, so building one per voxel would
  // reallocate it millions of times. There are at most ten distinct keys per
  // build: six single faces, plus the four z/x edge pairs (`governingFaces`
  // lets the cap win every tie that involves y, so no y pair ever occurs).
  const matcherByFaceKey = new Map<string, (target: Oklab) => ScoredCandidate<PaletteBlock>>();
  const matcherFacing = (directions: readonly CubeFaceDirection[]) => {
    const key = directions.join("+");
    const existing = matcherByFaceKey.get(key);
    if (existing !== undefined) return existing;
    const matcher = createMatcher(candidatesFacing(palette, directions), matchOptions);
    matcherByFaceKey.set(key, matcher);
    return matcher;
  };

  // Per face, not one mean shared across the block: each face is
  // amplified around ITS OWN average, so a face with no pattern of its
  // own stays untouched regardless of how varied any sibling face is.
  // Skipped entirely at gain 1 (no enhancement) — no scan, no map, and
  // the two call sites below branch once on `undefined`.
  const faceMeanLightness: ReadonlyMap<CubeFaceDirection, number> | undefined =
    contrastGain === 1
      ? undefined
      : new Map(
          [...lightnessStatsByFace(sourceFaceTextures)].map(([direction, stats]) => [direction, stats.mean]),
        );
  const faceContrast = (direction: CubeFaceDirection): FaceContrast | undefined =>
    faceMeanLightness === undefined
      ? undefined
      : { meanLightness: faceMeanLightness.get(direction)!, gain: contrastGain };

  // Only built when dithering is on: one pre-dithered lookup table per
  // face, each cell decided in scan order up front (see
  // buildDitheredFaceGrid). A single-face voxel below reads directly
  // from this instead of ever touching resolvedColorCache.
  const ditheredFaceGrids: ReadonlyMap<CubeFaceDirection, DitheredFaceGrid> | undefined =
    !dither
      ? undefined
      : new Map(
          CUBE_FACE_DIRECTIONS.map((direction) => [
            direction,
            buildDitheredFaceGrid(
              sourceFaceTextures[direction],
              edgeBlocks,
              // This grid covers one face, so its candidates are scored by
              // what they show on that face.
              candidatesFacing(palette, [direction]),
              matchOptions,
              faceContrast(direction),
            ),
          ]),
        );

  // Keyed by face + source pixel region: in up-scale ("exact") mode,
  // many voxels share the same single source pixel, so this bounds the
  // number of nearest-match searches by the texture's own pixel count
  // (at most 6 faces x textureSize^2) regardless of how large the
  // replica is. Used for EVERY voxel when dithering is off; used only
  // for two-face side-to-side edge voxels (one voxel wide, see
  // governingFaces) when it's on — a dithered cell's choice is
  // position-dependent, so it cannot be resolved and cached
  // independently the way this path does, which is exactly why those
  // edge voxels keep this plain, undithered, blended path either way.
  const resolvedColorCache = new Map<string, PaletteBlock>();

  const voxels: Voxel[] = [];
  for (let y = 0; y < edgeBlocks; y++) {
    for (let z = 0; z < edgeBlocks; z++) {
      for (let x = 0; x < edgeBlocks; x++) {
        const isShell = isShellVoxel(x, y, z, edgeBlocks);
        if (fillStyle === "hollow" && !isShell) continue;

        // An interior voxel of a cheap-core solid build is never
        // color-matched at all — it is categorically invisible once the
        // shell closes over it, so there is no "right" color to look
        // for, only a cheap, fixed one to place. interiorFillBlock is
        // guaranteed defined here by the validation above.
        if (fillStyle === "solid-cheap-core" && !isShell) {
          voxels.push({ x, y, z, paletteBlock: interiorFillBlock! });
          continue;
        }

        const directions = governingFaces(x, y, z, edgeBlocks);
        const samples = faceSamplesAt(directions, x, y, z, edgeBlocks, sourceFaceTextures);

        let paletteBlock: PaletteBlock;
        if (ditheredFaceGrids !== undefined && directions.length === 1) {
          const grid = ditheredFaceGrids.get(directions[0]!)!; // every direction has an entry: built from CUBE_FACE_DIRECTIONS above
          const sample = samples[0]!;
          paletteBlock = lookupDitheredBlock(grid, sample.uRegion.start, sample.vRegion.start);
        } else {
          const cacheKey = directions
            .map((direction, i) => `${direction}:${samples[i]!.uRegion.start}:${samples[i]!.vRegion.start}`)
            .join("+");
          const cached = resolvedColorCache.get(cacheKey);
          if (cached !== undefined) {
            paletteBlock = cached;
          } else {
            // Each sample is amplified around ITS OWN face's mean (when
            // contrast enhancement is on) before being combined. A side-
            // to-side edge voxel (two samples) then blends its two
            // already-amplified Oklab colors directly, the same "average
            // in Oklab, not linear-then-convert-once" principle
            // palette.ts's Jensen-gap fix established for averaging a
            // single texture's pixels.
            const targetColors = samples.map((sample, i) => {
              const rawColor = averageColorInRegion(sample.texture, sample.uRegion, sample.vRegion);
              const meanLightness = faceMeanLightness?.get(directions[i]!);
              return meanLightness === undefined ? rawColor : amplifyLightness(rawColor, meanLightness, contrastGain);
            });
            const color = targetColors.length === 1 ? targetColors[0]! : averageOklab(targetColors);
            paletteBlock = matcherFacing(directions)(color).item;
            resolvedColorCache.set(cacheKey, paletteBlock);
          }
        }

        voxels.push({ x, y, z, paletteBlock });
      }
    }
  }
  return voxels;
}
