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
  averageLinearRgb,
  findBestMatch,
  linearRgbToOklab,
  rgb8ToLinearRgb,
  type LinearRgb,
  type Oklab,
} from "./color.ts";
import { ditherGrid, type DitherOptions } from "./dither.ts";
import {
  CUBE_FACE_DIRECTIONS,
  faceForOrientation,
  faceOrientation,
  type Axis,
  type CubeFaceDirection,
} from "./faces.ts";
import type { PaletteBlock } from "./palette.ts";

export type { DitherOptions } from "./dither.ts";

export type FillStyle = "hollow" | "solid";

export interface Voxel {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly paletteBlock: PaletteBlock;
}

/**
 * The default cost of a candidate's own texture noise, in `findBestMatch`'s
 * `varianceWeight` terms: `1` is the literal, unscaled bias-variance sum
 * (see `color.ts`'s `findBestMatch`) — exactly how much a candidate's own
 * busyness would actually be expected to blur the pixel it's standing in
 * for, no extra weighting added. The principled, no-magic-number choice,
 * not a tuned constant.
 */
export const DEFAULT_VARIANCE_WEIGHT = 1;

export interface BuildVoxelGridParams {
  readonly edgeBlocks: number;
  readonly fillStyle: FillStyle;
  /** The source block's own decoded face textures — what every voxel's color is sampled from. */
  readonly sourceFaceTextures: Readonly<Record<CubeFaceDirection, DecodedTexture>>;
  /** Candidate replacement blocks (see `palette.ts`); must be non-empty. */
  readonly palette: readonly PaletteBlock[];
  /** How strongly to penalize a visually busy candidate block as a single-color stand-in — see `color.ts`'s `findBestMatch`. `0` reproduces plain nearest-color matching. Defaults to {@link DEFAULT_VARIANCE_WEIGHT}. */
  readonly varianceWeight?: number;
  /** Enables Floyd-Steinberg error-diffusion dithering (see `dither.ts`) when present; omitted entirely disables it, reproducing plain per-pixel nearest-match exactly as before dithering existed. Off by default — dithering trades a flat, uniformly-off look for a more accurate one from a distance at the cost of a speckled look up close, and that tradeoff is the user's call. */
  readonly dither?: DitherOptions;
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

/** The linear-light average color across a rectangular pixel region of a decoded texture. Alpha is ignored: unlike `palette.ts`'s candidates, the source block's texture is trusted to be opaque by construction (see this module's header comment). */
function averageColorInRegion(texture: DecodedTexture, uRegion: PixelRegion, vRegion: PixelRegion): LinearRgb {
  const samples: LinearRgb[] = [];
  for (let v = vRegion.start; v < vRegion.endExclusive; v++) {
    for (let u = uRegion.start; u < uRegion.endExclusive; u++) {
      const pixelIndex = (v * texture.width + u) * 4;
      samples.push(
        rgb8ToLinearRgb({
          r: texture.pixels[pixelIndex]!,
          g: texture.pixels[pixelIndex + 1]!,
          b: texture.pixels[pixelIndex + 2]!,
        }),
      );
    }
  }
  return averageLinearRgb(samples);
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
 */
function buildDitheredFaceGrid(
  texture: DecodedTexture,
  edgeBlocks: number,
  paletteCandidates: readonly { color: Oklab; variance: number; item: PaletteBlock }[],
  dither: DitherOptions,
): DitheredFaceGrid {
  const uRegions = distinctPixelRegions(edgeBlocks, texture.width);
  const vRegions = distinctPixelRegions(edgeBlocks, texture.height);

  const targets: Oklab[] = [];
  for (const vRegion of vRegions) {
    for (const uRegion of uRegions) {
      targets.push(linearRgbToOklab(averageColorInRegion(texture, uRegion, vRegion)));
    }
  }

  const chosen = ditherGrid(targets, uRegions.length, paletteCandidates, dither);
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
 * Failure modes: throws `RangeError` for a non-positive/non-integer
 * `edgeBlocks` or an empty `palette`; throws `Error` if a source face
 * texture is not square, which is an internal invariant (the caller is
 * expected to supply a source block that passed the same opaque/square
 * eligibility check `palette.ts` applies to its own candidates) rather
 * than a condition this function's own caller chain can produce from
 * ordinary user input.
 */
export function buildVoxelGrid(params: BuildVoxelGridParams): Voxel[] {
  const { edgeBlocks, fillStyle, sourceFaceTextures, palette, varianceWeight = DEFAULT_VARIANCE_WEIGHT, dither } =
    params;
  assertPositiveInteger(edgeBlocks, "edgeBlocks");
  if (palette.length === 0) {
    throw new RangeError("buildVoxelGrid requires at least one palette block to build with");
  }
  for (const direction of CUBE_FACE_DIRECTIONS) {
    const texture = sourceFaceTextures[direction];
    if (texture.width !== texture.height) {
      throw new Error(
        `internal invariant violated: source face texture '${direction}' is not square (${texture.width}x${texture.height})`,
      );
    }
  }

  const paletteCandidates = palette.map((block) => ({
    color: block.color,
    variance: block.textureVariance,
    item: block,
  }));

  // Only built when dithering is on: one pre-dithered lookup table per
  // face, each cell decided in scan order up front (see
  // buildDitheredFaceGrid). A single-face voxel below reads directly
  // from this instead of ever touching resolvedColorCache.
  const ditheredFaceGrids: ReadonlyMap<CubeFaceDirection, DitheredFaceGrid> | undefined =
    dither === undefined
      ? undefined
      : new Map(
          CUBE_FACE_DIRECTIONS.map((direction) => [
            direction,
            buildDitheredFaceGrid(sourceFaceTextures[direction], edgeBlocks, paletteCandidates, dither),
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
        if (fillStyle === "hollow" && !isShellVoxel(x, y, z, edgeBlocks)) continue;

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
            // A single sample on most voxels; exactly two, blended, on a
            // side-to-side edge (see governingFaces) — averageLinearRgb
            // already handles either count uniformly.
            const linearColors = samples.map((sample) =>
              averageColorInRegion(sample.texture, sample.uRegion, sample.vRegion),
            );
            const color = linearRgbToOklab(averageLinearRgb(linearColors));
            paletteBlock = findBestMatch(color, paletteCandidates, varianceWeight);
            resolvedColorCache.set(cacheKey, paletteBlock);
          }
        }

        voxels.push({ x, y, z, paletteBlock });
      }
    }
  }
  return voxels;
}
