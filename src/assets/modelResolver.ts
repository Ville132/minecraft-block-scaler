/**
 * Resolves a block id down to the six per-face texture ids of its
 * model, for the two shapes of block this app can build with:
 *
 * - a blockstate with exactly one variant (the empty-string key, i.e.
 *   no properties) — {@link resolveSingleVariantCubeModel};
 * - the standard axis-pillar shape (variants keyed exactly
 *   `axis=x`/`axis=y`/`axis=z` — logs, wood, basalt, quartz/purpur
 *   pillars, and similar "orientable" blocks), resolved in a chosen
 *   orientation — {@link resolveAxisVariantCubeModel}.
 *
 * Both ultimately require the model chain to resolve to a single full
 * 0,0,0->16,16,16 cube element with all six faces present, and both
 * funnel through {@link resolveCubeModelFromReference}, which also
 * applies the variant's `x`/`y` rotation (always present and non-zero
 * for the axis-pillar case — see `domain/faces.ts`'s
 * `rotateFaceDirection`).
 *
 * Every other way a block can fail to qualify for either shape
 * (multipart blockstates, missing files, malformed JSON, an
 * unresolvable texture variable, a non-cube model, a parent chain that
 * is cyclic or implausibly deep) collapses to the same `undefined`
 * result. All of them mean the same thing to the caller — "not usable
 * this way" — and are exactly as common as ineligible blocks are
 * expected to be, since most blocks in the game are neither shape.
 * This is a deliberate simplification of the failure space, not a
 * swallowed error: genuinely corrupt input (a zip that will not open
 * at all) still throws, in `archiveReader.ts`.
 */

import {
  blockstatePath,
  modelPath,
  stripNamespace,
  type MinecraftArchive,
} from "./archiveReader.ts";
import {
  CUBE_FACE_DIRECTIONS,
  unrotateFaceDirection,
  type CubeFaceDirection,
  type NinetyDegreeRotation,
} from "../domain/faces.ts";

export interface ResolvedCubeModel {
  /** One resolved, namespace-stripped texture id (e.g. `"block/cobblestone"`) per face. */
  readonly faceTextureIds: Readonly<Record<CubeFaceDirection, string>>;
}

const MAX_PARENT_CHAIN_DEPTH = 16;
const FULL_CUBE_FROM = [0, 0, 0] as const;
const FULL_CUBE_TO = [16, 16, 16] as const;

interface ModelElementFace {
  readonly texture: string;
}
interface ModelElement {
  readonly from: readonly [number, number, number];
  readonly to: readonly [number, number, number];
  readonly faces: Partial<Record<CubeFaceDirection, ModelElementFace>>;
}
interface ParsedModel {
  // `exactOptionalPropertyTypes` forbids assigning `undefined` to an
  // optional (`?`) property, and both fields below are always assigned
  // explicitly (possibly to `undefined`) rather than omitted.
  readonly parent: string | undefined;
  readonly textures: Readonly<Record<string, string>>;
  readonly elements: readonly ModelElement[] | undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseModelJson(bytes: Uint8Array): ParsedModel | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8").decode(bytes));
  } catch {
    return undefined;
  }
  if (!isPlainObject(parsed)) return undefined;

  const parent = typeof parsed.parent === "string" ? parsed.parent : undefined;

  const texturesRaw = parsed.textures;
  const textures: Record<string, string> = {};
  if (isPlainObject(texturesRaw)) {
    for (const [key, value] of Object.entries(texturesRaw)) {
      if (typeof value === "string") textures[key] = value;
    }
  }

  const elementsRaw = parsed.elements;
  let elements: readonly ModelElement[] | undefined;
  if (Array.isArray(elementsRaw)) {
    const parsedElements: ModelElement[] = [];
    for (const elementRaw of elementsRaw) {
      const element = parseModelElement(elementRaw);
      if (element === undefined) return undefined; // malformed geometry: treat the whole model as unresolvable
      parsedElements.push(element);
    }
    elements = parsedElements;
  }

  return { parent, textures, elements };
}

function parseModelElement(elementRaw: unknown): ModelElement | undefined {
  if (!isPlainObject(elementRaw)) return undefined;
  const from = parseVector3(elementRaw.from);
  const to = parseVector3(elementRaw.to);
  if (from === undefined || to === undefined) return undefined;

  const facesRaw = elementRaw.faces;
  const faces: Partial<Record<CubeFaceDirection, ModelElementFace>> = {};
  if (isPlainObject(facesRaw)) {
    for (const direction of CUBE_FACE_DIRECTIONS) {
      const faceRaw = facesRaw[direction];
      if (isPlainObject(faceRaw) && typeof faceRaw.texture === "string") {
        faces[direction] = { texture: faceRaw.texture };
      }
    }
  }
  return { from, to, faces };
}

function parseVector3(value: unknown): readonly [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  const [x, y, z] = value;
  if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") return undefined;
  return [x, y, z];
}

/** Reads one model and its full parent chain, root-first (so later entries are more specific and should override earlier ones when merging textures). */
function readParentChainRootFirst(
  archive: MinecraftArchive,
  leafModelId: string,
): readonly ParsedModel[] | undefined {
  const chainLeafToRoot: ParsedModel[] = [];
  let currentModelId: string | undefined = leafModelId;
  const seenModelIds = new Set<string>();

  while (currentModelId !== undefined) {
    const normalizedId = stripNamespace(currentModelId);
    if (seenModelIds.has(normalizedId) || seenModelIds.size >= MAX_PARENT_CHAIN_DEPTH) {
      return undefined; // cyclic or implausibly deep chain
    }
    seenModelIds.add(normalizedId);

    const bytes = archive.getFile(modelPath(normalizedId));
    if (bytes === undefined) return undefined;
    const model = parseModelJson(bytes);
    if (model === undefined) return undefined;

    chainLeafToRoot.push(model);
    currentModelId = model.parent;
  }

  return chainLeafToRoot.reverse();
}

function resolveTextureVariable(
  mergedTextures: Readonly<Record<string, string>>,
  variableName: string,
  depth = 0,
): string | undefined {
  if (depth >= MAX_PARENT_CHAIN_DEPTH) return undefined;
  const value = mergedTextures[variableName];
  if (value === undefined) return undefined;
  if (value.startsWith("#")) return resolveTextureVariable(mergedTextures, value.slice(1), depth + 1);
  return stripNamespace(value);
}

function isFullCubeElement(element: ModelElement): boolean {
  return (
    vectorsEqual(element.from, FULL_CUBE_FROM) &&
    vectorsEqual(element.to, FULL_CUBE_TO) &&
    CUBE_FACE_DIRECTIONS.every((direction) => element.faces[direction] !== undefined)
  );
}

function vectorsEqual(a: readonly [number, number, number], b: readonly [number, number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

interface VariantReference {
  readonly modelId: string;
  /** Defaults to 0 when the variant JSON omits it — see {@link parseRotationDegrees}. */
  readonly xDegrees: NinetyDegreeRotation;
  readonly yDegrees: NinetyDegreeRotation;
}

function parseRotationDegrees(value: unknown): NinetyDegreeRotation | undefined {
  if (value === undefined) return 0;
  return value === 0 || value === 90 || value === 180 || value === 270 ? value : undefined;
}

/** Extracts a variant's model id and rotation. A random-variation array picks its first option — rotation-only differences between options don't affect which texture gets resolved for a given world face anyway. */
function extractVariantReference(variant: unknown): VariantReference | undefined {
  const entry = Array.isArray(variant) ? variant[0] : variant;
  if (!isPlainObject(entry) || typeof entry.model !== "string") return undefined;
  const xDegrees = parseRotationDegrees(entry.x);
  const yDegrees = parseRotationDegrees(entry.y);
  if (xDegrees === undefined || yDegrees === undefined) return undefined;
  return { modelId: entry.model, xDegrees, yDegrees };
}

/** Reads `blockId`'s blockstates file and returns its `variants` map, or `undefined` if the file is missing, malformed, or not `variants`-shaped (e.g. a `multipart` blockstate — out of scope). Shared by every resolver below. */
function readVariantsMap(archive: MinecraftArchive, blockId: string): Record<string, unknown> | undefined {
  const blockstateBytes = archive.getFile(blockstatePath(blockId));
  if (blockstateBytes === undefined) return undefined;

  let blockstateJson: unknown;
  try {
    blockstateJson = JSON.parse(new TextDecoder("utf-8").decode(blockstateBytes));
  } catch {
    return undefined;
  }
  if (!isPlainObject(blockstateJson)) return undefined;

  const variants = blockstateJson.variants;
  return isPlainObject(variants) ? variants : undefined;
}

/**
 * The shared core: resolves a model chain, picks the most specific
 * full-cube element, and resolves each WORLD face's texture by first
 * un-rotating it back to the LOCAL face the model itself defines (a
 * no-op when the reference carries no rotation, as for every
 * single-variant block before axis-pillar support existed).
 */
function resolveCubeModelFromReference(
  archive: MinecraftArchive,
  reference: VariantReference,
): ResolvedCubeModel | undefined {
  const chainRootFirst = readParentChainRootFirst(archive, reference.modelId);
  if (chainRootFirst === undefined) return undefined;

  const mergedTextures: Record<string, string> = {};
  for (const model of chainRootFirst) {
    Object.assign(mergedTextures, model.textures);
  }

  // The most specific model in the chain that defines geometry wins —
  // a child's `elements` fully replaces its parent's, it never merges.
  let elements: readonly ModelElement[] | undefined;
  for (let i = chainRootFirst.length - 1; i >= 0; i--) {
    const candidateElements = chainRootFirst[i]?.elements;
    if (candidateElements !== undefined) {
      elements = candidateElements;
      break;
    }
  }
  if (elements === undefined || elements.length !== 1) return undefined;
  const [element] = elements;
  if (element === undefined || !isFullCubeElement(element)) return undefined;

  const faceTextureIds: Partial<Record<CubeFaceDirection, string>> = {};
  for (const worldDirection of CUBE_FACE_DIRECTIONS) {
    const localDirection = unrotateFaceDirection(worldDirection, reference.xDegrees, reference.yDegrees);
    const textureVariable = element.faces[localDirection]?.texture;
    if (textureVariable === undefined || !textureVariable.startsWith("#")) return undefined;
    const resolved = resolveTextureVariable(mergedTextures, textureVariable.slice(1));
    if (resolved === undefined) return undefined;
    faceTextureIds[worldDirection] = resolved;
  }

  return { faceTextureIds: faceTextureIds as Record<CubeFaceDirection, string> };
}

/**
 * Resolves `blockId` to its six per-face texture ids, or `undefined` if
 * it is not a single-variant full-cube block (see this module's header
 * comment for exactly what that covers).
 */
export function resolveSingleVariantCubeModel(
  archive: MinecraftArchive,
  blockId: string,
): ResolvedCubeModel | undefined {
  const variants = readVariantsMap(archive, blockId);
  if (variants === undefined) return undefined;
  const variantKeys = Object.keys(variants);
  if (variantKeys.length !== 1 || variantKeys[0] !== "") return undefined; // not a single no-properties variant

  const reference = extractVariantReference(variants[""]);
  if (reference === undefined) return undefined;
  return resolveCubeModelFromReference(archive, reference);
}

/** The two orientations offered for an axis-pillar block — see {@link resolveAxisVariantCubeModel}. */
export type AxisOrientation = "upright" | "sideways";

const AXIS_VARIANT_KEYS = ["axis=x", "axis=y", "axis=z"] as const;

/**
 * Whether `blockId` has the standard axis-pillar shape: blockstate
 * variants keyed exactly `axis=x`/`axis=y`/`axis=z` — logs, wood,
 * basalt, quartz/purpur pillars, and similar "orientable" full cubes.
 */
export function hasAxisVariants(archive: MinecraftArchive, blockId: string): boolean {
  const variants = readVariantsMap(archive, blockId);
  if (variants === undefined) return false;
  const keys = Object.keys(variants);
  return keys.length === 3 && AXIS_VARIANT_KEYS.every((key) => keys.includes(key));
}

/**
 * Resolves an axis-pillar block (see {@link hasAxisVariants}) in one of
 * two orientations: `"upright"` (`axis=y` — bark rings on top/bottom,
 * the default a player would expect) or `"sideways"` (`axis=z` — bark
 * rings on north/south). `axis=x` would be an equally valid "sideways"
 * choice; a player can still rotate the finished build in-game, so
 * this just needs to pick one rather than offer three.
 */
export function resolveAxisVariantCubeModel(
  archive: MinecraftArchive,
  blockId: string,
  orientation: AxisOrientation,
): ResolvedCubeModel | undefined {
  const variants = readVariantsMap(archive, blockId);
  if (variants === undefined) return undefined;

  const reference = extractVariantReference(variants[orientation === "upright" ? "axis=y" : "axis=z"]);
  if (reference === undefined) return undefined;
  return resolveCubeModelFromReference(archive, reference);
}
