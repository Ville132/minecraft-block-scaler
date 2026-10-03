/**
 * Resolves a block id down to the six per-face texture ids of its model,
 * but only for the shape of block this app can build with: a blockstate
 * with exactly one variant (the empty-string key, i.e. no properties),
 * whose model chain ultimately resolves to a single full 0,0,0->16,16,16
 * cube element with all six faces present.
 *
 * That single check is also what defers axis-dependent blocks like logs
 * or pillars (PLAN.md's stated v1 scope boundary): their blockstates
 * have multiple variants keyed by `axis=x`/`axis=y`/`axis=z`, so they
 * never have the single `""` variant this resolver requires — no
 * separate hardcoded block list is needed to exclude them.
 *
 * Every other way a block can fail to qualify (multipart blockstates,
 * missing files, malformed JSON, an unresolvable texture variable, a
 * non-cube model, a parent chain that is cyclic or implausibly deep)
 * collapses to the same `undefined` result. All of them mean the same
 * thing to the caller — "not usable as a scale source" — and are
 * exactly as common as ineligible blocks are expected to be, since most
 * blocks in the game are not simple full cubes. This is a deliberate
 * simplification of the failure space, not a swallowed error: genuinely
 * corrupt input (a zip that will not open at all) still throws, in
 * `archiveReader.ts`.
 */

import {
  blockstatePath,
  modelPath,
  stripNamespace,
  type MinecraftArchive,
} from "./archiveReader.ts";
import { CUBE_FACE_DIRECTIONS, type CubeFaceDirection } from "../domain/faces.ts";

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

/**
 * Resolves `blockId` to its six per-face texture ids, or `undefined` if
 * it is not a single-variant full-cube block (see this module's header
 * comment for exactly what that covers).
 */
export function resolveSingleVariantCubeModel(
  archive: MinecraftArchive,
  blockId: string,
): ResolvedCubeModel | undefined {
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
  if (!isPlainObject(variants)) return undefined; // e.g. a "multipart" blockstate — out of scope
  const variantKeys = Object.keys(variants);
  if (variantKeys.length !== 1 || variantKeys[0] !== "") return undefined; // not a single no-properties variant

  const modelId = extractModelId(variants[""]);
  if (modelId === undefined) return undefined;

  const chainRootFirst = readParentChainRootFirst(archive, modelId);
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
  for (const direction of CUBE_FACE_DIRECTIONS) {
    const textureVariable = element.faces[direction]?.texture;
    if (textureVariable === undefined || !textureVariable.startsWith("#")) return undefined;
    const resolved = resolveTextureVariable(mergedTextures, textureVariable.slice(1));
    if (resolved === undefined) return undefined;
    faceTextureIds[direction] = resolved;
  }

  return { faceTextureIds: faceTextureIds as Record<CubeFaceDirection, string> };
}

function extractModelId(variant: unknown): string | undefined {
  const entry = Array.isArray(variant) ? variant[0] : variant;
  if (!isPlainObject(entry) || typeof entry.model !== "string") return undefined;
  return entry.model;
}
