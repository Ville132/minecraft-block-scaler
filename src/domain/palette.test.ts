import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readMinecraftArchive, type MinecraftArchive } from "../assets/archiveReader.ts";
import type { DecodedTexture } from "../assets/textureDecoder.ts";
import { rgb8ToOklab } from "./color.ts";
import {
  buildPalette,
  costTierOf,
  isBiomeTintedBlock,
  isGravityBlock,
  isUnbuildableBlock,
  type TextureDecoder,
} from "./palette.ts";

describe("classification rules", () => {
  it("tags precious-material blocks and leaves everything else common", () => {
    expect(costTierOf("gold_block")).toBe("precious");
    expect(costTierOf("diamond_block")).toBe("precious");
    expect(costTierOf("cobblestone")).toBe("common");
    expect(costTierOf("copper_block")).toBe("common");
  });

  it("flags gravity blocks", () => {
    expect(isGravityBlock("sand")).toBe(true);
    expect(isGravityBlock("cobblestone")).toBe(false);
  });

  it("flags biome-tinted blocks", () => {
    expect(isBiomeTintedBlock("grass_block")).toBe(true);
    expect(isBiomeTintedBlock("oak_leaves")).toBe(true);
    expect(isBiomeTintedBlock("cobblestone")).toBe(false);
  });

  it("flags unbuildable blocks", () => {
    expect(isUnbuildableBlock("barrier")).toBe(true);
    expect(isUnbuildableBlock("infested_stone")).toBe(true);
    expect(isUnbuildableBlock("cobblestone")).toBe(false);
  });
});

// --- Synthetic archive + fake texture decoder, so the orchestration
// logic in buildPalette is fully deterministic and needs no real PNG or
// browser canvas (see textureDecoder.ts's header comment).

function solidTexture(size: number, rgba: readonly [number, number, number, number]): DecodedTexture {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = rgba[0];
    pixels[i + 1] = rgba[1];
    pixels[i + 2] = rgba[2];
    pixels[i + 3] = rgba[3];
  }
  return { width: size, height: size, pixels };
}

const TEXTURE_FIXTURES: Readonly<Record<string, DecodedTexture>> = {
  GRAY: solidTexture(2, [136, 136, 136, 255]),
  YELLOW: solidTexture(2, [255, 215, 0, 255]),
  TAN: solidTexture(2, [219, 203, 150, 255]),
  GREEN: solidTexture(2, [95, 159, 53, 255]),
  TRANSPARENT: solidTexture(2, [255, 255, 255, 128]),
  NONSQUARE: { width: 2, height: 4, pixels: new Uint8ClampedArray(2 * 4 * 4).fill(255) },
};

const fakeDecodeTexture: TextureDecoder = async (bytes) => {
  const key = new TextDecoder().decode(bytes);
  const fixture = TEXTURE_FIXTURES[key];
  if (fixture === undefined) throw new Error(`test bug: no texture fixture for '${key}'`);
  return fixture;
};

const CUBE_MODEL = {
  elements: [
    {
      from: [0, 0, 0],
      to: [16, 16, 16],
      faces: {
        down: { texture: "#all" },
        up: { texture: "#all" },
        north: { texture: "#all" },
        south: { texture: "#all" },
        east: { texture: "#all" },
        west: { texture: "#all" },
      },
    },
  ],
};

/** One simple cube_all-shaped block, backed by `textureKey` (a key into TEXTURE_FIXTURES), plus optional extra raw files (e.g. an .mcmeta, or a multi-variant blockstate override). */
function cubeAllBlockFiles(
  blockId: string,
  textureKey: string,
  extraFiles: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    [`assets/minecraft/blockstates/${blockId}.json`]: {
      variants: { "": { model: `minecraft:block/${blockId}` } },
    },
    [`assets/minecraft/models/block/${blockId}.json`]: {
      // Bound directly in this one flat model file (no cube_all-style
      // parent indirection needed for a test fixture) to the texture
      // file this same helper writes below.
      textures: { all: `minecraft:block/${blockId}` },
      elements: CUBE_MODEL.elements,
    },
    [`assets/minecraft/textures/block/${blockId}.png`]: textureKey,
    ...extraFiles,
  };
}

function archiveOf(files: Record<string, unknown>): MinecraftArchive {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    const text = typeof content === "string" ? content : JSON.stringify(content);
    entries[path] = new TextEncoder().encode(text);
  }
  return readMinecraftArchive(zipSync(entries));
}

function testArchive(): MinecraftArchive {
  return archiveOf({
    ...cubeAllBlockFiles("cobblestone", "GRAY"),
    ...cubeAllBlockFiles("gold_block", "YELLOW"),
    ...cubeAllBlockFiles("sand", "TAN"),
    ...cubeAllBlockFiles("grass_block", "GREEN"),
    ...cubeAllBlockFiles("barrier", "GRAY"),
    ...cubeAllBlockFiles("flickering_thing", "GRAY", {
      "assets/minecraft/textures/block/flickering_thing.png.mcmeta": "{}",
    }),
    ...cubeAllBlockFiles("glassy_thing", "TRANSPARENT"),
    "assets/minecraft/blockstates/oak_log.json": {
      variants: {
        "axis=x": { model: "minecraft:block/oak_log_horizontal" },
        "axis=y": { model: "minecraft:block/oak_log" },
      },
    },
  });
}

describe("buildPalette", () => {
  it("includes ordinary buildable blocks with the right resource location and color", async () => {
    const palette = await buildPalette(testArchive(), undefined, fakeDecodeTexture);
    const cobblestone = palette.find((block) => block.blockId === "cobblestone");
    expect(cobblestone).toBeDefined();
    expect(cobblestone?.resourceLocation).toBe("minecraft:cobblestone");
    expect(cobblestone?.costTier).toBe("common");
    expect(cobblestone?.color).toEqual(rgb8ToOklab({ r: 136, g: 136, b: 136 }));
  });

  it("excludes precious, gravity, biome-tinted, and unbuildable blocks by default", async () => {
    const palette = await buildPalette(testArchive(), undefined, fakeDecodeTexture);
    const blockIds = palette.map((block) => block.blockId);
    expect(blockIds).not.toContain("gold_block");
    expect(blockIds).not.toContain("sand");
    expect(blockIds).not.toContain("grass_block");
    expect(blockIds).not.toContain("barrier");
  });

  it("excludes a block with an animated texture", async () => {
    const palette = await buildPalette(testArchive(), undefined, fakeDecodeTexture);
    expect(palette.map((block) => block.blockId)).not.toContain("flickering_thing");
  });

  it("excludes a block with a non-opaque texture", async () => {
    const palette = await buildPalette(testArchive(), undefined, fakeDecodeTexture);
    expect(palette.map((block) => block.blockId)).not.toContain("glassy_thing");
  });

  it("excludes a block that is not a single-variant full cube", async () => {
    const palette = await buildPalette(testArchive(), undefined, fakeDecodeTexture);
    expect(palette.map((block) => block.blockId)).not.toContain("oak_log");
  });

  it("re-includes a precious block when survivalFriendlyOnly is relaxed", async () => {
    const palette = await buildPalette(
      testArchive(),
      { survivalFriendlyOnly: false, allowGravityBlocks: false, allowBiomeTintedBlocks: false },
      fakeDecodeTexture,
    );
    const goldBlock = palette.find((block) => block.blockId === "gold_block");
    expect(goldBlock?.costTier).toBe("precious");
  });

  it("re-includes a gravity block when allowGravityBlocks is set", async () => {
    const palette = await buildPalette(
      testArchive(),
      { survivalFriendlyOnly: true, allowGravityBlocks: true, allowBiomeTintedBlocks: false },
      fakeDecodeTexture,
    );
    expect(palette.map((block) => block.blockId)).toContain("sand");
  });

  it("re-includes a biome-tinted block when allowBiomeTintedBlocks is set", async () => {
    const palette = await buildPalette(
      testArchive(),
      { survivalFriendlyOnly: true, allowGravityBlocks: false, allowBiomeTintedBlocks: true },
      fakeDecodeTexture,
    );
    expect(palette.map((block) => block.blockId)).toContain("grass_block");
  });

  it("never re-includes an unconditionally unbuildable block, regardless of toggles", async () => {
    const palette = await buildPalette(
      testArchive(),
      { survivalFriendlyOnly: false, allowGravityBlocks: true, allowBiomeTintedBlocks: true },
      fakeDecodeTexture,
    );
    expect(palette.map((block) => block.blockId)).not.toContain("barrier");
  });

  it("averages multiple distinct face textures rather than using just one", async () => {
    const archive = archiveOf({
      "assets/minecraft/blockstates/two_tone.json": {
        variants: { "": { model: "minecraft:block/two_tone" } },
      },
      "assets/minecraft/models/block/two_tone.json": {
        textures: { a: "minecraft:block/two_tone_a", b: "minecraft:block/two_tone_b" },
        elements: [
          {
            from: [0, 0, 0],
            to: [16, 16, 16],
            faces: {
              down: { texture: "#a" },
              up: { texture: "#a" },
              north: { texture: "#b" },
              south: { texture: "#b" },
              east: { texture: "#b" },
              west: { texture: "#b" },
            },
          },
        ],
      },
      "assets/minecraft/textures/block/two_tone_a.png": "YELLOW",
      "assets/minecraft/textures/block/two_tone_b.png": "GRAY",
    });

    const palette = await buildPalette(archive, undefined, fakeDecodeTexture);
    const twoTone = palette.find((block) => block.blockId === "two_tone");
    expect(twoTone).toBeDefined();
    // Equal-weight average of YELLOW and GRAY's linear-light averages —
    // distinct from either texture alone.
    expect(twoTone?.color.L).not.toBeCloseTo(rgb8ToOklab({ r: 255, g: 215, b: 0 }).L, 2);
    expect(twoTone?.color.L).not.toBeCloseTo(rgb8ToOklab({ r: 136, g: 136, b: 136 }).L, 2);
  });
});
