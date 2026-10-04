import { describe, expect, it } from "vitest";
import type { DecodedTexture } from "../assets/textureDecoder.ts";
import { averageLinearRgb, linearRgbToOklab, rgb8ToLinearRgb, rgb8ToOklab } from "./color.ts";
import { CUBE_FACE_DIRECTIONS, type CubeFaceDirection } from "./faces.ts";
import type { PaletteBlock } from "./palette.ts";
import { hollowBlockCount, solidBlockCount } from "./scale.ts";
import {
  assessReplicaContrastHeadroom,
  buildVoxelGrid,
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

function paletteBlock(blockId: string, rgb: readonly [number, number, number]): PaletteBlock {
  return { blockId, resourceLocation: `minecraft:${blockId}`, color: rgb8ToOklab({ r: rgb[0], g: rgb[1], b: rgb[2] }), textureVariance: 0, costTier: "common", acquisitionCost: 0 };
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

  it("at the default variance weight, prefers a flatter candidate over a noisier one with an exact color match (the stripped-log-collapse scenario)", () => {
    const sourceFaceTextures = uniformFaceTextures(RED);
    const exactButNoisy: PaletteBlock = {
      blockId: "noisy_red_wool",
      resourceLocation: "minecraft:noisy_red_wool",
      color: rgb8ToOklab({ r: RED[0], g: RED[1], b: RED[2] }), // perfect color match
      textureVariance: 0.05, // but a visually busy texture
      costTier: "common",
      acquisitionCost: 0,
    };
    const closeButFlat: PaletteBlock = {
      blockId: "flat_offred_wool",
      resourceLocation: "minecraft:flat_offred_wool",
      color: rgb8ToOklab({ r: 235, g: 20, b: 20 }), // slightly off red, not exact
      textureVariance: 0,
      costTier: "common",
      acquisitionCost: 0,
    };
    const palette = [exactButNoisy, closeButFlat];

    const withVariancePenalty = buildVoxelGrid({ edgeBlocks: 4, fillStyle: "solid-full", sourceFaceTextures, palette });
    expect(withVariancePenalty.every((v) => v.paletteBlock.blockId === "flat_offred_wool")).toBe(true);

    // Explicitly at weight 0, the exact (but noisy) color match wins
    // instead — proving the outcome above really is the variance term
    // at work, not some other difference between the two candidates.
    const pureColorMatch = buildVoxelGrid({
      edgeBlocks: 4,
      fillStyle: "solid-full",
      sourceFaceTextures,
      palette,
      varianceWeight: 0,
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

    const blendedLinear = averageLinearRgb([
      rgb8ToLinearRgb({ r: RED[0], g: RED[1], b: RED[2] }),
      rgb8ToLinearRgb({ r: BLUE[0], g: BLUE[1], b: BLUE[2] }),
    ]);
    const blendBlock: PaletteBlock = {
      blockId: "blend_wool",
      resourceLocation: "minecraft:blend_wool",
      color: linearRgbToOklab(blendedLinear),
      textureVariance: 0,
      costTier: "common",
      acquisitionCost: 0,
    };
    const palette = [...PALETTE, blendBlock];

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
        varianceWeight: 0,
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
        varianceWeight: 0,
        dither: { varianceWeight: 0 },
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
          dither: { varianceWeight: 0 },
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
        costTier: "common",
        acquisitionCost: 0,
      };
      const palette = [...PALETTE, blendBlock];

      const voxels = buildVoxelGrid({
        edgeBlocks: 16,
        fillStyle: "hollow",
        sourceFaceTextures,
        palette,
        dither: { varianceWeight: 0 },
      });
      const voxelAt = new Map(voxels.map((voxel) => [`${voxel.x},${voxel.y},${voxel.z}`, voxel]));
      // Same edge voxel, same expectation as the undithered edge-blend
      // test above — dithering must not change this voxel's outcome.
      expect(voxelAt.get("0,5,0")?.paletteBlock.blockId).toBe("blend_wool");
    });
  });

  describe("contrast preservation (BACKLOG.md 2.1)", () => {
    it("stretches a face's own narrow lightness range so two close source shades land on distinct blocks instead of collapsing onto the same nearest one", () => {
      const darkGray: readonly [number, number, number] = [100, 100, 100];
      const lightGray: readonly [number, number, number] = [130, 130, 130];
      // Every face starts flat darkGray (so the other five faces are a
      // no-op stretch and stay out of this test's way entirely — see
      // this module's own "per face, not shared" reasoning); only "up"
      // gets real internal structure: top half lightGray, bottom half
      // darkGray, a deliberately SUBTLE native difference.
      const sourceFaceTextures = uniformFaceTextures(darkGray);
      sourceFaceTextures.up = verticallyStripedTexture(16, lightGray, darkGray);

      // Spans the full possible range, but is SPARSE near darkGray/
      // lightGray: gray_concrete is the only candidate anywhere close to
      // either one, so without stretching, both shades would nearest-
      // match it alike and the subtle distinction would be lost.
      const wideSparsePalette = [
        paletteBlock("black_concrete", [0, 0, 0]),
        paletteBlock("gray_concrete", [128, 128, 128]),
        paletteBlock("white_concrete", [255, 255, 255]),
      ];

      const voxels = buildVoxelGrid({
        edgeBlocks: 16,
        fillStyle: "hollow",
        sourceFaceTextures,
        palette: wideSparsePalette,
      });
      const voxelAt = new Map(voxels.map((v) => [`${v.x},${v.y},${v.z}`, v]));

      // Up face, (x=8 interior, y=15 governs alone, z selects texture
      // row/v since vAxis=z and vFlip=false for y-faces): z=2 -> v=2,
      // texture's top half -> lightGray; z=13 -> v=13, bottom half ->
      // darkGray. lightGray is the max of its own 2-value face
      // population, so it stretches to EXACTLY the palette's own max
      // (white); darkGray, the min, stretches to exactly the palette's
      // own min (black) — not just "different from each other", but
      // pushed all the way to the two ends of what's available.
      const topVoxel = voxelAt.get("8,15,2");
      const bottomVoxel = voxelAt.get("8,15,13");
      expect(topVoxel?.paletteBlock.blockId).toBe("white_concrete");
      expect(bottomVoxel?.paletteBlock.blockId).toBe("black_concrete");
    });

    it("is a no-op for a face with no internal variation, even when the palette is wide and sparse (nothing to stretch, regardless of what any other face of the same block looks like)", () => {
      const sourceFaceTextures = uniformFaceTextures([100, 100, 100]); // every face flat
      const wideSparsePalette = [
        paletteBlock("black_concrete", [0, 0, 0]),
        paletteBlock("gray_concrete", [128, 128, 128]),
        paletteBlock("white_concrete", [255, 255, 255]),
      ];
      const voxels = buildVoxelGrid({
        edgeBlocks: 8,
        fillStyle: "solid-full",
        sourceFaceTextures,
        palette: wideSparsePalette,
      });
      // A flat [100,100,100] source, unstretched, nearest-matches
      // gray_concrete (128) over black (0) or white (255) — if every
      // voxel agrees on that, nothing dragged this flat texture toward
      // an extreme.
      expect(voxels.every((v) => v.paletteBlock.blockId === "gray_concrete")).toBe(true);
    });
  });
});

describe("assessReplicaContrastHeadroom", () => {
  it("is not palette-limited when the source's own contrast fits inside the palette's reach", () => {
    const sourceFaceTextures = uniformFaceTextures([100, 100, 100]);
    sourceFaceTextures.up = verticallyStripedTexture(16, [130, 130, 130], [100, 100, 100]);
    const palette = [paletteBlock("black_concrete", [0, 0, 0]), paletteBlock("white_concrete", [255, 255, 255])];
    expect(assessReplicaContrastHeadroom(sourceFaceTextures, palette).isPaletteLimited).toBe(false);
  });

  it("is palette-limited when a face's own contrast outstrips every enabled block", () => {
    const sourceFaceTextures = uniformFaceTextures([100, 100, 100]);
    sourceFaceTextures.up = verticallyStripedTexture(16, [255, 255, 255], [0, 0, 0]); // full black-to-white range
    const palette = [paletteBlock("gray_concrete", [120, 120, 120]), paletteBlock("gray_concrete_2", [136, 136, 136])];
    expect(assessReplicaContrastHeadroom(sourceFaceTextures, palette).isPaletteLimited).toBe(true);
  });
});
