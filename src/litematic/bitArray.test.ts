import { describe, expect, it } from "vitest";
import {
  bitsPerEntry,
  fromSignedLongArray,
  packBlockStateIndices,
  toSignedLongArray,
  unpackBlockStateIndices,
} from "./bitArray.ts";

describe("bitsPerEntry", () => {
  it.each([
    [1, 2],
    [2, 2],
    [4, 2],
    [5, 3],
    [8, 3],
    [9, 4],
    [16, 4],
    [17, 5],
    [31, 5],
    [64, 6],
    [65, 7],
  ])("palette of %i needs %i bits", (paletteSize, expectedBits) => {
    expect(bitsPerEntry(paletteSize)).toBe(expectedBits);
  });

  it.each([0, -1, 1.5])("rejects invalid palette size %j", (paletteSize) => {
    expect(() => bitsPerEntry(paletteSize)).toThrow(RangeError);
  });
});

describe("packBlockStateIndices golden values", () => {
  // Hand-computed straddle where 4 low bits land in long 0 and 1 high
  // bit spills into long 1 (bits [60, 65) of the stream).
  it("packs a value straddling the boundary with 4 low bits + 1 high bit", () => {
    const indices = new Array(13).fill(0);
    indices[12] = 31; // 0b11111, the max value for 5 bits
    const longs = packBlockStateIndices(indices, 5);
    expect(longs).toEqual([17293822569102704640n, 1n]);
    expect(toSignedLongArray(longs)).toEqual(BigInt64Array.from([-1152921504606846976n, 1n]));
  });

  // Hand-computed straddle where 1 low bit lands in long 0 and 2 high
  // bits spill into long 1 (bits [63, 66) of the stream).
  it("packs a value straddling the boundary with 1 low bit + 2 high bits", () => {
    const indices = new Array(22).fill(0);
    indices[21] = 7; // 0b111, the max value for 3 bits
    const longs = packBlockStateIndices(indices, 3);
    expect(longs).toEqual([9223372036854775808n, 3n]);
    expect(toSignedLongArray(longs)).toEqual(BigInt64Array.from([-9223372036854775808n, 3n]));
  });

  it("round-trips signed <-> unsigned long conversion", () => {
    const unsigned = [17293822569102704640n, 1n, 0n, 9223372036854775808n];
    expect(fromSignedLongArray(toSignedLongArray(unsigned))).toEqual(unsigned);
  });
});

/**
 * Independent oracle: concatenates every index into one arbitrary-size
 * bigint (entry 0 in the lowest bits) and slices it into 64-bit words.
 * This has no branching on long boundaries at all, so agreement with
 * `packBlockStateIndices` is a genuine cross-check rather than the same
 * logic restated twice.
 */
function referencePack(indices: readonly number[], bits: number): bigint[] {
  let concatenated = 0n;
  for (let i = indices.length - 1; i >= 0; i--) {
    concatenated = (concatenated << BigInt(bits)) | BigInt(indices[i]!);
  }
  const mask64 = (1n << 64n) - 1n;
  const longCount = Math.ceil((indices.length * bits) / 64);
  return Array.from({ length: longCount }, (_, i) => (concatenated >> BigInt(i * 64)) & mask64);
}

/** Deterministic PRNG (mulberry32) so property tests are reproducible. */
function deterministicRandomInts(count: number, exclusiveMax: number, seed: number): number[] {
  let state = seed;
  return Array.from({ length: count }, () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const unitInterval = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return Math.floor(unitInterval * exclusiveMax);
  });
}

describe("packBlockStateIndices / unpackBlockStateIndices round trip", () => {
  const paletteSizes = [2, 3, 4, 5, 8, 9, 16, 17, 31, 64, 65];

  it.each(paletteSizes)("round-trips %i entries worth of indices for a palette of size %i", (paletteSize) => {
    const bits = bitsPerEntry(paletteSize);
    const indices = deterministicRandomInts(500, paletteSize, paletteSize * 7919 + 1);

    const packed = packBlockStateIndices(indices, bits);
    expect(packed).toEqual(referencePack(indices, bits));

    const unpacked = unpackBlockStateIndices(packed, bits, indices.length);
    expect(Array.from(unpacked)).toEqual(indices);
  });

  it("round-trips a single entry that exactly fills one long (bits=64)", () => {
    const indices = [0, 12345];
    const packed = packBlockStateIndices(indices, 64);
    expect(packed).toEqual([0n, 12345n]);
    expect(Array.from(unpackBlockStateIndices(packed, 64, 2))).toEqual(indices);
  });
});

describe("packBlockStateIndices failure modes", () => {
  it.each([0, 65, 1.5, -1])("rejects an invalid bit width %j", (bits) => {
    expect(() => packBlockStateIndices([0], bits)).toThrow(RangeError);
  });

  it("rejects an index that does not fit in the given bit width", () => {
    expect(() => packBlockStateIndices([4], 2)).toThrow(RangeError);
  });

  it("rejects a negative index", () => {
    expect(() => packBlockStateIndices([-1], 4)).toThrow(RangeError);
  });

  it("rejects a non-integer index", () => {
    expect(() => packBlockStateIndices([1.5], 4)).toThrow(RangeError);
  });
});
