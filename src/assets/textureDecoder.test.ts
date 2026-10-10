import { describe, expect, it } from "vitest";
import { readPngWidth, rotateTextureClockwise, type DecodedTexture } from "./textureDecoder.ts";

/**
 * The smallest byte sequence `readPngWidth` needs: the 8-byte PNG
 * signature plus a minimal (but correctly-shaped) IHDR chunk — length,
 * type, width, height, the five remaining IHDR fields, and a (deliberately
 * not computed — `readPngWidth` never checks it) CRC. `readPngWidth`
 * only ever reads the width field, so nothing after it needs to be real.
 */
function minimalPngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33); // 8 signature + 4 length + 4 "IHDR" + 13 IHDR body + 4 crc
  const view = new DataView(bytes.buffer);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  view.setUint32(8, 13, false); // IHDR body length is always 13
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  // bytes 24-28: bit depth, color type, compression, filter, interlace - left as 0, unread by readPngWidth.
  // bytes 29-32: CRC - left as 0, unread by readPngWidth.
  return bytes;
}

describe("readPngWidth", () => {
  it("reads a 16px texture's width (the vanilla default)", () => {
    expect(readPngWidth(minimalPngHeader(16, 16))).toBe(16);
  });

  it("reads a non-square, non-16px texture's width", () => {
    expect(readPngWidth(minimalPngHeader(32, 64))).toBe(32);
  });

  it("reads correctly from a byte array that is a view into a larger buffer, not starting at byte 0", () => {
    const header = minimalPngHeader(48, 48);
    const padded = new Uint8Array(10 + header.length);
    padded.set(header, 10);
    const view = padded.subarray(10); // byteOffset !== 0 on the underlying ArrayBuffer
    expect(readPngWidth(view)).toBe(48);
  });

  it("rejects bytes that are too short to contain a signature and IHDR chunk", () => {
    expect(() => readPngWidth(new Uint8Array(10))).toThrow(/too short/);
  });

  it("rejects bytes with no valid PNG signature", () => {
    const notPng = minimalPngHeader(16, 16);
    notPng[0] = 0x00; // corrupt the first signature byte
    expect(() => readPngWidth(notPng)).toThrow(/signature/);
  });

  it("rejects a valid PNG signature not followed by an IHDR chunk", () => {
    const bytes = minimalPngHeader(16, 16);
    bytes.set([0x49, 0x44, 0x41, 0x54], 12); // "IDAT" instead of "IHDR"
    expect(() => readPngWidth(bytes)).toThrow(/IHDR/);
  });
});

/** A texture whose pixels are labelled by their red channel, row by row from the top — so a test can write and read one as a grid of labels. */
function labelledTexture(rows: readonly (readonly number[])[]): DecodedTexture {
  const width = rows[0]!.length;
  const pixels = new Uint8ClampedArray(width * rows.length * 4);
  rows.flat().forEach((label, index) => pixels.set([label, 0, 0, 255], index * 4));
  return { width, height: rows.length, pixels };
}

function labelsOf(texture: DecodedTexture): number[][] {
  return Array.from({ length: texture.height }, (_, row) =>
    Array.from({ length: texture.width }, (_, column) => texture.pixels[(row * texture.width + column) * 4]!),
  );
}

describe("rotateTextureClockwise", () => {
  const square = labelledTexture([
    [1, 2],
    [3, 4],
  ]);

  it("turns a quarter clockwise: the top row becomes the right-hand column", () => {
    expect(labelsOf(rotateTextureClockwise(square, 90))).toEqual([
      [3, 1],
      [4, 2],
    ]);
  });

  it("turns half way round", () => {
    expect(labelsOf(rotateTextureClockwise(square, 180))).toEqual([
      [4, 3],
      [2, 1],
    ]);
  });

  it("turns three quarters clockwise: the top row becomes the left-hand column", () => {
    expect(labelsOf(rotateTextureClockwise(square, 270))).toEqual([
      [2, 4],
      [1, 3],
    ]);
  });

  it("returns the very same texture for no turn", () => {
    expect(rotateTextureClockwise(square, 0)).toBe(square);
  });

  it("swaps width and height of a non-square texture on a quarter turn", () => {
    const wide = labelledTexture([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    const turned = rotateTextureClockwise(wide, 90);
    expect([turned.width, turned.height]).toEqual([2, 3]);
    expect(labelsOf(turned)).toEqual([
      [4, 1],
      [5, 2],
      [6, 3],
    ]);
  });

  it("comes back to the original after four quarter turns", () => {
    let texture = labelledTexture([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    for (let turn = 0; turn < 4; turn++) texture = rotateTextureClockwise(texture, 90);
    expect(labelsOf(texture)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });
});
