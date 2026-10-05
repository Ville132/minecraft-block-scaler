import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readMinecraftArchive, type MinecraftArchive } from "./archiveReader.ts";
import { hasAxisVariants, resolveAxisVariantCubeModel, resolveCanonicalVariantCubeModel } from "./modelResolver.ts";

function archiveOf(files: Record<string, unknown>): MinecraftArchive {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    const text = typeof content === "string" ? content : JSON.stringify(content);
    entries[path] = new TextEncoder().encode(text);
  }
  return readMinecraftArchive(zipSync(entries));
}

const CUBE_MODEL = {
  elements: [
    {
      from: [0, 0, 0],
      to: [16, 16, 16],
      faces: {
        down: { texture: "#down" },
        up: { texture: "#up" },
        north: { texture: "#north" },
        south: { texture: "#south" },
        east: { texture: "#east" },
        west: { texture: "#west" },
      },
    },
  ],
};

const CUBE_ALL_MODEL = {
  parent: "minecraft:block/cube",
  textures: {
    particle: "#all",
    down: "#all",
    up: "#all",
    north: "#all",
    south: "#all",
    east: "#all",
    west: "#all",
  },
};

/** The real cobblestone/cube_all/cube chain, parametrized so tests can override one file at a time. */
function cubeAllArchive(overrides: Record<string, unknown> = {}): MinecraftArchive {
  return archiveOf({
    "assets/minecraft/blockstates/cobblestone.json": {
      variants: { "": { model: "minecraft:block/cobblestone" } },
    },
    "assets/minecraft/models/block/cobblestone.json": {
      parent: "minecraft:block/cube_all",
      textures: { all: "minecraft:block/cobblestone" },
    },
    "assets/minecraft/models/block/cube_all.json": CUBE_ALL_MODEL,
    "assets/minecraft/models/block/cube.json": CUBE_MODEL,
    ...overrides,
  });
}

describe("resolveCanonicalVariantCubeModel — single-variant happy path", () => {
  it("resolves all six faces through a cube_all parent chain, with no properties", () => {
    const result = resolveCanonicalVariantCubeModel(cubeAllArchive(), "cobblestone");
    expect(result?.model).toEqual({
      faceTextureIds: {
        down: "block/cobblestone",
        up: "block/cobblestone",
        north: "block/cobblestone",
        south: "block/cobblestone",
        east: "block/cobblestone",
        west: "block/cobblestone",
      },
    });
    expect(result?.properties).toEqual({});
  });

  it("resolves different textures per face through multiple indirection hops", () => {
    const archive = archiveOf({
      "assets/minecraft/blockstates/mystery.json": {
        variants: { "": { model: "minecraft:block/mystery" } },
      },
      "assets/minecraft/models/block/mystery.json": {
        parent: "minecraft:block/cube_bottom_top",
        textures: {
          top: "minecraft:block/mystery_top",
          bottom: "minecraft:block/mystery_bottom",
          side: "minecraft:block/mystery_side",
        },
      },
      "assets/minecraft/models/block/cube_bottom_top.json": {
        parent: "minecraft:block/cube",
        textures: {
          down: "#bottom",
          up: "#top",
          north: "#side",
          south: "#side",
          east: "#side",
          west: "#side",
          bottom: "#bottom",
        },
      },
      "assets/minecraft/models/block/cube.json": CUBE_MODEL,
    });
    const result = resolveCanonicalVariantCubeModel(archive, "mystery");
    expect(result?.model.faceTextureIds.up).toBe("block/mystery_top");
    expect(result?.model.faceTextureIds.down).toBe("block/mystery_bottom");
    expect(result?.model.faceTextureIds.north).toBe("block/mystery_side");
    expect(result?.model.faceTextureIds.west).toBe("block/mystery_side");
  });

  it("takes the first option of a randomized (array) variant", () => {
    const archive = cubeAllArchive({
      "assets/minecraft/blockstates/cobblestone.json": {
        variants: {
          "": [{ model: "minecraft:block/cobblestone", weight: 1 }, { model: "minecraft:block/other" }],
        },
      },
    });
    const result = resolveCanonicalVariantCubeModel(archive, "cobblestone");
    expect(result?.model.faceTextureIds.up).toBe("block/cobblestone");
  });
});

describe("resolveCanonicalVariantCubeModel — multi-variant selection", () => {
  it("accepts a single variant keyed by a property instead of the empty string (e.g. glazed terracotta's facing=) — this app originally rejected these outright", () => {
    const archive = cubeAllArchive({
      "assets/minecraft/blockstates/cobblestone.json": {
        variants: { "facing=north": { model: "minecraft:block/cobblestone" } },
      },
    });
    const result = resolveCanonicalVariantCubeModel(archive, "cobblestone");
    expect(result?.model.faceTextureIds.up).toBe("block/cobblestone");
    expect(result?.properties).toEqual({ facing: "north" });
  });

  it("prefers facing=north over other facing values when several are offered", () => {
    const archive = cubeAllArchive({
      "assets/minecraft/blockstates/cobblestone.json": {
        variants: {
          "facing=east": { model: "minecraft:block/cobblestone" },
          "facing=north": { model: "minecraft:block/cobblestone" },
          "facing=south": { model: "minecraft:block/cobblestone" },
          "facing=west": { model: "minecraft:block/cobblestone" },
        },
      },
    });
    const result = resolveCanonicalVariantCubeModel(archive, "cobblestone");
    expect(result?.properties).toEqual({ facing: "north" });
  });

  it("prefers a 'false'-valued property over 'true' (an idle default over an active one, e.g. an unlit furnace over a lit one)", () => {
    const archive = cubeAllArchive({
      "assets/minecraft/blockstates/cobblestone.json": {
        variants: {
          "lit=true": { model: "minecraft:block/cobblestone" },
          "lit=false": { model: "minecraft:block/cobblestone" },
        },
      },
    });
    const result = resolveCanonicalVariantCubeModel(archive, "cobblestone");
    expect(result?.properties).toEqual({ lit: "false" });
  });

  it("breaks a true tie (no property scores for either option) by the lexicographically smallest variant key", () => {
    const archive = cubeAllArchive({
      "assets/minecraft/blockstates/cobblestone.json": {
        variants: {
          "mode=subtract": { model: "minecraft:block/cobblestone" },
          "mode=compare": { model: "minecraft:block/cobblestone" },
        },
      },
    });
    const result = resolveCanonicalVariantCubeModel(archive, "cobblestone");
    expect(result?.properties).toEqual({ mode: "compare" }); // "mode=compare" < "mode=subtract"
  });

  it("does not special-case an axis=x/y/z-shaped blockstate — picks one deterministically like any other multi-variant block, since routing axis blocks to resolveAxisVariantCubeModel instead is the CALLER's job (see hasAxisVariants)", () => {
    const result = resolveCanonicalVariantCubeModel(oakLogArchive(), "oak_log");
    expect(result).toBeDefined();
    // No property here scores ("axis" isn't "false" or facing=north), so
    // this falls through to the lexicographic tie-break: "axis=x" is the
    // smallest of "axis=x"/"axis=y"/"axis=z".
    expect(result?.properties).toEqual({ axis: "x" });
  });
});

describe("resolveCanonicalVariantCubeModel — rejections", () => {
  it("rejects a multipart blockstate", () => {
    const archive = cubeAllArchive({
      "assets/minecraft/blockstates/cobblestone.json": {
        multipart: [{ apply: { model: "minecraft:block/cobblestone" } }],
      },
    });
    expect(resolveCanonicalVariantCubeModel(archive, "cobblestone")).toBeUndefined();
  });

  it("rejects a block whose blockstates file is missing", () => {
    expect(resolveCanonicalVariantCubeModel(cubeAllArchive(), "does_not_exist")).toBeUndefined();
  });

  it("rejects an empty variants object (nothing to resolve)", () => {
    const archive = cubeAllArchive({
      "assets/minecraft/blockstates/cobblestone.json": { variants: {} },
    });
    expect(resolveCanonicalVariantCubeModel(archive, "cobblestone")).toBeUndefined();
  });

  it("rejects a model chain referencing a missing parent file", () => {
    const archive = cubeAllArchive({
      "assets/minecraft/models/block/cobblestone.json": {
        parent: "minecraft:block/does_not_exist",
        textures: { all: "minecraft:block/cobblestone" },
      },
    });
    expect(resolveCanonicalVariantCubeModel(archive, "cobblestone")).toBeUndefined();
  });

  it("rejects a cyclic parent chain instead of hanging", () => {
    const archive = cubeAllArchive({
      "assets/minecraft/models/block/cobblestone.json": {
        parent: "minecraft:block/cube_all",
        textures: { all: "minecraft:block/cobblestone" },
      },
      "assets/minecraft/models/block/cube_all.json": {
        parent: "minecraft:block/cobblestone", // points back at the leaf
        textures: { particle: "#all" },
      },
    });
    expect(resolveCanonicalVariantCubeModel(archive, "cobblestone")).toBeUndefined();
  });

  it("rejects a non-full-cube element (e.g. a slab-shaped bounding box)", () => {
    const archive = cubeAllArchive({
      "assets/minecraft/models/block/cube.json": {
        elements: [
          {
            from: [0, 0, 0],
            to: [16, 8, 16],
            faces: {
              down: { texture: "#down" },
              up: { texture: "#up" },
              north: { texture: "#north" },
              south: { texture: "#south" },
              east: { texture: "#east" },
              west: { texture: "#west" },
            },
          },
        ],
      },
    });
    expect(resolveCanonicalVariantCubeModel(archive, "cobblestone")).toBeUndefined();
  });

  it("rejects an element missing one of the six faces", () => {
    const archive = cubeAllArchive({
      "assets/minecraft/models/block/cube.json": {
        elements: [
          {
            from: [0, 0, 0],
            to: [16, 16, 16],
            faces: {
              down: { texture: "#down" },
              up: { texture: "#up" },
              north: { texture: "#north" },
              south: { texture: "#south" },
              east: { texture: "#east" },
              // west missing
            },
          },
        ],
      },
    });
    expect(resolveCanonicalVariantCubeModel(archive, "cobblestone")).toBeUndefined();
  });

  it("rejects an unresolvable texture variable", () => {
    const archive = cubeAllArchive({
      "assets/minecraft/models/block/cobblestone.json": {
        parent: "minecraft:block/cube_all",
        textures: {}, // never binds "all", so "#all" can never resolve
      },
    });
    expect(resolveCanonicalVariantCubeModel(archive, "cobblestone")).toBeUndefined();
  });

  it("rejects malformed JSON in a model file", () => {
    const archive = cubeAllArchive({
      "assets/minecraft/models/block/cube_all.json": "{ not valid json",
    });
    expect(resolveCanonicalVariantCubeModel(archive, "cobblestone")).toBeUndefined();
  });

  it("rejects multiple elements (not a single simple cube)", () => {
    const archive = cubeAllArchive({
      "assets/minecraft/models/block/cube.json": {
        elements: [CUBE_MODEL.elements[0], CUBE_MODEL.elements[0]],
      },
    });
    expect(resolveCanonicalVariantCubeModel(archive, "cobblestone")).toBeUndefined();
  });
});

// A faithful miniature of oak_log's real data (fetched from Mojang's
// actual asset files during development): axis=y uses the base
// cube_column model with no rotation; axis=z and axis=x reference a
// SEPARATE "_horizontal" model whose local face layout is identical,
// reoriented purely by the blockstate's own x/y rotation fields. This
// is the real mechanism (see domain/faces.ts's rotateFaceDirection) —
// not three different models, one model rotated two different ways.
const PILLAR_ELEMENT_FACES = {
  down: { texture: "#end" },
  up: { texture: "#end" },
  north: { texture: "#side" },
  south: { texture: "#side" },
  east: { texture: "#side" },
  west: { texture: "#side" },
};
const PILLAR_CUBE_ELEMENTS = [{ from: [0, 0, 0], to: [16, 16, 16], faces: PILLAR_ELEMENT_FACES }];

function oakLogArchive(overrides: Record<string, unknown> = {}): MinecraftArchive {
  return archiveOf({
    "assets/minecraft/blockstates/oak_log.json": {
      variants: {
        "axis=y": { model: "minecraft:block/oak_log" },
        "axis=z": { model: "minecraft:block/oak_log_horizontal", x: 90 },
        "axis=x": { model: "minecraft:block/oak_log_horizontal", x: 90, y: 90 },
      },
    },
    "assets/minecraft/models/block/oak_log.json": {
      parent: "minecraft:block/cube_column",
      textures: { end: "minecraft:block/oak_log_top", side: "minecraft:block/oak_log" },
    },
    "assets/minecraft/models/block/oak_log_horizontal.json": {
      parent: "minecraft:block/cube_column_horizontal",
      textures: { end: "minecraft:block/oak_log_top", side: "minecraft:block/oak_log" },
    },
    "assets/minecraft/models/block/cube_column.json": { elements: PILLAR_CUBE_ELEMENTS },
    "assets/minecraft/models/block/cube_column_horizontal.json": { elements: PILLAR_CUBE_ELEMENTS },
    ...overrides,
  });
}

describe("hasAxisVariants", () => {
  it("is true for a real axis=x/y/z-shaped blockstate", () => {
    expect(hasAxisVariants(oakLogArchive(), "oak_log")).toBe(true);
  });

  it("is false for a single-variant block", () => {
    expect(hasAxisVariants(cubeAllArchive(), "cobblestone")).toBe(false);
  });

  it("is false when only some axis keys are present", () => {
    const archive = oakLogArchive({
      "assets/minecraft/blockstates/oak_log.json": {
        variants: {
          "axis=y": { model: "minecraft:block/oak_log" },
          "axis=z": { model: "minecraft:block/oak_log_horizontal", x: 90 },
        },
      },
    });
    expect(hasAxisVariants(archive, "oak_log")).toBe(false);
  });

  it("is false for a missing block", () => {
    expect(hasAxisVariants(oakLogArchive(), "does_not_exist")).toBe(false);
  });
});

describe("resolveAxisVariantCubeModel", () => {
  it("'upright' puts the end-cap texture on up/down and the side texture on the 4 sides", () => {
    const result = resolveAxisVariantCubeModel(oakLogArchive(), "oak_log", "upright");
    expect(result).toEqual({
      faceTextureIds: {
        down: "block/oak_log_top",
        up: "block/oak_log_top",
        north: "block/oak_log",
        south: "block/oak_log",
        east: "block/oak_log",
        west: "block/oak_log",
      },
    });
  });

  it("'sideways' puts the end-cap texture on north/south, matching real axis=z rotation", () => {
    const result = resolveAxisVariantCubeModel(oakLogArchive(), "oak_log", "sideways");
    expect(result).toEqual({
      faceTextureIds: {
        down: "block/oak_log",
        up: "block/oak_log",
        north: "block/oak_log_top",
        south: "block/oak_log_top",
        east: "block/oak_log",
        west: "block/oak_log",
      },
    });
  });

  it("'sideways' is not identical to 'upright' (guards against the rotation silently being a no-op)", () => {
    const upright = resolveAxisVariantCubeModel(oakLogArchive(), "oak_log", "upright");
    const sideways = resolveAxisVariantCubeModel(oakLogArchive(), "oak_log", "sideways");
    expect(sideways).not.toEqual(upright);
  });

  it("rejects a block with no axis variants", () => {
    expect(resolveAxisVariantCubeModel(cubeAllArchive(), "cobblestone", "upright")).toBeUndefined();
  });

  it("rejects an invalid (non-multiple-of-90) rotation value", () => {
    const archive = oakLogArchive({
      "assets/minecraft/blockstates/oak_log.json": {
        variants: {
          "axis=y": { model: "minecraft:block/oak_log" },
          "axis=z": { model: "minecraft:block/oak_log_horizontal", x: 45 },
          "axis=x": { model: "minecraft:block/oak_log_horizontal", x: 90, y: 90 },
        },
      },
    });
    expect(resolveAxisVariantCubeModel(archive, "oak_log", "sideways")).toBeUndefined();
  });
});

describe("per-archive model/blockstate caching", () => {
  it("resolves the same block identically on a second call against the same archive", () => {
    const archive = cubeAllArchive();
    const first = resolveCanonicalVariantCubeModel(archive, "cobblestone");
    const second = resolveCanonicalVariantCubeModel(archive, "cobblestone");
    expect(second).toEqual(first);
  });

  it("does not leak a cached result from one archive into a different archive instance, even for the same block id", () => {
    const archiveA = cubeAllArchive(); // cobblestone -> minecraft:block/cobblestone
    const archiveB = cubeAllArchive({
      "assets/minecraft/models/block/cobblestone.json": {
        parent: "minecraft:block/cube_all",
        textures: { all: "minecraft:block/a_totally_different_texture" },
      },
    });

    const resultA = resolveCanonicalVariantCubeModel(archiveA, "cobblestone");
    const resultB = resolveCanonicalVariantCubeModel(archiveB, "cobblestone");

    expect(resultA?.model.faceTextureIds.up).toBe("block/cobblestone");
    expect(resultB?.model.faceTextureIds.up).toBe("block/a_totally_different_texture");

    // Re-resolving A after B confirms A's own cache wasn't overwritten either.
    expect(resolveCanonicalVariantCubeModel(archiveA, "cobblestone")?.model.faceTextureIds.up).toBe(
      "block/cobblestone",
    );
  });
});
