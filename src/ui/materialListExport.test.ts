import { describe, expect, it } from "vitest";
import { breakdownQuantity, type MaterialListEntry } from "../domain/materials.ts";
import { materialListToCsv, materialListToText } from "./materialListExport.ts";

function entry(
  resourceLocation: string,
  count: number,
  properties?: Readonly<Record<string, string>>,
): MaterialListEntry {
  return {
    blockId: resourceLocation.replace("minecraft:", ""),
    resourceLocation,
    count,
    breakdown: breakdownQuantity(count),
    ...(properties !== undefined && { properties }),
  };
}

describe("materialListToText", () => {
  it("formats the plan's worked example", () => {
    const text = materialListToText([entry("minecraft:cobblestone", 1800)]);
    expect(text).toBe("minecraft:cobblestone: 1800 (1 shulker box + 1 stack + 8 loose)");
  });

  it("pluralizes correctly and omits zero-valued units", () => {
    expect(materialListToText([entry("minecraft:stone", 64)])).toBe("minecraft:stone: 64 (1 stack)");
    expect(materialListToText([entry("minecraft:dirt", 5)])).toBe("minecraft:dirt: 5 (5 loose)");
    expect(materialListToText([entry("minecraft:sand", 0)])).toBe("minecraft:sand: 0 (0 loose)");
    expect(materialListToText([entry("minecraft:gravel", 3456)])).toBe("minecraft:gravel: 3456 (2 shulker boxes)");
  });

  it("joins multiple entries with newlines, preserving order", () => {
    const text = materialListToText([entry("minecraft:cobblestone", 100), entry("minecraft:andesite", 5)]);
    expect(text.split("\n")).toHaveLength(2);
    expect(text.split("\n")[0]).toContain("cobblestone");
    expect(text.split("\n")[1]).toContain("andesite");
  });

  it("returns an empty string for an empty list", () => {
    expect(materialListToText([])).toBe("");
  });

  it("shows a block's placement properties in brackets", () => {
    const text = materialListToText([entry("minecraft:orange_glazed_terracotta", 12, { facing: "north" })]);
    expect(text).toBe("minecraft:orange_glazed_terracotta [facing=north]: 12 (12 loose)");
  });

  it("joins multiple properties with semicolons", () => {
    const text = materialListToText([
      entry("minecraft:oak_stairs", 1, { facing: "north", half: "top" }),
    ]);
    expect(text).toContain("[facing=north;half=top]");
  });
});

describe("materialListToCsv", () => {
  it("includes a header row and one row per entry", () => {
    const csv = materialListToCsv([entry("minecraft:cobblestone", 1800), entry("minecraft:andesite", 64)]);
    const rows = csv.split("\n");
    expect(rows[0]).toBe("Block,Count,Shulker Boxes,Stacks,Singles,Properties");
    expect(rows[1]).toBe("minecraft:cobblestone,1800,1,1,8,");
    expect(rows[2]).toBe("minecraft:andesite,64,0,1,0,");
  });

  it("escapes a field containing a comma or quote", () => {
    const csv = materialListToCsv([entry('minecraft:weird,"block', 1)]);
    expect(csv.split("\n")[1]).toBe('"minecraft:weird,""block",1,0,0,1,');
  });

  it("is just the header for an empty list", () => {
    expect(materialListToCsv([])).toBe("Block,Count,Shulker Boxes,Stacks,Singles,Properties");
  });

  it("puts a block's properties in the last column, semicolon-joined", () => {
    const csv = materialListToCsv([
      entry("minecraft:orange_glazed_terracotta", 12, { facing: "north", half: "top" }),
    ]);
    expect(csv.split("\n")[1]).toBe("minecraft:orange_glazed_terracotta,12,0,0,12,facing=north;half=top");
  });
});
