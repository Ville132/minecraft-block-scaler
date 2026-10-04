/**
 * `buildReplica` itself is orchestration with no automated test (see
 * this module's own header comment) — but `pickInteriorFillBlock` is
 * genuine, pure, deterministic logic extracted from it, so it gets the
 * same unit-testing treatment as any domain function.
 */
import { describe, expect, it } from "vitest";
import { rgb8ToOklab } from "../domain/color.ts";
import type { PaletteBlock } from "../domain/palette.ts";
import { pickInteriorFillBlock } from "./buildReplica.ts";

function fakeBlock(
  blockId: string,
  acquisitionCost: number,
  textureVariance = 0,
): PaletteBlock {
  return {
    blockId,
    resourceLocation: `minecraft:${blockId}`,
    color: rgb8ToOklab({ r: 128, g: 128, b: 128 }),
    textureVariance,
    costTier: "common",
    acquisitionCost,
  };
}

describe("pickInteriorFillBlock", () => {
  it("picks the single cheapest candidate when costs differ", () => {
    const cheap = fakeBlock("stone", 0);
    const elevated = fakeBlock("amethyst_block", 1);
    expect(pickInteriorFillBlock([elevated, cheap]).blockId).toBe("stone");
  });

  it("breaks a cost tie by the flattest texture", () => {
    const busy = fakeBlock("cobblestone", 0, 0.05);
    const flat = fakeBlock("stone", 0, 0);
    expect(pickInteriorFillBlock([busy, flat]).blockId).toBe("stone");
  });

  it("breaks a cost-and-variance tie by block id, for full determinism", () => {
    const b = fakeBlock("stone_bricks", 0, 0);
    const a = fakeBlock("andesite", 0, 0);
    expect(pickInteriorFillBlock([b, a]).blockId).toBe("andesite");
    expect(pickInteriorFillBlock([a, b]).blockId).toBe("andesite");
  });

  it("returns the only candidate when the palette has exactly one", () => {
    const only = fakeBlock("dirt", 0);
    expect(pickInteriorFillBlock([only]).blockId).toBe("dirt");
  });
});
