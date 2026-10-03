import { describe, expect, it } from "vitest";
import type { DecodedTexture } from "../assets/textureDecoder.ts";
import { rgb8ToOklab } from "./color.ts";
import { CUBE_FACE_DIRECTIONS, type CubeFaceDirection } from "./faces.ts";
import type { PaletteBlock } from "./palette.ts";
import { hollowBlockCount, solidBlockCount } from "./scale.ts";
import { buildVoxelGrid, governingFace, isShellVoxel, pixelRegionForVoxelCoord, positionOnFace } from "./shell.ts";

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

describe("governingFace", () => {
  it("a 3-way corner tie resolves to the Y face", () => {
    expect(governingFace(0, 0, 0, 16)).toBe("down");
    expect(governingFace(15, 15, 15, 16)).toBe("up");
  });

  it("a Y/Z edge tie (not touching X) resolves to the Y face", () => {
    expect(governingFace(5, 15, 0, 16)).toBe("up");
  });

  it("a Z/X edge tie (not touching Y) resolves to the Z face", () => {
    expect(governingFace(0, 5, 0, 16)).toBe("north");
  });

  it("an interior voxel still resolves deterministically to its nearest face", () => {
    // y-boundary-distance 7, z-boundary-distance 1, x-boundary-distance 7 -> Z (north) wins.
    expect(governingFace(8, 8, 1, 16)).toBe("north");
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
    expect(positionOnFace("down", 5, 7, 16)).toEqual({ x: 5, y: 0, z: 7 });
    expect(positionOnFace("up", 5, 7, 16)).toEqual({ x: 5, y: 15, z: 7 });
    expect(positionOnFace("north", 5, 7, 16)).toEqual({ x: 5, y: 7, z: 0 });
    expect(positionOnFace("south", 5, 7, 16)).toEqual({ x: 5, y: 7, z: 15 });
    expect(positionOnFace("west", 5, 7, 16)).toEqual({ x: 0, y: 5, z: 7 });
    expect(positionOnFace("east", 5, 7, 16)).toEqual({ x: 15, y: 5, z: 7 });
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

function paletteBlock(blockId: string, rgb: readonly [number, number, number]): PaletteBlock {
  return { blockId, resourceLocation: `minecraft:${blockId}`, color: rgb8ToOklab({ r: rgb[0], g: rgb[1], b: rgb[2] }), costTier: "common" };
}

const RED: readonly [number, number, number] = [255, 0, 0];
const GREEN: readonly [number, number, number] = [0, 255, 0];
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
