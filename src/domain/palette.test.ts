import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readMinecraftArchive, type MinecraftArchive } from "../assets/archiveReader.ts";
import type { DecodedTexture } from "../assets/textureDecoder.ts";
import { oklabDistanceSquared, rgb8ToOklab } from "./color.ts";
import {
  acquisitionCostOf,
  buildPalette,
  costTierOf,
  isBiomeTintedBlock,
  isFlammableBlock,
  isGravityBlock,
  isUnbuildableBlock,
  isWoodFamilyBlock,
  listAxisVariantBlocks,
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

  it("flags wood-family blocks across logs, wood, planks, stems, hyphae, and stripped variants", () => {
    expect(isWoodFamilyBlock("oak_log")).toBe(true);
    expect(isWoodFamilyBlock("mangrove_log")).toBe(true);
    expect(isWoodFamilyBlock("dark_oak_planks")).toBe(true); // multi-word species name
    expect(isWoodFamilyBlock("stripped_mangrove_log")).toBe(true);
    expect(isWoodFamilyBlock("stripped_dark_oak_wood")).toBe(true);
    expect(isWoodFamilyBlock("crimson_stem")).toBe(true);
    expect(isWoodFamilyBlock("stripped_warped_hyphae")).toBe(true);
    expect(isWoodFamilyBlock("bamboo_planks")).toBe(true);
    expect(isWoodFamilyBlock("bamboo_mosaic")).toBe(true);
  });

  it("flags a wood species this app has no hardcoded knowledge of (proves the pattern match, not a species list, is what's doing the work)", () => {
    expect(isWoodFamilyBlock("poplar_log")).toBe(true);
    expect(isWoodFamilyBlock("poplar_planks")).toBe(true);
    expect(isWoodFamilyBlock("stripped_poplar_wood")).toBe(true);
  });

  it("does not flag non-wood blocks, including ones with a deceptively similar suffix", () => {
    expect(isWoodFamilyBlock("cobblestone")).toBe(false);
    expect(isWoodFamilyBlock("stone")).toBe(false);
    expect(isWoodFamilyBlock("end_stone")).toBe(false);
    expect(isWoodFamilyBlock("redstone_block")).toBe(false);
    expect(isWoodFamilyBlock("note_block")).toBe(false);
    expect(isWoodFamilyBlock("bookshelf")).toBe(false);
  });

  it("does not flag mushroom_stem as wood, despite ending in the same '_stem' suffix nether stems use", () => {
    expect(isWoodFamilyBlock("mushroom_stem")).toBe(false);
    // The nether stems the pattern exists to catch are unaffected.
    expect(isWoodFamilyBlock("crimson_stem")).toBe(true);
    expect(isWoodFamilyBlock("warped_stem")).toBe(true);
  });

  it("flags flammable blocks: wool, the small non-wood set, and (via isWoodFamilyBlock) every wood-family block", () => {
    expect(isFlammableBlock("white_wool")).toBe(true);
    expect(isFlammableBlock("black_wool")).toBe(true);
    expect(isFlammableBlock("hay_block")).toBe(true);
    expect(isFlammableBlock("bookshelf")).toBe(true);
    expect(isFlammableBlock("oak_log")).toBe(true); // via isWoodFamilyBlock
    expect(isFlammableBlock("oak_planks")).toBe(true);
    expect(isFlammableBlock("cobblestone")).toBe(false);
    expect(isFlammableBlock("stone")).toBe(false);
  });

  it("scores acquisition cost: 0 for ordinary blocks, 1 for elevated-but-common, 2 for precious tier", () => {
    expect(acquisitionCostOf("cobblestone")).toBe(0);
    expect(acquisitionCostOf("oak_planks")).toBe(0);
    expect(acquisitionCostOf("amethyst_block")).toBe(1);
    expect(acquisitionCostOf("sea_lantern")).toBe(1);
    expect(acquisitionCostOf("gold_block")).toBe(2);
    expect(acquisitionCostOf("diamond_block")).toBe(2);
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

/** Left half `leftRgba`, right half `rightRgba` — unlike every solid texture above, this has nonzero texture variance, which is what the busyness-aware matching tests below need. */
function splitTexture(
  size: number,
  leftRgba: readonly [number, number, number, number],
  rightRgba: readonly [number, number, number, number],
): DecodedTexture {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const rgba = col < size / 2 ? leftRgba : rightRgba;
      const pixelIndex = (row * size + col) * 4;
      pixels[pixelIndex] = rgba[0];
      pixels[pixelIndex + 1] = rgba[1];
      pixels[pixelIndex + 2] = rgba[2];
      pixels[pixelIndex + 3] = rgba[3];
    }
  }
  return { width: size, height: size, pixels };
}

const TEXTURE_FIXTURES: Readonly<Record<string, DecodedTexture>> = {
  GRAY: solidTexture(2, [136, 136, 136, 255]),
  YELLOW: solidTexture(2, [255, 215, 0, 255]),
  TAN: solidTexture(2, [219, 203, 150, 255]),
  GREEN: solidTexture(2, [95, 159, 53, 255]),
  TRANSPARENT: solidTexture(2, [255, 255, 255, 128]),
  NEARLY_OPAQUE: solidTexture(2, [136, 136, 136, 252]),
  NONSQUARE: { width: 2, height: 4, pixels: new Uint8ClampedArray(2 * 4 * 4).fill(255) },
  BLACK_WHITE_SPLIT: splitTexture(4, [0, 0, 0, 255], [255, 255, 255, 255]),
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
    // A real recipe: jukebox isn't named after diamond, so only
    // reading its recipe (not its id) can tell this is expensive.
    ...cubeAllBlockFiles("jukebox", "GRAY", {
      "data/minecraft/recipe/jukebox.json": {
        type: "minecraft:crafting_shaped",
        pattern: ["XXX", "XDX", "XXX"],
        key: { X: { item: "minecraft:oak_planks" }, D: { item: "minecraft:diamond" } },
        result: { item: "minecraft:jukebox" },
      },
    }),
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

  it("excludes a block crafted from a scarce ingredient by default, even though its own name doesn't say so (jukebox, from a diamond)", async () => {
    const palette = await buildPalette(testArchive(), undefined, fakeDecodeTexture);
    expect(palette.map((block) => block.blockId)).not.toContain("jukebox");
  });

  it("re-includes that block when survivalFriendlyOnly is relaxed", async () => {
    const palette = await buildPalette(
      testArchive(),
      { survivalFriendlyOnly: false, allowGravityBlocks: false, allowBiomeTintedBlocks: false },
      fakeDecodeTexture,
    );
    expect(palette.map((block) => block.blockId)).toContain("jukebox");
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

  it("excludes a concrete powder by default (gravity) but re-includes it when allowGravityBlocks is set", async () => {
    const archive = archiveOf(cubeAllBlockFiles("red_concrete_powder", "GRAY"));
    const excluded = await buildPalette(archive, undefined, fakeDecodeTexture);
    expect(excluded.map((block) => block.blockId)).not.toContain("red_concrete_powder");

    const included = await buildPalette(
      archive,
      { survivalFriendlyOnly: true, allowGravityBlocks: true, allowBiomeTintedBlocks: false },
      fakeDecodeTexture,
    );
    expect(included.map((block) => block.blockId)).toContain("red_concrete_powder");
  });

  it("unconditionally excludes coral (loses its color out of water) and unwaxed copper (oxidizes), with no toggle to re-include either", async () => {
    const archive = archiveOf({
      ...cubeAllBlockFiles("tube_coral_block", "GRAY"),
      ...cubeAllBlockFiles("copper_block", "GRAY"),
      ...cubeAllBlockFiles("waxed_copper_block", "GRAY"), // the stable equivalent: stays available
    });
    const palette = await buildPalette(
      archive,
      { survivalFriendlyOnly: false, allowGravityBlocks: true, allowBiomeTintedBlocks: true },
      fakeDecodeTexture,
    );
    const blockIds = palette.map((block) => block.blockId);
    expect(blockIds).not.toContain("tube_coral_block");
    expect(blockIds).not.toContain("copper_block");
    expect(blockIds).toContain("waxed_copper_block");
  });

  it("lifts an emissive block's resolved lightness above its own flat texture color", async () => {
    const archive = archiveOf(cubeAllBlockFiles("glowstone", "YELLOW"));
    const palette = await buildPalette(archive, undefined, fakeDecodeTexture);
    const glowstone = palette.find((block) => block.blockId === "glowstone");
    expect(glowstone).toBeDefined();
    expect(glowstone!.color.L).toBeGreaterThan(rgb8ToOklab({ r: 255, g: 215, b: 0 }).L);
  });

  it("carries each block's acquisitionCost through to the output", async () => {
    const palette = await buildPalette(
      testArchive(),
      { survivalFriendlyOnly: false, allowGravityBlocks: false, allowBiomeTintedBlocks: false },
      fakeDecodeTexture,
    );
    const cobblestone = palette.find((block) => block.blockId === "cobblestone");
    const goldBlock = palette.find((block) => block.blockId === "gold_block");
    expect(cobblestone?.acquisitionCost).toBe(0);
    expect(goldBlock?.acquisitionCost).toBe(2);
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

  it("gives a perfectly flat texture zero texture variance", async () => {
    const palette = await buildPalette(testArchive(), undefined, fakeDecodeTexture);
    const cobblestone = palette.find((block) => block.blockId === "cobblestone");
    expect(cobblestone?.textureVariance).toBe(0);
  });

  it("gives a busy (half-black, half-white) texture positive texture variance, with the mean now the TRUE Oklab centroid of its own pixels", async () => {
    const archive = archiveOf(cubeAllBlockFiles("noisy_thing", "BLACK_WHITE_SPLIT"));
    const palette = await buildPalette(archive, undefined, fakeDecodeTexture);
    const noisyThing = palette.find((block) => block.blockId === "noisy_thing");
    expect(noisyThing).toBeDefined();
    expect(noisyThing!.textureVariance).toBeGreaterThan(0);

    // Every pixel is pure black or pure white in equal numbers. `color`
    // is computed by averaging each pixel's own Oklab coordinates
    // DIRECTLY (not by averaging in linear light and converting the
    // result afterward, which Oklab's cube-root nonlinearity would pull
    // closer to white than black — the bug an earlier version of this
    // test actually pinned). Averaging directly in Oklab makes black and
    // white exactly equidistant from the result by construction, so the
    // variance is exactly that one shared squared distance, not a blend
    // of two different ones.
    const blackDistanceSquared = oklabDistanceSquared(rgb8ToOklab({ r: 0, g: 0, b: 0 }), noisyThing!.color);
    const whiteDistanceSquared = oklabDistanceSquared(rgb8ToOklab({ r: 255, g: 255, b: 255 }), noisyThing!.color);
    expect(blackDistanceSquared).toBeCloseTo(whiteDistanceSquared, 6);
    expect(noisyThing!.textureVariance).toBeCloseTo(blackDistanceSquared, 10);
  });

  it("accepts a texture with slightly-less-than-fully-opaque pixels (resource-pack rounding), unlike a genuinely translucent one", async () => {
    const archive = archiveOf(cubeAllBlockFiles("rounded_alpha_thing", "NEARLY_OPAQUE"));
    const palette = await buildPalette(archive, undefined, fakeDecodeTexture);
    expect(palette.map((block) => block.blockId)).toContain("rounded_alpha_thing");
  });
});

// --- listAxisVariantBlocks: a complete, resolvable oak_log-shaped
// fixture (unlike testArchive()'s deliberately-incomplete oak_log,
// which only exists to prove buildPalette excludes it).

const PILLAR_ELEMENT_FACES = {
  down: { texture: "#end" },
  up: { texture: "#end" },
  north: { texture: "#side" },
  south: { texture: "#side" },
  east: { texture: "#side" },
  west: { texture: "#side" },
};
const PILLAR_CUBE_ELEMENTS = [{ from: [0, 0, 0], to: [16, 16, 16], faces: PILLAR_ELEMENT_FACES }];

function oakLogFiles(blockId: string, endTextureKey: string, sideTextureKey: string): Record<string, unknown> {
  return {
    [`assets/minecraft/blockstates/${blockId}.json`]: {
      variants: {
        "axis=y": { model: `minecraft:block/${blockId}` },
        "axis=z": { model: `minecraft:block/${blockId}_horizontal`, x: 90 },
        "axis=x": { model: `minecraft:block/${blockId}_horizontal`, x: 90, y: 90 },
      },
    },
    [`assets/minecraft/models/block/${blockId}.json`]: {
      parent: "minecraft:block/cube_column",
      textures: { end: `minecraft:block/${blockId}_top`, side: `minecraft:block/${blockId}` },
    },
    [`assets/minecraft/models/block/${blockId}_horizontal.json`]: {
      parent: "minecraft:block/cube_column_horizontal",
      textures: { end: `minecraft:block/${blockId}_top`, side: `minecraft:block/${blockId}` },
    },
    "assets/minecraft/models/block/cube_column.json": { elements: PILLAR_CUBE_ELEMENTS },
    "assets/minecraft/models/block/cube_column_horizontal.json": { elements: PILLAR_CUBE_ELEMENTS },
    [`assets/minecraft/textures/block/${blockId}_top.png`]: endTextureKey,
    [`assets/minecraft/textures/block/${blockId}.png`]: sideTextureKey,
  };
}

function axisVariantTestArchive(): MinecraftArchive {
  return archiveOf({
    ...cubeAllBlockFiles("cobblestone", "GRAY"),
    ...oakLogFiles("oak_log", "TAN", "GREEN"),
    // Real gold_block isn't axis-shaped in vanilla; giving it this shape
    // here is purely to test that the precious-tier exclusion applies
    // regardless of a block's actual geometry — costTierOf is a plain
    // id lookup, so this is a valid (if unrealistic) fixture for that.
    ...oakLogFiles("gold_block", "YELLOW", "YELLOW"),
  });
}

describe("listAxisVariantBlocks", () => {
  it("includes a real axis-pillar block, resolved via its 'upright' orientation", async () => {
    const blocks = await listAxisVariantBlocks(axisVariantTestArchive(), undefined, fakeDecodeTexture);
    const oakLog = blocks.find((block) => block.blockId === "oak_log");
    expect(oakLog).toBeDefined();
    expect(oakLog?.resourceLocation).toBe("minecraft:oak_log");
    expect(oakLog?.costTier).toBe("common");
  });

  it("does not include single-variant blocks", async () => {
    const blocks = await listAxisVariantBlocks(axisVariantTestArchive(), undefined, fakeDecodeTexture);
    expect(blocks.map((b) => b.blockId)).not.toContain("cobblestone");
  });

  it("applies the same exclusion filters as buildPalette (precious tier, by default)", async () => {
    const blocks = await listAxisVariantBlocks(axisVariantTestArchive(), undefined, fakeDecodeTexture);
    expect(blocks.map((b) => b.blockId)).not.toContain("gold_block");

    const relaxed = await listAxisVariantBlocks(
      axisVariantTestArchive(),
      { survivalFriendlyOnly: false, allowGravityBlocks: false, allowBiomeTintedBlocks: false },
      fakeDecodeTexture,
    );
    const goldBlock = relaxed.find((b) => b.blockId === "gold_block");
    expect(goldBlock?.costTier).toBe("precious");
  });

  it("buildPalette's output is disjoint from listAxisVariantBlocks' (a block is never both)", async () => {
    const archive = axisVariantTestArchive();
    const fillPalette = await buildPalette(archive, undefined, fakeDecodeTexture);
    const axisBlocks = await listAxisVariantBlocks(archive, undefined, fakeDecodeTexture);
    const fillIds = new Set(fillPalette.map((b) => b.blockId));
    for (const axisBlock of axisBlocks) {
      expect(fillIds.has(axisBlock.blockId)).toBe(false);
    }
  });
});
