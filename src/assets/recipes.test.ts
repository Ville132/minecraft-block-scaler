import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readMinecraftArchive, type MinecraftArchive } from "./archiveReader.ts";
import { requiresScarceIngredient } from "./recipes.ts";

function archiveOf(files: Record<string, unknown>): MinecraftArchive {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    const text = typeof content === "string" ? content : JSON.stringify(content);
    entries[path] = new TextEncoder().encode(text);
  }
  return readMinecraftArchive(zipSync(entries));
}

describe("requiresScarceIngredient", () => {
  it("is true for a real shaped recipe needing a diamond (jukebox)", () => {
    const archive = archiveOf({
      "data/minecraft/recipe/jukebox.json": {
        type: "minecraft:crafting_shaped",
        pattern: ["XXX", "XDX", "XXX"],
        key: {
          X: { item: "minecraft:oak_planks" },
          D: { item: "minecraft:diamond" },
        },
        result: { item: "minecraft:jukebox" },
      },
    });
    expect(requiresScarceIngredient(archive, "jukebox")).toBe(true);
  });

  it("is true for a shapeless recipe needing a scarce ingredient", () => {
    const archive = archiveOf({
      "data/minecraft/recipe/example.json": {
        type: "minecraft:crafting_shapeless",
        ingredients: [{ item: "minecraft:oak_planks" }, { item: "minecraft:gold_ingot" }],
        result: { item: "minecraft:example" },
      },
    });
    expect(requiresScarceIngredient(archive, "example")).toBe(true);
  });

  it("is false when every ingredient is common", () => {
    const archive = archiveOf({
      "data/minecraft/recipe/crafting_table.json": {
        type: "minecraft:crafting_shaped",
        pattern: ["XX", "XX"],
        key: { X: { item: "minecraft:oak_planks" } },
        result: { item: "minecraft:crafting_table" },
      },
    });
    expect(requiresScarceIngredient(archive, "crafting_table")).toBe(false);
  });

  it("is false when there is no recipe file (the common case — most blocks are mined, not crafted)", () => {
    expect(requiresScarceIngredient(archiveOf({}), "cobblestone")).toBe(false);
  });

  it("is false for an unsupported recipe type (e.g. smelting), not assessed rather than assumed safe or scarce", () => {
    const archive = archiveOf({
      "data/minecraft/recipe/stone.json": {
        type: "minecraft:smelting",
        ingredient: { item: "minecraft:cobblestone" },
        result: { item: "minecraft:stone" },
      },
    });
    expect(requiresScarceIngredient(archive, "stone")).toBe(false);
  });

  it("is false for malformed JSON", () => {
    const archive = archiveOf({ "data/minecraft/recipe/broken.json": "{ not valid json" });
    expect(requiresScarceIngredient(archive, "broken")).toBe(false);
  });

  it("checks every alternative in a list-of-options ingredient", () => {
    const archive = archiveOf({
      "data/minecraft/recipe/example.json": {
        type: "minecraft:crafting_shaped",
        pattern: ["X"],
        key: { X: [{ item: "minecraft:oak_planks" }, { item: "minecraft:emerald" }] },
        result: { item: "minecraft:example" },
      },
    });
    expect(requiresScarceIngredient(archive, "example")).toBe(true);
  });

  it("skips a tag-reference ingredient rather than crashing or false-flagging it", () => {
    const archive = archiveOf({
      "data/minecraft/recipe/example.json": {
        type: "minecraft:crafting_shaped",
        pattern: ["X"],
        key: { X: { tag: "minecraft:planks" } },
        result: { item: "minecraft:example" },
      },
    });
    expect(requiresScarceIngredient(archive, "example")).toBe(false);
  });

  it("matches a scarce item id with or without the minecraft: namespace prefix", () => {
    const archive = archiveOf({
      "data/minecraft/recipe/example.json": {
        type: "minecraft:crafting_shapeless",
        ingredients: [{ item: "diamond" }],
        result: { item: "minecraft:example" },
      },
    });
    expect(requiresScarceIngredient(archive, "example")).toBe(true);
  });
});
