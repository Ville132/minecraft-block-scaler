import { describe, expect, it } from "vitest";
import type { DecodedTexture } from "../assets/textureDecoder.ts";
import {
  averageLinearRgb,
  averageOklab,
  linearRgbToOklab,
  oklabDistance,
  rgb8ToLinearRgb,
  rgb8ToOklab,
  type Oklab,
} from "./color.ts";
import { CUBE_FACE_DIRECTIONS, type CubeFaceDirection } from "./faces.ts";
import { uniformAppearanceByFace, type PaletteBlock } from "./palette.ts";
import { hollowBlockCount, solidBlockCount } from "./scale.ts";
import {
  assessReplicaContrastHeadroom,
  buildVoxelGrid,
  candidatesFacing,
  governingFaces,
  isShellVoxel,
  pixelRegionForVoxelCoord,
  positionOnFace,
} from "./shell.ts";

describe("isShellVoxel", () => {
  it("every voxel of a 1-edge or 2-edge cube is on the shell", () => {
    expect(isShellVoxel(0, 0, 0, 1)).toBe(true);
    for (const x of [0, 1]) {
      for (const y of [0, 1]) {
        for (const z of [0, 1]) {
          expect(isShellVoxel(x, y, z, 2)).toBe(true);
        }
      }
    }
  });

  it("the center of a larger cube is not on the shell", () => {
    expect(isShellVoxel(1, 1, 1, 3)).toBe(false);
    expect(isShellVoxel(8, 8, 8, 16)).toBe(false);
  });

  it("any coordinate at 0 or the max index is on the shell", () => {
    expect(isShellVoxel(0, 5, 5, 16)).toBe(true);
    expect(isShellVoxel(15, 5, 5, 16)).toBe(true);
    expect(isShellVoxel(5, 0, 5, 16)).toBe(true);
    expect(isShellVoxel(5, 5, 15, 16)).toBe(true);
  });
});

describe("governingFaces", () => {
  it("a 3-way corner tie resolves to just the Y face — the cap owns every corner too", () => {
    expect(governingFaces(0, 0, 0, 16)).toEqual(["down"]);
    expect(governingFaces(15, 15, 15, 16)).toEqual(["up"]);
  });

  it("a Y/Z edge tie (not touching X) resolves to just the Y face — the cap owns its rim", () => {
    expect(governingFaces(5, 15, 0, 16)).toEqual(["up"]);
  });

  it("a Z/X edge tie (not touching Y) returns BOTH tied side faces, to blend — neither has a principled claim over the other", () => {
    expect(governingFaces(0, 5, 0, 16)).toEqual(["north", "west"]);
  });

  it("an interior voxel still resolves deterministically to a single nearest face", () => {
    // y-boundary-distance 7, z-boundary-distance 1, x-boundary-distance 7 -> Z (north) wins outright, no tie.
    expect(governingFaces(8, 8, 1, 16)).toEqual(["north"]);
  });
});

describe("pixelRegionForVoxelCoord", () => {
  it("up-scale: every voxel in a blocksPerPixel group maps to the same single pixel", () => {
    // edgeBlocks=32, textureSize=16 -> blocksPerPixel=2: voxels {0,1}->pixel0, {2,3}->pixel1, ...
    expect(pixelRegionForVoxelCoord(0, 32, 16)).toEqual({ start: 0, endExclusive: 1 });
    expect(pixelRegionForVoxelCoord(1, 32, 16)).toEqual({ start: 0, endExclusive: 1 });
    expect(pixelRegionForVoxelCoord(2, 32, 16)).toEqual({ start: 1, endExclusive: 2 });
    expect(pixelRegionForVoxelCoord(31, 32, 16)).toEqual({ start: 15, endExclusive: 16 });
  });

  it("up-scale at 1:1 is the identity", () => {
    for (const v of [0, 1, 15]) {
      expect(pixelRegionForVoxelCoord(v, 16, 16)).toEqual({ start: v, endExclusive: v + 1 });
    }
  });

  it("down-scale: each voxel covers a block of several pixels", () => {
    // edgeBlocks=4, textureSize=16 -> pixelsPerBlock=4.
    expect(pixelRegionForVoxelCoord(0, 4, 16)).toEqual({ start: 0, endExclusive: 4 });
    expect(pixelRegionForVoxelCoord(1, 4, 16)).toEqual({ start: 4, endExclusive: 8 });
    expect(pixelRegionForVoxelCoord(3, 4, 16)).toEqual({ start: 12, endExclusive: 16 });
  });

  it("every region is non-empty and in range, across every scale-true size", () => {
    for (const [edgeBlocks, textureSize] of [
      [1, 16],
      [2, 16],
      [8, 16],
      [16, 16],
      [32, 16],
      [64, 16],
    ] as const) {
      for (let v = 0; v < edgeBlocks; v++) {
        const region = pixelRegionForVoxelCoord(v, edgeBlocks, textureSize);
        expect(region.endExclusive).toBeGreaterThan(region.start);
        expect(region.start).toBeGreaterThanOrEqual(0);
        expect(region.endExclusive).toBeLessThanOrEqual(textureSize);
      }
    }
  });

  it("rejects an out-of-range voxel coordinate", () => {
    expect(() => pixelRegionForVoxelCoord(16, 16, 16)).toThrow(RangeError);
    expect(() => pixelRegionForVoxelCoord(-1, 16, 16)).toThrow(RangeError);
  });
});

describe("positionOnFace", () => {
  it("places (u, v) on the correct boundary plane for each direction", () => {
    // v is always y (true vertical) on the four side faces — east/west
    // use u=z (the "around" axis), not u=y, so that a texture's up
    // direction renders consistently on every side (see faceScreenAxes's
    // doc comment for the real-world bug this fixes). On those same four
    // faces v=7 lands at y=8 (16-1-7), not y=7: a decoded PNG's row 0 is
    // its TOP, but world y=0 is the build's BOTTOM, so v must mirror y
    // or every side face renders upside down (faceScreenAxes's doc
    // comment again, the second bug it fixes). down/up have no such
    // flip — v stays z directly on those two.
    expect(positionOnFace("down", 5, 7, 16)).toEqual({ x: 5, y: 0, z: 7 });
    expect(positionOnFace("up", 5, 7, 16)).toEqual({ x: 5, y: 15, z: 7 });
    expect(positionOnFace("north", 5, 7, 16)).toEqual({ x: 5, y: 8, z: 0 });
    expect(positionOnFace("south", 5, 7, 16)).toEqual({ x: 5, y: 8, z: 15 });
    expect(positionOnFace("west", 5, 7, 16)).toEqual({ x: 0, y: 8, z: 5 });
    expect(positionOnFace("east", 5, 7, 16)).toEqual({ x: 15, y: 8, z: 5 });
  });

  it("is always on the shell, for any (u, v)", () => {
    for (const direction of CUBE_FACE_DIRECTIONS) {
      for (const u of [0, 5, 15]) {
        for (const v of [0, 5, 15]) {
          const { x, y, z } = positionOnFace(direction, u, v, 16);
          expect(isShellVoxel(x, y, z, 16)).toBe(true);
        }
      }
    }
  });
});

// --- buildVoxelGrid: synthetic 1x1 solid-color textures per face, and
// a palette of pure primary colors, so each voxel's nearest-match is
// unambiguous and checkable by hand.

function solidTexture(size: number, rgb: readonly [number, number, number]): DecodedTexture {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = rgb[0];
    pixels[i + 1] = rgb[1];
    pixels[i + 2] = rgb[2];
    pixels[i + 3] = 255;
  }
  return { width: size, height: size, pixels };
}

/** Top half `topRgb`, bottom half `bottomRgb` — unlike every uniform texture above, this has real vertical structure, so sampling it along the wrong axis actually changes the result. That's what makes it able to catch a face-orientation bug a solid color cannot. */
function verticallyStripedTexture(
  size: number,
  topRgb: readonly [number, number, number],
  bottomRgb: readonly [number, number, number],
): DecodedTexture {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let row = 0; row < size; row++) {
    const rgb = row < size / 2 ? topRgb : bottomRgb;
    for (let col = 0; col < size; col++) {
      const pixelIndex = (row * size + col) * 4;
      pixels[pixelIndex] = rgb[0];
      pixels[pixelIndex + 1] = rgb[1];
      pixels[pixelIndex + 2] = rgb[2];
      pixels[pixelIndex + 3] = 255;
    }
  }
  return { width: size, height: size, pixels };
}

function paletteBlock(
  blockId: string,
  rgb: readonly [number, number, number],
  textureVariance = 0,
): PaletteBlock {
  return {
    blockId,
    resourceLocation: `minecraft:${blockId}`,
    color: rgb8ToOklab({ r: rgb[0], g: rgb[1], b: rgb[2] }),
    textureVariance,
    appearanceByFace: uniformAppearanceByFace(rgb8ToOklab({ r: rgb[0], g: rgb[1], b: rgb[2] }), textureVariance),
    costTier: "common",
    acquisitionCost: 0,
  };
}

const RED: readonly [number, number, number] = [255, 0, 0];
const GREEN: readonly [number, number, number] = [0, 255, 0];
const BLUE: readonly [number, number, number] = [0, 0, 255];
const PALETTE: PaletteBlock[] = [paletteBlock("red_wool", RED), paletteBlock("green_wool", GREEN)];

function uniformFaceTextures(rgb: readonly [number, number, number], size = 16): Record<CubeFaceDirection, DecodedTexture> {
  const texture = solidTexture(size, rgb);
  const record = {} as Record<CubeFaceDirection, DecodedTexture>;
  for (const direction of CUBE_FACE_DIRECTIONS) record[direction] = texture;
  return record;
}

describe("buildVoxelGrid", () => {
  it("matches the plan's hollow/solid counts at edge 16", () => {
    const sourceFaceTextures = uniformFaceTextures(RED);
    const hollow = buildVoxelGrid({ edgeBlocks: 16, fillStyle: "hollow", sourceFaceTextures, palette: PALETTE });
    const solid = buildVoxelGrid({ edgeBlocks: 16, fillStyle: "solid-full", sourceFaceTextures, palette: PALETTE });
    expect(hollow).toHaveLength(hollowBlockCount(16));
    expect(solid).toHaveLength(solidBlockCount(16));
  });

  it("every hollow voxel lies on the surface", () => {
    const sourceFaceTextures = uniformFaceTextures(RED);
    const hollow = buildVoxelGrid({ edgeBlocks: 16, fillStyle: "hollow", sourceFaceTextures, palette: PALETTE });
    for (const voxel of hollow) {
      expect(isShellVoxel(voxel.x, voxel.y, voxel.z, 16)).toBe(true);
    }
  });

  it("solid fill has no gaps: every (x,y,z) in range appears exactly once", () => {
    const sourceFaceTextures = uniformFaceTextures(RED);
    const solid = buildVoxelGrid({ edgeBlocks: 4, fillStyle: "solid-full", sourceFaceTextures, palette: PALETTE });
    const seen = new Set(solid.map((v) => `${v.x},${v.y},${v.z}`));
    expect(seen.size).toBe(solid.length);
    for (let x = 0; x < 4; x++) {
      for (let y = 0; y < 4; y++) {
        for (let z = 0; z < 4; z++) {
          expect(seen.has(`${x},${y},${z}`)).toBe(true);
        }
      }
    }
  });

  it("picks the nearest palette color uniformly when the source is a single solid color", () => {
    const sourceFaceTextures = uniformFaceTextures(RED);
    const voxels = buildVoxelGrid({ edgeBlocks: 8, fillStyle: "solid-full", sourceFaceTextures, palette: PALETTE });
    expect(voxels.every((v) => v.paletteBlock.blockId === "red_wool")).toBe(true);
  });

  it("at the default color tolerance, prefers a flatter candidate over a noisier one whose color is only imperceptibly better (the stripped-log-collapse scenario)", () => {
    const sourceFaceTextures = uniformFaceTextures(RED);
    const exactButNoisy: PaletteBlock = {
      blockId: "noisy_red_wool",
      resourceLocation: "minecraft:noisy_red_wool",
      color: rgb8ToOklab({ r: RED[0], g: RED[1], b: RED[2] }), // perfect color match
      textureVariance: 0.05, // but a visually busy texture
      appearanceByFace: uniformAppearanceByFace(rgb8ToOklab({ r: RED[0], g: RED[1], b: RED[2] }), 0.05),
      costTier: "common",
      acquisitionCost: 0,
    };
    const closeButFlat: PaletteBlock = {
      blockId: "flat_offred_wool",
      resourceLocation: "minecraft:flat_offred_wool",
      // Slightly off red, not exact — 0.0095 Oklab from pure red, safely
      // inside the default 0.02 tolerance band. (The earlier (235,20,20)
      // was 0.0386 away: a visibly worse color, which the tolerance band
      // now correctly refuses to trade for a flatter texture.)
      color: rgb8ToOklab({ r: 250, g: 8, b: 8 }),
      textureVariance: 0,
      appearanceByFace: uniformAppearanceByFace(rgb8ToOklab({ r: 250, g: 8, b: 8 }), 0),
      costTier: "common",
      acquisitionCost: 0,
    };
    const palette = [exactButNoisy, closeButFlat];

    const withDefaultTolerance = buildVoxelGrid({ edgeBlocks: 4, fillStyle: "solid-full", sourceFaceTextures, palette });
    expect(withDefaultTolerance.every((v) => v.paletteBlock.blockId === "flat_offred_wool")).toBe(true);

    // Explicitly at tolerance 0, the exact (but noisy) color match wins
    // instead — proving the outcome above really is the texture
    // tie-break at work, not some other difference between the two
    // candidates.
    const pureColorMatch = buildVoxelGrid({
      edgeBlocks: 4,
      fillStyle: "solid-full",
      sourceFaceTextures,
      palette,
      colorTolerance: 0,
    });
    expect(pureColorMatch.every((v) => v.paletteBlock.blockId === "noisy_red_wool")).toBe(true);
  });

  it("samples different faces independently when their source textures differ", () => {
    const sourceFaceTextures = uniformFaceTextures(RED);
    sourceFaceTextures.up = solidTexture(16, GREEN);
    const voxels = buildVoxelGrid({ edgeBlocks: 16, fillStyle: "hollow", sourceFaceTextures, palette: PALETTE });
    const topVoxel = voxels.find((v) => v.y === 15 && v.x === 8 && v.z === 8);
    const sideVoxel = voxels.find((v) => v.x === 15 && v.y === 8 && v.z === 8);
    expect(topVoxel?.paletteBlock.blockId).toBe("green_wool");
    expect(sideVoxel?.paletteBlock.blockId).toBe("red_wool");
  });

  it("keeps a texture's vertical structure consistent on every side face (regression: east/west used to sample along z instead of y, rotating the texture 90° on those two faces — invisible with a uniform color, which is every fixture above this one)", () => {
    const sourceFaceTextures = uniformFaceTextures(RED);
    const topHalfGreenBottomHalfRed = verticallyStripedTexture(16, GREEN, RED);
    for (const direction of ["north", "south", "east", "west"] as const) {
      sourceFaceTextures[direction] = topHalfGreenBottomHalfRed;
    }

    const voxels = buildVoxelGrid({ edgeBlocks: 16, fillStyle: "hollow", sourceFaceTextures, palette: PALETTE });
    const voxelAt = new Map(voxels.map((voxel) => [`${voxel.x},${voxel.y},${voxel.z}`, voxel]));

    // High y (build top, texture's top half) -> green; low y (build
    // bottom, texture's bottom half) -> red — on all four side faces
    // alike, including east/west, which is exactly what the original
    // rotation bug broke (it would have read red_wool at (15,2,8) and
    // green_wool at (15,13,8): the opposite of these).
    //
    // (These expectations are also where the separate vertical-flip fix
    // in faceScreenAxes shows up: a decoded PNG's row 0 is its own top,
    // but world y=0 is the build's BOTTOM, so low y correctly shows the
    // texture's BOTTOM half here, not its top — the reverse of what an
    // earlier version of this same test asserted, back when that second
    // bug was still present and unnoticed.)
    for (const [x, y, z, expectedBlockId] of [
      [8, 13, 0, "green_wool"],
      [8, 2, 0, "red_wool"],
      [8, 13, 15, "green_wool"],
      [8, 2, 15, "red_wool"],
      [15, 13, 8, "green_wool"],
      [15, 2, 8, "red_wool"],
      [0, 13, 8, "green_wool"],
      [0, 2, 8, "red_wool"],
    ] as const) {
      const voxel = voxelAt.get(`${x},${y},${z}`);
      expect(voxel?.paletteBlock.blockId, `at (${x},${y},${z})`).toBe(expectedBlockId);
    }
  });

  it("blends two side faces at a side-to-side edge, but still lets Y win outright (no blend) at a Y edge — the cap keeps owning its rim", () => {
    const sourceFaceTextures = uniformFaceTextures(RED); // up stays RED too
    sourceFaceTextures.north = solidTexture(16, RED);
    sourceFaceTextures.west = solidTexture(16, BLUE);

    // Two candidates sitting at the two different "averages" of red and
    // blue. Oklab's nonlinearity puts them in different places, so whichever
    // one wins reveals which space the production blend actually uses — and
    // the answer must be Oklab, to match the space candidate colours live in.
    const redOklab = rgb8ToOklab({ r: RED[0], g: RED[1], b: RED[2] });
    const blueOklab = rgb8ToOklab({ r: BLUE[0], g: BLUE[1], b: BLUE[2] });
    const oklabBlend = averageOklab([redOklab, blueOklab]);
    const linearBlend = linearRgbToOklab(
      averageLinearRgb([
        rgb8ToLinearRgb({ r: RED[0], g: RED[1], b: RED[2] }),
        rgb8ToLinearRgb({ r: BLUE[0], g: BLUE[1], b: BLUE[2] }),
      ]),
    );
    expect(oklabDistance(oklabBlend, linearBlend), "the two averages must differ for this test to mean anything").
      toBeGreaterThan(0.01);

    const named = (blockId: string, color: Oklab): PaletteBlock => ({
      blockId,
      resourceLocation: `minecraft:${blockId}`,
      color,
      textureVariance: 0,
      appearanceByFace: uniformAppearanceByFace(color, 0),
      costTier: "common",
      acquisitionCost: 0,
    });
    // Listed with the linear one FIRST, so it would win any tie — it loses
    // on distance alone.
    const palette = [...PALETTE, named("linear_blend_wool", linearBlend), named("blend_wool", oklabBlend)];

    const voxels = buildVoxelGrid({ edgeBlocks: 16, fillStyle: "hollow", sourceFaceTextures, palette });
    const voxelAt = new Map(voxels.map((voxel) => [`${voxel.x},${voxel.y},${voxel.z}`, voxel]));

    // (0, 5, 0): x=0 and z=0 both boundary, y=5 interior — a genuine
    // side-to-side (west meets north) edge: RED blended with BLUE.
    expect(voxelAt.get("0,5,0")?.paletteBlock.blockId).toBe("blend_wool");

    // (5, 15, 0): y=15 AND z=0 are both boundary too, but Y must still
    // win outright — up is RED, exactly matching north's own RED, not
    // blend_wool, proving the cap overrides rather than blends here.
    expect(voxelAt.get("5,15,0")?.paletteBlock.blockId).toBe("red_wool");

    // Sanity: an ordinary flat position on north alone is unaffected.
    expect(voxelAt.get("8,8,0")?.paletteBlock.blockId).toBe("red_wool");
  });

  it("rejects an empty palette", () => {
    const sourceFaceTextures = uniformFaceTextures(RED);
    expect(() => buildVoxelGrid({ edgeBlocks: 4, fillStyle: "solid-full", sourceFaceTextures, palette: [] })).toThrow(
      RangeError,
    );
  });

  it("rejects a non-square source face texture as an internal invariant violation", () => {
    const sourceFaceTextures = uniformFaceTextures(RED);
    sourceFaceTextures.up = { width: 16, height: 32, pixels: new Uint8ClampedArray(16 * 32 * 4) };
    expect(() => buildVoxelGrid({ edgeBlocks: 4, fillStyle: "solid-full", sourceFaceTextures, palette: PALETTE })).toThrow();
  });

  it("rejects a non-positive edgeBlocks", () => {
    const sourceFaceTextures = uniformFaceTextures(RED);
    expect(() => buildVoxelGrid({ edgeBlocks: 0, fillStyle: "solid-full", sourceFaceTextures, palette: PALETTE })).toThrow(
      RangeError,
    );
  });

  describe("solid-cheap-core fill style", () => {
    it("fills every interior voxel with interiorFillBlock, leaving the shell individually color-matched as usual", () => {
      const sourceFaceTextures = uniformFaceTextures(RED);
      sourceFaceTextures.up = solidTexture(16, GREEN); // so the shell isn't uniformly red_wool either
      const coreBlock = paletteBlock("cheap_core_stone", [128, 128, 128]);
      const voxels = buildVoxelGrid({
        edgeBlocks: 4,
        fillStyle: "solid-cheap-core",
        sourceFaceTextures,
        palette: PALETTE,
        interiorFillBlock: coreBlock,
      });

      expect(voxels).toHaveLength(solidBlockCount(4));
      for (const voxel of voxels) {
        if (isShellVoxel(voxel.x, voxel.y, voxel.z, 4)) {
          // Shell voxels are still color-matched, same as any other fill style.
          expect(voxel.paletteBlock.blockId).not.toBe("cheap_core_stone");
        } else {
          expect(voxel.paletteBlock.blockId).toBe("cheap_core_stone");
        }
      }
    });

    it("rejects a missing interiorFillBlock instead of silently falling back to color-matching", () => {
      const sourceFaceTextures = uniformFaceTextures(RED);
      expect(() =>
        buildVoxelGrid({ edgeBlocks: 4, fillStyle: "solid-cheap-core", sourceFaceTextures, palette: PALETTE }),
      ).toThrow(RangeError);
    });

    it("ignores an interiorFillBlock supplied for hollow or solid-full (no interior to use it on, or the interior is matched like everything else)", () => {
      const sourceFaceTextures = uniformFaceTextures(RED);
      const coreBlock = paletteBlock("cheap_core_stone", [128, 128, 128]);
      const hollow = buildVoxelGrid({
        edgeBlocks: 4,
        fillStyle: "hollow",
        sourceFaceTextures,
        palette: PALETTE,
        interiorFillBlock: coreBlock,
      });
      expect(hollow.some((v) => v.paletteBlock.blockId === "cheap_core_stone")).toBe(false);

      const solidFull = buildVoxelGrid({
        edgeBlocks: 4,
        fillStyle: "solid-full",
        sourceFaceTextures,
        palette: PALETTE,
        interiorFillBlock: coreBlock,
      });
      expect(solidFull.every((v) => v.paletteBlock.blockId === "red_wool")).toBe(true);
    });
  });

  describe("dither option", () => {
    const BLACK: readonly [number, number, number] = [0, 0, 0];
    const WHITE: readonly [number, number, number] = [255, 255, 255];
    const blackWhitePalette = [paletteBlock("black_wool", BLACK), paletteBlock("white_wool", WHITE)];

    it("is off by default: a uniform mid-gray face resolves to one single block, not a mix", () => {
      const sourceFaceTextures = uniformFaceTextures(RED);
      sourceFaceTextures.up = solidTexture(16, [140, 140, 140]);
      const voxels = buildVoxelGrid({
        edgeBlocks: 16,
        fillStyle: "hollow",
        sourceFaceTextures,
        palette: blackWhitePalette,
        colorTolerance: 0,
      });
      const upBlockIds = new Set(voxels.filter((v) => v.y === 15).map((v) => v.paletteBlock.blockId));
      expect(upBlockIds.size).toBe(1);
    });

    it("once enabled, turns that same uniform mid-gray face into a mix of both candidates (the whole point of error diffusion: the AREA average converges on the target even though neither candidate alone matches it)", () => {
      const sourceFaceTextures = uniformFaceTextures(RED);
      sourceFaceTextures.up = solidTexture(16, [140, 140, 140]);
      const voxels = buildVoxelGrid({
        edgeBlocks: 16,
        fillStyle: "hollow",
        sourceFaceTextures,
        palette: blackWhitePalette,
        colorTolerance: 0,
        dither: true,
      });
      const upBlockIds = new Set(voxels.filter((v) => v.y === 15).map((v) => v.paletteBlock.blockId));
      expect(upBlockIds.size).toBe(2);
    });

    it("is fully deterministic: building the same dithered face twice gives byte-identical results", () => {
      const sourceFaceTextures = uniformFaceTextures(RED);
      sourceFaceTextures.up = solidTexture(16, [140, 140, 140]);
      const build = () =>
        buildVoxelGrid({
          edgeBlocks: 16,
          fillStyle: "hollow",
          sourceFaceTextures,
          palette: blackWhitePalette,
          dither: true,
        }).map((v) => `${v.x},${v.y},${v.z}:${v.paletteBlock.blockId}`);
      expect(build()).toEqual(build());
    });

    it("leaves a side-to-side edge voxel on the plain blended path even when dithering is on, exactly as it would with dithering off (edges stay one voxel wide and position-independent, not pulled into the per-face dithered grid)", () => {
      const sourceFaceTextures = uniformFaceTextures(RED);
      sourceFaceTextures.north = solidTexture(16, RED);
      sourceFaceTextures.west = solidTexture(16, BLUE);
      const blendedLinear = averageLinearRgb([
        rgb8ToLinearRgb({ r: RED[0], g: RED[1], b: RED[2] }),
        rgb8ToLinearRgb({ r: BLUE[0], g: BLUE[1], b: BLUE[2] }),
      ]);
      const blendBlock: PaletteBlock = {
        blockId: "blend_wool",
        resourceLocation: "minecraft:blend_wool",
        color: linearRgbToOklab(blendedLinear),
        textureVariance: 0,
        appearanceByFace: uniformAppearanceByFace(linearRgbToOklab(blendedLinear), 0),
        costTier: "common",
        acquisitionCost: 0,
      };
      const palette = [...PALETTE, blendBlock];

      const voxels = buildVoxelGrid({
        edgeBlocks: 16,
        fillStyle: "hollow",
        sourceFaceTextures,
        palette,
        dither: true,
      });
      const voxelAt = new Map(voxels.map((voxel) => [`${voxel.x},${voxel.y},${voxel.z}`, voxel]));
      // Same edge voxel, same expectation as the undithered edge-blend
      // test above — dithering must not change this voxel's outcome.
      expect(voxelAt.get("0,5,0")?.paletteBlock.blockId).toBe("blend_wool");
    });
  });

  describe("contrast enhancement (opt-in contrastGain)", () => {
    const darkGray: readonly [number, number, number] = [100, 100, 100];
    const lightGray: readonly [number, number, number] = [130, 130, 130];
    // Graduated grays all the way out to black and white — exactly the
    // palette the old full-range stretch needed in order to misbehave, and
    // fine-grained enough near the source's own shades for a modest gain
    // to have somewhere to land that is not an extreme.
    const GRAY_STEPS = [0, 64, 80, 100, 115, 130, 145, 165, 190, 255];
    const gradedGrayPalette = GRAY_STEPS.map((value) => paletteBlock(`gray_${value}`, [value, value, value]));

    /** A face with a subtle (100-vs-130) pattern; every other face flat dark gray. */
    function subtlePatternSource(): Record<CubeFaceDirection, DecodedTexture> {
      const sourceFaceTextures = uniformFaceTextures(darkGray);
      sourceFaceTextures.up = verticallyStripedTexture(16, lightGray, darkGray);
      return sourceFaceTextures;
    }

    function resolveSubtlePattern(contrastGain?: number) {
      const voxels = buildVoxelGrid({
        edgeBlocks: 16,
        fillStyle: "hollow",
        sourceFaceTextures: subtlePatternSource(),
        palette: gradedGrayPalette,
        ...(contrastGain !== undefined && { contrastGain }),
      });
      const blockIdAt = new Map(voxels.map((voxel) => [`${voxel.x},${voxel.y},${voxel.z}`, voxel.paletteBlock.blockId]));
      // Up face, x=8 interior, y=15 governs alone; z=2 reads texture row 2
      // (top half = lightGray), z=13 reads row 13 (bottom half = darkGray).
      return { lightShade: blockIdAt.get("8,15,2"), darkShade: blockIdAt.get("8,15,13"), used: distinctBlockIds(voxels) };
    }

    it("by default leaves a subtle 100-vs-130 gray pattern at its TRUE colors — each shade resolves to the gray it actually is, never to the palette's extremes", () => {
      // This is the same fixture an earlier version pinned with the OPPOSITE
      // expectation: it asserted these two shades land on white_concrete and
      // black_concrete, calling that "pushed all the way to the two ends of
      // what's available". That was the bug, written down as a requirement.
      const resolved = resolveSubtlePattern();
      expect(resolved.lightShade).toBe("gray_130");
      expect(resolved.darkShade).toBe("gray_100");
      expect(resolved.used).not.toContain("gray_0");
      expect(resolved.used).not.toContain("gray_255");
    });

    it("an explicit contrastGain pushes the two shades further apart around their own average — without sending either to the palette's extremes", () => {
      const boosted = resolveSubtlePattern(2);
      expect(boosted.lightShade).toBe("gray_145"); // lighter than its true gray_130
      expect(boosted.darkShade).toBe("gray_80"); // darker than its true gray_100
      expect(boosted.used).not.toContain("gray_0");
      expect(boosted.used).not.toContain("gray_255");
    });

    it("contrastGain 1 is exactly the same as passing none (a true no-op)", () => {
      const sourceFaceTextures = subtlePatternSource();
      const build = (extra: { contrastGain?: number }) =>
        buildVoxelGrid({ edgeBlocks: 16, fillStyle: "hollow", sourceFaceTextures, palette: gradedGrayPalette, ...extra });
      expect(build({ contrastGain: 1 })).toEqual(build({}));
    });

    it("leaves a face with no internal variation unchanged at any gain (a flat face has no deviation from its own mean to amplify)", () => {
      const sourceFaceTextures = uniformFaceTextures(darkGray); // every face flat
      const build = (contrastGain: number) =>
        buildVoxelGrid({ edgeBlocks: 8, fillStyle: "solid-full", sourceFaceTextures, palette: gradedGrayPalette, contrastGain });
      expect(distinctBlockIds(build(2))).toEqual(["gray_100"]);
      expect(distinctBlockIds(build(1))).toEqual(["gray_100"]);
    });

    it("rejects a gain below 1 or non-finite instead of silently accepting it", () => {
      const sourceFaceTextures = uniformFaceTextures(darkGray);
      for (const contrastGain of [0, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() =>
          buildVoxelGrid({ edgeBlocks: 4, fillStyle: "hollow", sourceFaceTextures, palette: gradedGrayPalette, contrastGain }),
        ).toThrow(RangeError);
      }
    });
  });
});

// --- Absolute color fidelity ------------------------------------------
//
// Regression for BACKLOG-COLOR-FIX.md: a giant acacia_log (bright orange
// top) came out in white/pale blocks, and a dark-brown mangrove_log came
// out with white in it. Every fixture above this point is either a pure
// primary (where the palette is built from the SAME primaries as the
// source, so the old full-range lightness stretch happened to be an
// identity) or pure grayscale (no hue to destroy) — so none of them could
// ever have caught it. These use a SATURATED, NARROW-lightness-range
// texture against a palette that holds both same-hue blocks AND the
// near-neutral blocks (quartz, black concrete) that sit at the extremes of
// any real palette's lightness range: exactly the combination that broke.

/** Real-ish sRGB colors and texture variances for the orange/brown wood family. */
const WOOD_BLOCK_FIXTURES: readonly (readonly [string, readonly [number, number, number], number])[] = [
  ["acacia_planks", [169, 92, 51], 0.003],
  ["stripped_acacia_log", [174, 98, 56], 0.0015],
  ["orange_terracotta", [161, 83, 37], 0.0008],
  ["mangrove_planks", [117, 54, 48], 0.003],
  ["dark_oak_planks", [66, 43, 20], 0.0025],
];

/** The near-neutral blocks at the two ends of any real palette's lightness range. They are the ONLY blocks a lightness-range remap can land on, which is why they are what the old stretch produced. */
const NEUTRAL_EXTREME_FIXTURES: readonly (readonly [string, readonly [number, number, number], number])[] = [
  ["quartz_block", [236, 231, 225], 0.0003],
  ["black_concrete", [8, 10, 15], 0.00005],
];

function paletteFromFixtures(
  fixtures: readonly (readonly [string, readonly [number, number, number], number])[],
): PaletteBlock[] {
  return fixtures.map(([blockId, rgb, variance]) => paletteBlock(blockId, rgb, variance));
}

const ORANGE_FAMILY = ["acacia_planks", "stripped_acacia_log", "orange_terracotta"];
const BROWN_FAMILY = ["mangrove_planks", "dark_oak_planks"];

/** Every face flat `flatRgb` except `up`, which carries real (narrow, saturated) internal contrast — so the interesting face can't be confused with anything else in the build. */
function narrowSaturatedSource(
  flatRgb: readonly [number, number, number],
  upLightRgb: readonly [number, number, number],
  upDarkRgb: readonly [number, number, number],
): Record<CubeFaceDirection, DecodedTexture> {
  const sourceFaceTextures = uniformFaceTextures(flatRgb);
  sourceFaceTextures.up = verticallyStripedTexture(16, upLightRgb, upDarkRgb);
  return sourceFaceTextures;
}

function distinctBlockIds(voxels: readonly { readonly paletteBlock: PaletteBlock }[]): string[] {
  return [...new Set(voxels.map((voxel) => voxel.paletteBlock.blockId))].sort();
}

/** A log-shaped candidate: one colour on the caps, a different one on the four sides — the shape `uniformAppearanceByFace` deliberately cannot express. */
function pillarBlock(
  blockId: string,
  sideRgb: readonly [number, number, number],
  capRgb: readonly [number, number, number],
): PaletteBlock {
  const side = { color: rgb8ToOklab({ r: sideRgb[0], g: sideRgb[1], b: sideRgb[2] }), variance: 0 };
  const cap = { color: rgb8ToOklab({ r: capRgb[0], g: capRgb[1], b: capRgb[2] }), variance: 0 };
  return {
    blockId,
    resourceLocation: `minecraft:${blockId}`,
    // The whole-block blend, exactly as `representativeAppearance` computes
    // it — the colour that used to be the ONLY thing the matcher could see.
    color: averageOklab([side.color, cap.color]),
    textureVariance: 0,
    appearanceByFace: { up: cap, down: cap, north: side, south: side, east: side, west: side },
    costTier: "common",
    acquisitionCost: 0,
  };
}

describe("per-face colour matching (a block is matched by the face it actually shows)", () => {
  // A log whose bark and end grain are far apart: its blended colour is a
  // muddy brown that appears on neither face. Before per-face matching, that
  // blend was the only colour the matcher could compare against — for a real
  // oak_log it sits 0.138 Oklab from both faces, seven times the whole
  // matching tolerance.
  const BARK: readonly [number, number, number] = [96, 72, 40];
  const END_GRAIN: readonly [number, number, number] = [198, 168, 108];
  const logPalette = [
    pillarBlock("oak_log", BARK, END_GRAIN),
    paletteBlock("bark_lookalike", BARK),
    paletteBlock("grain_lookalike", END_GRAIN),
  ];

  /** The block chosen at the centre of each face, away from any edge voxel. */
  function centreOfEachFace(sourceFaceTextures: Record<CubeFaceDirection, DecodedTexture>) {
    const voxels = buildVoxelGrid({ edgeBlocks: 16, fillStyle: "hollow", sourceFaceTextures, palette: logPalette });
    const blockIdAt = new Map(voxels.map((voxel) => [`${voxel.x},${voxel.y},${voxel.z}`, voxel.paletteBlock.blockId]));
    return { up: blockIdAt.get("8,15,8"), north: blockIdAt.get("8,8,0") };
  }

  it("lets one log serve two different colours: its cap on the top face, its bark on a side", () => {
    // The log is listed first, so it wins each face only by matching it
    // exactly — which it can only do if the candidate offers a different
    // colour per face. Its blended colour matches neither.
    const sourceFaceTextures = uniformFaceTextures(BARK);
    sourceFaceTextures.up = solidTexture(16, END_GRAIN);
    const resolved = centreOfEachFace(sourceFaceTextures);
    expect(resolved.up).toBe("oak_log");
    expect(resolved.north).toBe("oak_log");
  });

  it("will not use a log on a face whose colour is on the log's OTHER face", () => {
    // The sharp case. The top face wants bark colour, but a normally-placed
    // log shows end grain there — so the log must lose to a block that
    // really is that colour on top. Matching the blended colour could never
    // make this distinction: it is the same number on every face.
    const sourceFaceTextures = uniformFaceTextures(BARK);
    const resolved = centreOfEachFace(sourceFaceTextures);
    expect(resolved.up).toBe("bark_lookalike");
    expect(resolved.north).toBe("oak_log");
  });

  it("offers the same block a different colour on a side than on the cap", () => {
    // One block, two faces, two colours: the up face wants the cap and the
    // side wants the bark, and a single blended colour can serve neither.
    const sideCandidates = candidatesFacing(logPalette, ["north"]);
    const capCandidates = candidatesFacing(logPalette, ["up"]);
    const logSide = sideCandidates.find((c) => c.item.blockId === "oak_log")!;
    const logCap = capCandidates.find((c) => c.item.blockId === "oak_log")!;

    expect(oklabDistance(logSide.color, rgb8ToOklab({ r: BARK[0], g: BARK[1], b: BARK[2] }))).toBeCloseTo(0, 12);
    expect(oklabDistance(logCap.color, rgb8ToOklab({ r: END_GRAIN[0], g: END_GRAIN[1], b: END_GRAIN[2] }))).toBeCloseTo(
      0,
      12,
    );
    // And the old single colour was genuinely far from both.
    const blend = averageOklab([logSide.color, logCap.color]);
    expect(oklabDistance(blend, logSide.color)).toBeGreaterThan(0.05);
    expect(oklabDistance(blend, logCap.color)).toBeGreaterThan(0.05);
  });

  it("scores a flat face as flat, instead of inflating it by the gap to the other face", () => {
    // Measured around the block's blend, this log's perfectly flat bark
    // scored ~0.003 of variance — thousands of `color.ts` flatness steps —
    // and lost the matcher's flatness tie-break to any single-texture block.
    const logSide = candidatesFacing(logPalette, ["north"]).find((c) => c.item.blockId === "oak_log")!;
    expect(logSide.variance).toBe(0);
  });
});

describe("absolute color fidelity (a texture's hue is never traded for lightness)", () => {
  const fullPalette = paletteFromFixtures([...WOOD_BLOCK_FIXTURES, ...NEUTRAL_EXTREME_FIXTURES]);

  it("a saturated, narrow-range ORANGE face resolves to orange-family blocks — never to the palette's pale or near-black extremes", () => {
    // acacia_log's top: two close shades of the same bright orange.
    const sourceFaceTextures = narrowSaturatedSource([169, 92, 51], [186, 101, 52], [150, 76, 40]);
    const voxels = buildVoxelGrid({ edgeBlocks: 16, fillStyle: "hollow", sourceFaceTextures, palette: fullPalette });

    const used = distinctBlockIds(voxels);
    expect(used).not.toContain("quartz_block");
    expect(used).not.toContain("black_concrete");
    for (const blockId of used) expect(ORANGE_FAMILY, `unexpected block '${blockId}'`).toContain(blockId);
  });

  it("a saturated, narrow-range DARK BROWN face resolves to brown-family blocks — never white (the reported mangrove_log failure)", () => {
    // mangrove_log: two close shades of dark red-brown.
    const sourceFaceTextures = narrowSaturatedSource([102, 58, 51], [110, 62, 54], [78, 43, 37]);
    const voxels = buildVoxelGrid({ edgeBlocks: 16, fillStyle: "hollow", sourceFaceTextures, palette: fullPalette });

    const used = distinctBlockIds(voxels);
    expect(used).not.toContain("quartz_block");
    expect(used).not.toContain("black_concrete");
    for (const blockId of used) expect(BROWN_FAMILY, `unexpected block '${blockId}'`).toContain(blockId);
  });

  it("matching is absolute, not palette-relative: adding blocks to the palette never changes which block a voxel that didn't pick them resolves to", () => {
    // The cleanest statement of what the old full-range stretch violated.
    // quartz_block/black_concrete are never the nearest block to any of
    // these orange/brown pixels, so including them must change NOTHING —
    // but under the old design they moved the palette's lightness range,
    // which moved every single target. Any reintroduction of palette-range
    // normalisation, in any form, fails this immediately.
    const sourceFaceTextures = narrowSaturatedSource([169, 92, 51], [186, 101, 52], [150, 76, 40]);
    sourceFaceTextures.north = verticallyStripedTexture(16, [110, 62, 54], [78, 43, 37]);
    sourceFaceTextures.south = verticallyStripedTexture(16, [118, 66, 57], [102, 58, 51]);

    const woodOnly = buildVoxelGrid({
      edgeBlocks: 16,
      fillStyle: "hollow",
      sourceFaceTextures,
      palette: paletteFromFixtures(WOOD_BLOCK_FIXTURES),
    });
    const woodPlusNeutrals = buildVoxelGrid({ edgeBlocks: 16, fillStyle: "hollow", sourceFaceTextures, palette: fullPalette });

    const blockIdByPosition = (voxels: readonly { x: number; y: number; z: number; paletteBlock: PaletteBlock }[]) =>
      new Map(voxels.map((voxel) => [`${voxel.x},${voxel.y},${voxel.z}`, voxel.paletteBlock.blockId]));
    expect(blockIdByPosition(woodPlusNeutrals)).toEqual(blockIdByPosition(woodOnly));
  });

  it("even with contrast boost on, an orange face never reaches the palette's pale or near-black extremes (the old stretch did, at any setting)", () => {
    const sourceFaceTextures = narrowSaturatedSource([169, 92, 51], [186, 101, 52], [150, 76, 40]);
    for (const contrastGain of [1.5, 2]) {
      const voxels = buildVoxelGrid({ edgeBlocks: 16, fillStyle: "hollow", sourceFaceTextures, palette: fullPalette, contrastGain });
      const used = distinctBlockIds(voxels);
      expect(used, `gain ${contrastGain}`).not.toContain("quartz_block");
      expect(used, `gain ${contrastGain}`).not.toContain("black_concrete");
    }
  });

  it("the dithered path resolves to the same colors: an orange face stays orange under dithering, with or without contrast boost", () => {
    // Dithering shares the matcher AND the contrast targets with the
    // undithered path (see buildDitheredFaceGrid), so it must obey the
    // same invariant — a regression here would mean the two drifted.
    const sourceFaceTextures = narrowSaturatedSource([169, 92, 51], [186, 101, 52], [150, 76, 40]);
    for (const extra of [{}, { contrastGain: 2 }]) {
      const voxels = buildVoxelGrid({
        edgeBlocks: 16,
        fillStyle: "hollow",
        sourceFaceTextures,
        palette: fullPalette,
        dither: true,
        ...extra,
      });
      const used = distinctBlockIds(voxels);
      expect(used, JSON.stringify(extra)).not.toContain("quartz_block");
      expect(used, JSON.stringify(extra)).not.toContain("black_concrete");
    }
  });
});

describe("assessReplicaContrastHeadroom", () => {
  it("flags a block with a faint light/dark pattern on some face — what contrast enhancement is for", () => {
    // acacia_log's end grain: two close shades of one orange; every other
    // face perfectly flat (and so skipped — there is nothing to amplify).
    const sourceFaceTextures = narrowSaturatedSource([169, 92, 51], [186, 101, 52], [150, 76, 40]);
    const headroom = assessReplicaContrastHeadroom(sourceFaceTextures);
    expect(headroom.isLowContrast).toBe(true);
    expect(headroom.faintestPatternSpan).toBeGreaterThan(0.05);
    expect(headroom.faintestPatternSpan).toBeLessThan(0.12);
  });

  it("does not flag a block whose patterned face has strong internal contrast", () => {
    const sourceFaceTextures = uniformFaceTextures([100, 100, 100]);
    sourceFaceTextures.up = verticallyStripedTexture(16, [255, 255, 255], [0, 0, 0]); // full black-to-white range
    expect(assessReplicaContrastHeadroom(sourceFaceTextures).isLowContrast).toBe(false);
  });

  it("does not flag a perfectly flat block: there is nothing for contrast enhancement to amplify", () => {
    expect(assessReplicaContrastHeadroom(uniformFaceTextures([100, 100, 100]))).toEqual({
      faintestPatternSpan: null,
      isLowContrast: false,
    });
  });
});
