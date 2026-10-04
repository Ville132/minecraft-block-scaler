/**
 * Litematica packs each region's block-state indices into a tightly
 * bit-packed array of 64-bit longs: entries have no per-long padding and
 * a value may straddle the boundary between two longs. This differs from
 * vanilla's own (1.16+) chunk format, which pads each long — reusing that
 * assumption here is the most common way to produce a `.litematic` file
 * that Litematica refuses to load or renders as garbage.
 *
 * All packing math is done on unsigned bigints in the range
 * [0, 2^64 - 1]. NBT's TAG_Long_Array stores signed 64-bit longs, so the
 * unsigned/signed conversion at the edges (`toSignedLongArray` /
 * `fromSignedLongArray`) is kept separate from the bit-packing itself.
 */

const BITS_PER_LONG = 64n;
const MASK_64_BIT = (1n << BITS_PER_LONG) - 1n;

/**
 * The number of bits Litematica uses to store one index into a palette
 * of the given size.
 *
 * Inputs: `paletteSize`, the number of distinct block states (including
 * air) that will be indexed, >= 1.
 * Output: the bit width, never below 2 — Litematica reserves at least 2
 * bits even for a palette containing only air.
 * Failure mode: throws `RangeError` for a non-positive or non-integer
 * palette size, since that would silently produce an unreadable file.
 */
export function bitsPerEntry(paletteSize: number): number {
  if (!Number.isInteger(paletteSize) || paletteSize < 1) {
    throw new RangeError(`paletteSize must be a positive integer, got ${paletteSize}`);
  }
  // Exact integer bit-length (smallest b with 2^b >= paletteSize), not
  // Math.ceil(Math.log2(paletteSize)): floating-point log2 is not
  // contractually guaranteed exact right at a power-of-two boundary
  // across every JS engine, and a one-bit error here silently shifts
  // every single entry in the packed array — the single highest-stakes
  // number in this whole format (see this module's header comment).
  // Plain integer doubling has no such risk, for any realistic palette
  // size (safe up to 2^53, Number's own exact-integer limit).
  let bitsNeededForPalette = 0;
  let exclusiveUpperBound = 1;
  while (exclusiveUpperBound < paletteSize) {
    exclusiveUpperBound *= 2;
    bitsNeededForPalette++;
  }
  return Math.max(2, bitsNeededForPalette);
}

function assertValidEntry(value: number, bits: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`palette index must be a non-negative integer, got ${value}`);
  }
  const upperBoundExclusive = 1n << BigInt(bits);
  if (BigInt(value) >= upperBoundExclusive) {
    throw new RangeError(
      `palette index ${value} does not fit in ${bits} bits (max ${upperBoundExclusive - 1n})`,
    );
  }
}

/**
 * Writes one value into its slot in a tightly bit-packed long array,
 * splitting it across two longs when its slot straddles a 64-bit
 * boundary.
 *
 * Inputs: `longs`, the working array (mutated in place, unsigned
 * values); `entryIndex`, the zero-based slot; `value`, the already
 * range-checked index to store; `bits`, the width of every slot.
 * Output: none (mutates `longs`).
 */
function setEntry(longs: bigint[], entryIndex: number, value: number, bits: number): void {
  const valueBig = BigInt(value);
  const startBit = entryIndex * bits;
  const startLongIndex = Math.floor(startBit / 64);
  const startOffset = BigInt(startBit % 64);

  const currentStart = longs[startLongIndex] ?? 0n;
  longs[startLongIndex] = (currentStart | (valueBig << startOffset)) & MASK_64_BIT;

  const endBitExclusive = startBit + bits;
  const endLongIndex = Math.floor((endBitExclusive - 1) / 64);
  if (endLongIndex !== startLongIndex) {
    const lowBitsConsumed = BITS_PER_LONG - startOffset;
    const currentEnd = longs[endLongIndex] ?? 0n;
    longs[endLongIndex] = (currentEnd | (valueBig >> lowBitsConsumed)) & MASK_64_BIT;
  }
}

/** The inverse of {@link setEntry}: reads one value back out, reassembling it from two longs when it straddles a boundary. */
function getEntry(longs: readonly bigint[], entryIndex: number, bits: number): bigint {
  const mask = (1n << BigInt(bits)) - 1n;
  const startBit = entryIndex * bits;
  const startLongIndex = Math.floor(startBit / 64);
  const startOffset = BigInt(startBit % 64);

  const endBitExclusive = startBit + bits;
  const endLongIndex = Math.floor((endBitExclusive - 1) / 64);

  const startLong = longs[startLongIndex] ?? 0n;
  if (endLongIndex === startLongIndex) {
    return (startLong >> startOffset) & mask;
  }

  const lowBitsConsumed = BITS_PER_LONG - startOffset;
  const endLong = longs[endLongIndex] ?? 0n;
  return ((startLong >> startOffset) | (endLong << lowBitsConsumed)) & mask;
}

/**
 * Packs a flat list of palette indices into Litematica's bit-packed long
 * array.
 *
 * Inputs: `indices`, one palette index per block in the region's y-major
 * iteration order (see `domain/shell.ts`); `bits`, the per-entry width
 * from {@link bitsPerEntry}.
 * Output: unsigned longs (each in [0, 2^64-1]); pass through
 * {@link toSignedLongArray} before writing to NBT.
 * Failure mode: throws `RangeError` if any index does not fit in `bits`
 * bits, so a palette/bit-width mismatch fails loudly instead of writing
 * a silently truncated schematic.
 */
export function packBlockStateIndices(indices: ArrayLike<number>, bits: number): bigint[] {
  if (!Number.isInteger(bits) || bits < 1 || bits > 64) {
    throw new RangeError(`bits must be an integer in [1, 64], got ${bits}`);
  }
  const longCount = Math.ceil((indices.length * bits) / 64);
  const longs = new Array<bigint>(longCount).fill(0n);
  for (let i = 0; i < indices.length; i++) {
    const value = indices[i]!;
    assertValidEntry(value, bits);
    setEntry(longs, i, value, bits);
  }
  return longs;
}

/**
 * The inverse of {@link packBlockStateIndices}: reconstructs the flat
 * palette-index list from packed longs.
 *
 * Inputs: `longs`, unsigned working longs; `bits`, the per-entry width;
 * `entryCount`, how many indices to read out (the array length alone
 * cannot recover this, since the last long may be partially unused).
 * Output: one palette index per entry, in the same order they were
 * packed.
 */
export function unpackBlockStateIndices(
  longs: readonly bigint[],
  bits: number,
  entryCount: number,
): Uint32Array {
  const result = new Uint32Array(entryCount);
  for (let i = 0; i < entryCount; i++) {
    result[i] = Number(getEntry(longs, i, bits));
  }
  return result;
}

/**
 * Converts working (unsigned) longs into the signed two's-complement
 * form NBT's TAG_Long_Array stores.
 */
export function toSignedLongArray(longs: readonly bigint[]): BigInt64Array {
  return BigInt64Array.from(longs, (value) => BigInt.asIntN(64, value));
}

/**
 * Converts signed longs read from NBT back into the unsigned form the
 * pack/unpack functions in this module expect.
 */
export function fromSignedLongArray(signedLongs: BigInt64Array | readonly bigint[]): bigint[] {
  return Array.from(signedLongs, (value) => value & MASK_64_BIT);
}
