import { describe, expect, it } from "vitest";
import type { DecodedTexture } from "../assets/textureDecoder.ts";
import { averageLinearRgb, linearRgbToOklab, rgb8ToLinearRgb, rgb8ToOklab } from "./color.ts";
import { CUBE_FACE_DIRECTIONS, type CubeFaceDirection } from "./faces.ts";
import type { PaletteBlock } from "./palette.ts";
import { hollowBlockCount, solidBlockCount } from "./scale.ts";
import { buildVoxelGrid, governingFaces, isShellVoxel, pixelRegionForVoxelCoord, positionOnFace } from "./shell.ts";

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
    // doc comment for the real-world bug this fixes).
    expect(positionOnFace("down", 5, 7, 16)).toEqual({ x: 5, y: 0, z: 7 });
    expect(positionOnFace("up", 5, 7, 16)).toEqual({ x: 5, y: 15, z: 7 });
    expect(positionOnFace("north", 5, 7, 16)).toEqual({ x: 5, y: 7, z: 0 });
    expect(positionOnFace("south", 5, 7, 16)).toEqual({ x: 5, y: 7, z: 15 });
    expect(positionOnFace("west", 5, 7, 16)).toEqual({ x: 0, y: 7, z: 5 });
    expect(positionOnFace("east", 5, 7, 16)).toEqual({ x: 15, y: 7, z: 5 });
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
  return { blockId, resourceLocation: `minecraft:${blockId}`, color: rgb8ToOklab({ r: rgb[0], g: rgb[1], b: rgb[2] }), costTier: "common" };
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
    const solid = buildVoxelGrid({ edgeBlocks: 16, fillStyle: "solid", sourceFaceTextures, palette: PALETTE });
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
    const solid = buildVoxelGrid({ edgeBlocks: 4, fillStyle: "solid", sourceFaceTextures, palette: PALETTE });
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
    const voxels = buildVoxelGrid({ edgeBlocks: 8, fillStyle: "solid", sourceFaceTextures, palette: PALETTE });
    expect(voxels.every((v) => v.paletteBlock.blockId === "red_wool")).toBe(true);
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

    // Low y (texture's top half) -> green; high y (bottom half) -> red —
    // on all four side faces alike, including east/west, which is
    // exactly what the bug broke (it would have read red_wool at
    // (15,2,8) and green_wool at (15,13,8): the opposite of these).
    for (const [x, y, z, expectedBlockId] of [
      [8, 2, 0, "green_wool"],
      [8, 13, 0, "red_wool"],
      [8, 2, 15, "green_wool"],
      [8, 13, 15, "red_wool"],
      [15, 2, 8, "green_wool"],
      [15, 13, 8, "red_wool"],
      [0, 2, 8, "green_wool"],
      [0, 13, 8, "red_wool"],
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
      costTier: "common",
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
    expect(() => buildVoxelGrid({ edgeBlocks: 4, fillStyle: "solid", sourceFaceTextures, palette: [] })).toThrow(
      RangeError,
    );
  });

  it("rejects a non-square source face texture as an internal invariant violation", () => {
    const sourceFaceTextures = uniformFaceTextures(RED);
    sourceFaceTextures.up = { width: 16, height: 32, pixels: new Uint8ClampedArray(16 * 32 * 4) };
    expect(() => buildVoxelGrid({ edgeBlocks: 4, fillStyle: "solid", sourceFaceTextures, palette: PALETTE })).toThrow();
  });

  it("rejects a non-positive edgeBlocks", () => {
    const sourceFaceTextures = uniformFaceTextures(RED);
    expect(() => buildVoxelGrid({ edgeBlocks: 0, fillStyle: "solid", sourceFaceTextures, palette: PALETTE })).toThrow(
      RangeError,
    );
  });
});
