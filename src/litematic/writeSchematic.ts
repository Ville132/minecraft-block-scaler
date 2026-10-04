/**
 * Assembles a voxel grid into a complete, gzipped `.litematic` file —
 * the final step that turns `shell.ts`'s output into bytes Litematica
 * can load. See PLAN.md's "Verified `.litematic` format facts" for
 * where every constant and the index-ordering formula below comes from.
 */

import { gzipSync } from "fflate";
import type { PaletteBlock } from "../domain/palette.ts";
import type { FillStyle, Voxel } from "../domain/shell.ts";
import { bitsPerEntry, packBlockStateIndices, toSignedLongArray } from "./bitArray.ts";
import { nbt, writeNbt } from "./nbt.ts";

const LITEMATIC_FORMAT_VERSION = 6;
const LITEMATIC_FORMAT_SUBVERSION = 1;
/** Java Edition 26.3 ("Wilderness Bound", 2026-09-15) — see PLAN.md. */
const MINECRAFT_DATA_VERSION = 5023;

const APP_NAME = "Minecraft Block Scaler";
const REGION_NAME = "Main";
const AIR_RESOURCE_LOCATION = "minecraft:air";

export interface WriteSchematicParams {
  /** The block that was scaled up, e.g. `"cobblestone"` (no `minecraft:` prefix). */
  readonly sourceBlockId: string;
  readonly edgeBlocks: number;
  /** Cosmetic only (folded into the written Description) — the voxels themselves already reflect this. */
  readonly fillStyle: FillStyle;
  readonly voxels: readonly Voxel[];
  /** Defaults to the real clock; tests inject a fixed value so output bytes are fully reproducible. */
  readonly now?: () => number;
}

/** The suggested download name for a schematic, matching PLAN.md's `<block>_x<S>.litematic` convention. */
export function schematicFileName(sourceBlockId: string, edgeBlocks: number): string {
  return `${sourceBlockId}_x${edgeBlocks}.litematic`;
}

function yMajorIndex(x: number, y: number, z: number, edgeBlocks: number): number {
  return y * edgeBlocks * edgeBlocks + z * edgeBlocks + x;
}

interface BlockStatePaletteEntry {
  /** Distinguishes this exact (resourceLocation, properties) pair from any other — e.g. `"minecraft:furnace[facing=north,lit=false]"`, or plain `"minecraft:cobblestone"` when there are no properties. Two voxels whose `paletteBlock`s share a `blockId` always share this key too, since `domain/palette.ts` resolves exactly one canonical variant (one fixed `properties` value) per block id for a given build — but the palette here is still deduplicated by this key, not by `resourceLocation` alone, so that invariant does not have to be trusted blindly. */
  readonly key: string;
  readonly resourceLocation: string;
  readonly properties: Readonly<Record<string, string>> | undefined;
}

function blockStatePaletteEntryFor(paletteBlock: PaletteBlock): BlockStatePaletteEntry {
  const { resourceLocation, properties } = paletteBlock;
  if (properties === undefined || Object.keys(properties).length === 0) {
    return { key: resourceLocation, resourceLocation, properties: undefined };
  }
  const sortedPairs = Object.entries(properties).sort(([a], [b]) => a.localeCompare(b));
  const key = `${resourceLocation}[${sortedPairs.map(([name, value]) => `${name}=${value}`).join(",")}]`;
  return { key, resourceLocation, properties: Object.fromEntries(sortedPairs) };
}

/**
 * Inputs: see {@link WriteSchematicParams}. `voxels` need not cover
 * every position (a hollow shell deliberately does not); uncovered
 * positions are written as air.
 * Output: gzipped NBT bytes, ready to save as a `.litematic` file.
 * Failure modes: throws `RangeError` for a non-positive/non-integer
 * `edgeBlocks` or an empty `voxels` list (an empty build is never a
 * useful file to produce) and lets `bitArray.ts`'s own checks propagate
 * if a voxel coordinate ever fell outside `[0, edgeBlocks)` — both
 * signal a caller bug upstream, not a condition to paper over here.
 */
export function writeSchematicBytes(params: WriteSchematicParams): Uint8Array {
  const { sourceBlockId, edgeBlocks, fillStyle, voxels } = params;
  if (!Number.isInteger(edgeBlocks) || edgeBlocks < 1) {
    throw new RangeError(`edgeBlocks must be a positive integer, got ${edgeBlocks}`);
  }
  if (voxels.length === 0) {
    throw new RangeError("writeSchematicBytes requires at least one voxel to build");
  }

  const usedEntriesByKey = new Map<string, BlockStatePaletteEntry>();
  for (const voxel of voxels) {
    const entry = blockStatePaletteEntryFor(voxel.paletteBlock);
    if (!usedEntriesByKey.has(entry.key)) usedEntriesByKey.set(entry.key, entry);
  }
  const usedEntries = Array.from(usedEntriesByKey.values()).sort((a, b) => a.key.localeCompare(b.key));
  const blockStatePalette: readonly BlockStatePaletteEntry[] = [
    { key: AIR_RESOURCE_LOCATION, resourceLocation: AIR_RESOURCE_LOCATION, properties: undefined },
    ...usedEntries,
  ];
  const paletteIndexByKey = new Map(blockStatePalette.map((entry, index) => [entry.key, index]));

  const volume = edgeBlocks ** 3;
  const paletteIndices = new Array<number>(volume).fill(0); // 0 = air
  for (const voxel of voxels) {
    const key = blockStatePaletteEntryFor(voxel.paletteBlock).key;
    const paletteIndex = paletteIndexByKey.get(key);
    if (paletteIndex === undefined) {
      // Unreachable: blockStatePalette was built from these same voxels.
      throw new Error(`internal invariant violated: '${key}' missing from its own block-state palette`);
    }
    paletteIndices[yMajorIndex(voxel.x, voxel.y, voxel.z, edgeBlocks)] = paletteIndex;
  }

  const bits = bitsPerEntry(blockStatePalette.length);
  const blockStates = toSignedLongArray(packBlockStateIndices(paletteIndices, bits));

  const timestampMs = BigInt(Math.trunc((params.now ?? Date.now)()));
  const fillStyleLabel =
    fillStyle === "hollow" ? "Hollow" : fillStyle === "solid-cheap-core" ? "Solid (cheap core)" : "Solid";

  const region = nbt.compound({
    Position: nbt.compound({ x: nbt.int(0), y: nbt.int(0), z: nbt.int(0) }),
    Size: nbt.compound({ x: nbt.int(edgeBlocks), y: nbt.int(edgeBlocks), z: nbt.int(edgeBlocks) }),
    BlockStatePalette: nbt.list(
      "compound",
      blockStatePalette.map((entry) =>
        nbt.compound({
          Name: nbt.string(entry.resourceLocation),
          ...(entry.properties !== undefined && {
            Properties: nbt.compound(
              Object.fromEntries(Object.entries(entry.properties).map(([name, value]) => [name, nbt.string(value)])),
            ),
          }),
        }),
      ),
    ),
    BlockStates: nbt.longArray(blockStates),
    TileEntities: nbt.list("compound", []),
    Entities: nbt.list("compound", []),
    PendingBlockTicks: nbt.list("compound", []),
    PendingFluidTicks: nbt.list("compound", []),
  });

  const root = nbt.compound({
    Version: nbt.int(LITEMATIC_FORMAT_VERSION),
    SubVersion: nbt.int(LITEMATIC_FORMAT_SUBVERSION),
    MinecraftDataVersion: nbt.int(MINECRAFT_DATA_VERSION),
    Metadata: nbt.compound({
      Name: nbt.string(`Giant ${sourceBlockId} (x${edgeBlocks})`),
      Author: nbt.string(APP_NAME),
      Description: nbt.string(
        `${fillStyleLabel} ${edgeBlocks}x${edgeBlocks}x${edgeBlocks} replica of minecraft:${sourceBlockId}, generated by ${APP_NAME}.`,
      ),
      RegionCount: nbt.int(1),
      TotalVolume: nbt.int(volume),
      TotalBlocks: nbt.int(voxels.length),
      EnclosingSize: nbt.compound({ x: nbt.int(edgeBlocks), y: nbt.int(edgeBlocks), z: nbt.int(edgeBlocks) }),
      TimeCreated: nbt.long(timestampMs),
      TimeModified: nbt.long(timestampMs),
    }),
    Regions: nbt.compound({ [REGION_NAME]: region }),
  });

  // mtime: 0 tells fflate to omit the gzip wrapper's own timestamp
  // field entirely, so output bytes are fully reproducible given the
  // same `now` — required for the golden-file test in this module's
  // test suite to be stable across runs.
  return gzipSync(writeNbt(root), { mtime: 0 });
}
