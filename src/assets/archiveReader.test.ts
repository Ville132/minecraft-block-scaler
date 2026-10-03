import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  blockstatePath,
  listBlockIds,
  modelPath,
  readMinecraftArchive,
  stripNamespace,
  textureMetaPath,
  texturePath,
} from "./archiveReader.ts";

function zipOf(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    entries[path] = new TextEncoder().encode(content);
  }
  return zipSync(entries);
}

describe("readMinecraftArchive", () => {
  it("looks up files by exact path", () => {
    const archive = readMinecraftArchive(
      zipOf({ "assets/minecraft/textures/block/stone.png": "fake-png-bytes" }),
    );
    expect(new TextDecoder().decode(archive.getFile("assets/minecraft/textures/block/stone.png")))
      .toBe("fake-png-bytes");
  });

  it("returns undefined for a missing file rather than throwing", () => {
    const archive = readMinecraftArchive(zipOf({ "a.txt": "x" }));
    expect(archive.getFile("does/not/exist.json")).toBeUndefined();
  });

  it("lists only paths under the given prefix", () => {
    const archive = readMinecraftArchive(
      zipOf({
        "assets/minecraft/blockstates/stone.json": "{}",
        "assets/minecraft/blockstates/dirt.json": "{}",
        "assets/minecraft/textures/block/stone.png": "x",
      }),
    );
    expect(archive.listPaths("assets/minecraft/blockstates/").sort()).toEqual([
      "assets/minecraft/blockstates/dirt.json",
      "assets/minecraft/blockstates/stone.json",
    ]);
  });

  it("rejects bytes that are not a valid zip", () => {
    expect(() => readMinecraftArchive(Uint8Array.from([1, 2, 3, 4]))).toThrow();
  });
});

describe("listBlockIds", () => {
  it("strips the directory prefix and .json suffix", () => {
    const archive = readMinecraftArchive(
      zipOf({
        "assets/minecraft/blockstates/cobblestone.json": "{}",
        "assets/minecraft/blockstates/stone.json": "{}",
      }),
    );
    expect(listBlockIds(archive).sort()).toEqual(["cobblestone", "stone"]);
  });
});

describe("path helpers", () => {
  it("builds paths from bare ids", () => {
    expect(blockstatePath("cobblestone")).toBe("assets/minecraft/blockstates/cobblestone.json");
    expect(modelPath("block/cube_all")).toBe("assets/minecraft/models/block/cube_all.json");
    expect(texturePath("block/cobblestone")).toBe("assets/minecraft/textures/block/cobblestone.png");
    expect(textureMetaPath("block/magma")).toBe("assets/minecraft/textures/block/magma.png.mcmeta");
  });

  it("strips an optional minecraft: namespace", () => {
    expect(modelPath("minecraft:block/cube_all")).toBe("assets/minecraft/models/block/cube_all.json");
    expect(stripNamespace("minecraft:block/x")).toBe("block/x");
    expect(stripNamespace("block/x")).toBe("block/x");
  });
});
