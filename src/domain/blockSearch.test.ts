import { describe, expect, it } from "vitest";
import { matchesSearch, searchTermsFor } from "./blockSearch.ts";

/** What the picker does: terms are derived per block, then every block is tested. */
const matches = (blockId: string, query: string): boolean => matchesSearch(searchTermsFor(blockId), query);

describe("searchTermsFor", () => {
  it("always includes the whole id, so no query that worked before can stop working", () => {
    expect(searchTermsFor("oak_log").has("oak_log")).toBe(true);
  });

  it("makes the nether's logs findable as logs — they are named stem and hyphae, never log", () => {
    for (const blockId of ["warped_stem", "crimson_stem", "warped_hyphae", "stripped_crimson_hyphae"]) {
      const terms = searchTermsFor(blockId);
      expect(terms.has("log"), blockId).toBe(true);
      expect(terms.has("wood"), blockId).toBe(true);
      expect(terms.has("nether"), blockId).toBe(true);
    }
  });

  it("does not call mushroom_stem a log: it ends in _stem but is not wood", () => {
    const terms = searchTermsFor("mushroom_stem");
    expect(terms.has("log")).toBe(false);
    expect(terms.has("wood")).toBe(false);
    expect(terms.has("nether")).toBe(false);
  });

  it("does not call an ordinary log a nether block", () => {
    expect(searchTermsFor("oak_log").has("nether")).toBe(false);
  });
});

describe("matchesSearch", () => {
  it("finds the warped stem by the name a player would actually type", () => {
    for (const query of ["warped log", "nether log", "warped", "stem", "log", "WARPED LOG", "  warped   log  "]) {
      expect(matches("warped_stem", query), query).toBe(true);
    }
  });

  it("narrows rather than widens as words are added — 'warped log' must not return every log", () => {
    expect(matches("oak_log", "warped log")).toBe(false);
    expect(matches("oak_log", "log")).toBe(true);
  });

  it("handles multi-word queries at all, which the old substring match could never do", () => {
    // No block id contains a space, so every one of these used to match nothing.
    expect(matches("oak_planks", "oak plank")).toBe(true);
    expect(matches("red_concrete", "red concrete")).toBe(true);
    expect(matches("stripped_acacia_log", "stripped acacia")).toBe(true);
  });

  it("still matches a bare substring the way the old search did", () => {
    expect(matches("white_terracotta", "cotta")).toBe(true);
    expect(matches("cobblestone", "cobble")).toBe(true);
    expect(matches("oak_log", "oak_log")).toBe(true);
  });

  it("shows everything for an empty or whitespace-only query", () => {
    for (const query of ["", "   ", "\t"]) expect(matches("anything_at_all", query)).toBe(true);
  });

  it("rejects a block that matches only some of the words", () => {
    expect(matches("warped_planks", "warped log")).toBe(false);
    expect(matches("oak_log", "oak stone")).toBe(false);
  });

  it("finds the terracottas by 'clay', which is what they are made of", () => {
    expect(matches("orange_terracotta", "orange clay")).toBe(true);
    expect(matches("orange_concrete", "orange clay")).toBe(false);
  });
});
