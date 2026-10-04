/**
 * Reads a Minecraft client jar or resource pack zip and exposes its
 * `assets/minecraft/...` entries by path. We read textures from the
 * user's own archive rather than bundling Mojang's assets, which are
 * not redistributable (see PLAN.md).
 */

import { unzipSync } from "fflate";

export interface MinecraftArchive {
  /** Raw bytes at an exact path, or `undefined` if the archive has no such entry — a missing file is an expected, common outcome (most candidate blocks lack one asset or another), not an error. */
  getFile(path: string): Uint8Array | undefined;
  /** Every entry path starting with `prefix`, in archive order. */
  listPaths(prefix: string): string[];
}

/**
 * A full client jar is ~25MB across ~20k entries, nearly all of them
 * `.class` files this app never reads — inflating those anyway costs
 * real time and memory for nothing. Everything this app ever looks up
 * lives under one of these two trees (block assets, and the recipe
 * JSON `materials.ts`'s raw-material decomposition reads) — see
 * `BLOCKSTATES_DIR`/`MODELS_DIR`/`TEXTURES_DIR` below and
 * `assets/recipes.ts`'s `RECIPES_DIR`.
 */
function isEntryWorthInflating(entryName: string): boolean {
  return entryName.startsWith("assets/minecraft/") || entryName.startsWith("data/minecraft/recipe/");
}

/**
 * Unzips archive bytes and wraps them for path-based lookup.
 *
 * Failure mode: throws `Error` (wrapping the underlying cause) only when
 * the bytes are not a valid zip at all — a structurally broken upload,
 * as opposed to a merely incomplete one, which is the one case where
 * there is no usable archive to fall back to.
 */
export function readMinecraftArchive(zipBytes: Uint8Array): MinecraftArchive {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipBytes, { filter: (file) => isEntryWorthInflating(file.name) });
  } catch (cause) {
    throw new Error("Could not read the uploaded file as a zip/jar archive", { cause });
  }

  const files = new Map(Object.entries(entries));
  return {
    getFile: (path) => files.get(path),
    listPaths: (prefix) => Array.from(files.keys()).filter((path) => path.startsWith(prefix)),
  };
}

const BLOCKSTATES_DIR = "assets/minecraft/blockstates/";
const MODELS_DIR = "assets/minecraft/models/";
const TEXTURES_DIR = "assets/minecraft/textures/";

/** Every block id (e.g. `"cobblestone"`) that has a blockstates file in the archive — the full candidate list before any eligibility filtering. */
export function listBlockIds(archive: MinecraftArchive): string[] {
  return archive
    .listPaths(BLOCKSTATES_DIR)
    .filter((path) => path.endsWith(".json"))
    .map((path) => path.slice(BLOCKSTATES_DIR.length, -".json".length));
}

/** The archive path for a block's blockstates file. */
export function blockstatePath(blockId: string): string {
  return `${BLOCKSTATES_DIR}${blockId}.json`;
}

/** The archive path for a model, given a (possibly `minecraft:`-namespaced) model id such as `"block/cube_all"`. */
export function modelPath(modelId: string): string {
  return `${MODELS_DIR}${stripNamespace(modelId)}.json`;
}

/** The archive path for a texture, given a (possibly `minecraft:`-namespaced) texture id such as `"block/cobblestone"`. */
export function texturePath(textureId: string): string {
  return `${TEXTURES_DIR}${stripNamespace(textureId)}.png`;
}

/** The archive path for a texture's animation metadata, present only on animated textures. */
export function textureMetaPath(textureId: string): string {
  return `${texturePath(textureId)}.mcmeta`;
}

/** Resource location ids are optionally namespaced (`"minecraft:block/x"`); every path helper above accepts either form. */
export function stripNamespace(resourceLocation: string): string {
  const separatorIndex = resourceLocation.indexOf(":");
  return separatorIndex === -1 ? resourceLocation : resourceLocation.slice(separatorIndex + 1);
}
