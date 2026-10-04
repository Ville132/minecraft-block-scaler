import { describe, expect, it } from "vitest";
import { readPngWidth } from "./textureDecoder.ts";

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
