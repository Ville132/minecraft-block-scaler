import { gunzipSync } from "fflate";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PaletteBlock } from "../domain/palette.ts";
import type { Voxel } from "../domain/shell.ts";
import { bitsPerEntry, fromSignedLongArray, unpackBlockStateIndices } from "./bitArray.ts";
import {
  expectCompound,
  expectInt,
  expectList,
  expectLongArray,
  expectString,
  readNbt,
  requireField,
} from "./nbt.ts";
import { schematicFileName, writeSchematicBytes } from "./writeSchematic.ts";

function fakeBlock(blockId: string): PaletteBlock {
  return { blockId, resourceLocation: `minecraft:${blockId}`, color: { L: 0.5, a: 0, b: 0 }, costTier: "common" };
}

describe("schematicFileName", () => {
  it("matches the <block>_x<S>.litematic convention", () => {
    expect(schematicFileName("cobblestone", 32)).toBe("cobblestone_x32.litematic");
  });
});

describe("writeSchematicBytes", () => {
  it("rejects an empty voxel list", () => {
    expect(() =>
      writeSchematicBytes({ sourceBlockId: "stone", edgeBlocks: 2, fillStyle: "solid", voxels: [] }),
    ).toThrow(RangeError);
  });

  it("rejects a non-positive edgeBlocks", () => {
    const voxels: Voxel[] = [{ x: 0, y: 0, z: 0, paletteBlock: fakeBlock("stone") }];
    expect(() =>
      writeSchematicBytes({ sourceBlockId: "stone", edgeBlocks: 0, fillStyle: "solid", voxels }),
    ).toThrow(RangeError);
  });

  it("round-trips a 2x2x2 structure with two distinct blocks through gunzip + readNbt", () => {
    const stone = fakeBlock("stone");
    const dirt = fakeBlock("dirt");
    // Deliberately asymmetric: y=0 layer is dirt, y=1 layer is stone,
    // so the test can check that specific positions ended up correct,
    // not just that the overall counts work out.
    const voxels: Voxel[] = [];
    for (let x = 0; x < 2; x++) {
      for (let z = 0; z < 2; z++) {
        voxels.push({ x, y: 0, z, paletteBlock: dirt });
        voxels.push({ x, y: 1, z, paletteBlock: stone });
      }
    }

    const bytes = writeSchematicBytes({
      sourceBlockId: "stone",
      edgeBlocks: 2,
      fillStyle: "solid",
      voxels,
      now: () => 1_700_000_000_000,
    });

    const { tag: root } = readNbt(gunzipSync(bytes));
    const rootFields = expectCompound(root);

    expect(expectInt(requireField(rootFields, "Version"))).toBe(6);
    expect(expectInt(requireField(rootFields, "SubVersion"))).toBe(1);
    expect(expectInt(requireField(rootFields, "MinecraftDataVersion"))).toBe(5023);

    const metadata = expectCompound(requireField(rootFields, "Metadata"));
    expect(expectInt(requireField(metadata, "TotalBlocks"))).toBe(8);
    expect(expectInt(requireField(metadata, "TotalVolume"))).toBe(8);
    const enclosingSize = expectCompound(requireField(metadata, "EnclosingSize"));
    expect(expectInt(requireField(enclosingSize, "x"))).toBe(2);
    expect(expectInt(requireField(enclosingSize, "y"))).toBe(2);
    expect(expectInt(requireField(enclosingSize, "z"))).toBe(2);

    const regions = expectCompound(requireField(rootFields, "Regions"));
    const regionNames = Object.keys(regions);
    expect(regionNames).toHaveLength(1);
    const region = expectCompound(requireField(regions, regionNames[0]!));

    const paletteList = expectList(requireField(region, "BlockStatePalette")).map((entry) =>
      expectString(requireField(expectCompound(entry), "Name")),
    );
    // air is always index 0; dirt/stone follow alphabetically.
    expect(paletteList).toEqual(["minecraft:air", "minecraft:dirt", "minecraft:stone"]);

    const bits = bitsPerEntry(paletteList.length);
    const signedLongs = expectLongArray(requireField(region, "BlockStates"));
    const indices = unpackBlockStateIndices(fromSignedLongArray(signedLongs), bits, 8);

    // y-major index = y*4 + z*2 + x (edgeBlocks=2).
    const dirtIndex = paletteList.indexOf("minecraft:dirt");
    const stoneIndex = paletteList.indexOf("minecraft:stone");
    for (let x = 0; x < 2; x++) {
      for (let z = 0; z < 2; z++) {
        expect(indices[0 * 4 + z * 2 + x]).toBe(dirtIndex); // y=0 layer
        expect(indices[1 * 4 + z * 2 + x]).toBe(stoneIndex); // y=1 layer
      }
    }
  });

  it("matches the committed golden fixture byte-for-byte", () => {
    const stone = fakeBlock("stone");
    const voxels: Voxel[] = [];
    for (let x = 0; x < 2; x++) {
      for (let y = 0; y < 2; y++) {
        for (let z = 0; z < 2; z++) {
          voxels.push({ x, y, z, paletteBlock: stone });
        }
      }
    }

    const bytes = writeSchematicBytes({
      sourceBlockId: "stone",
      edgeBlocks: 2,
      fillStyle: "solid",
      voxels,
      now: () => 0,
    });

    const fixturePath = new URL("./__fixtures__/2x2x2_solid_stone.litematic", import.meta.url);
    const golden = readFileSync(fixturePath);
    expect(Array.from(bytes)).toEqual(Array.from(golden));
  });
});
