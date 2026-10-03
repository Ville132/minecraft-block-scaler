import { describe, expect, it } from "vitest";
import {
  expectCompound,
  expectInt,
  expectList,
  expectLongArray,
  expectString,
  nbt,
  readNbt,
  requireField,
  writeNbt,
  type NbtTag,
} from "./nbt.ts";

describe("writeNbt golden bytes", () => {
  it("encodes a minimal compound exactly as the NBT spec defines", () => {
    // root compound (tag 0x0A), empty name, one Int child named "Foo"=1, then TAG_End.
    const bytes = writeNbt(nbt.compound({ Foo: nbt.int(1) }));
    expect(Array.from(bytes)).toEqual([
      0x0a, 0x00, 0x00, // compound tag id, name length 0
      0x03, 0x00, 0x03, 0x46, 0x6f, 0x6f, // int tag id, name length 3, "Foo"
      0x00, 0x00, 0x00, 0x01, // int value 1, big-endian
      0x00, // TAG_End
    ]);
  });
});

describe("writeNbt / readNbt round trip", () => {
  it("round-trips every tag kind, including nested and empty collections", () => {
    const root = nbt.compound({
      aByte: nbt.byte(-12),
      aShort: nbt.short(-1000),
      anInt: nbt.int(-100000),
      aLong: nbt.long(-9223372036854775808n),
      aFloat: nbt.float(1.5),
      aDouble: nbt.double(2.25),
      aByteArray: nbt.byteArray(Int8Array.from([1, -1, 127, -128])),
      aString: nbt.string("minecraft:cobblestone"),
      anEmptyList: nbt.list("compound", []),
      aListOfCompounds: nbt.list("compound", [
        nbt.compound({ Name: nbt.string("minecraft:air") }),
        nbt.compound({ Name: nbt.string("minecraft:stone") }),
      ]),
      anEmptyCompound: nbt.compound({}),
      anIntArray: nbt.intArray(Int32Array.from([1, 2, -3])),
      aLongArray: nbt.longArray(BigInt64Array.from([0n, -1n, 9223372036854775807n])),
    });

    const { name, tag } = readNbt(writeNbt(root, "TestRoot"));

    expect(name).toBe("TestRoot");
    expect(tag).toEqual(root);
  });

  it("round-trips a deeply nested region-shaped structure", () => {
    const region = nbt.compound({
      Position: nbt.compound({ x: nbt.int(0), y: nbt.int(0), z: nbt.int(0) }),
      Size: nbt.compound({ x: nbt.int(16), y: nbt.int(16), z: nbt.int(16) }),
      BlockStatePalette: nbt.list("compound", [
        nbt.compound({ Name: nbt.string("minecraft:air") }),
        nbt.compound({ Name: nbt.string("minecraft:cobblestone") }),
      ]),
      BlockStates: nbt.longArray(BigInt64Array.from([0n, 1n])),
      TileEntities: nbt.list("compound", []),
      Entities: nbt.list("compound", []),
      PendingBlockTicks: nbt.list("compound", []),
      PendingFluidTicks: nbt.list("compound", []),
    });
    const root = nbt.compound({ Regions: nbt.compound({ MyRegion: region }) });

    const { tag } = readNbt(writeNbt(root));
    expect(tag).toEqual(root);
  });
});

describe("expect* narrowing helpers", () => {
  const sample: NbtTag = nbt.compound({
    Name: nbt.string("minecraft:cobblestone"),
    Count: nbt.int(64),
    Palette: nbt.list("compound", [nbt.compound({ Name: nbt.string("minecraft:air") })]),
    States: nbt.longArray(BigInt64Array.from([1n, 2n])),
  });
  const fields = expectCompound(sample);

  it("reads matching fields", () => {
    expect(expectString(requireField(fields, "Name"))).toBe("minecraft:cobblestone");
    expect(expectInt(requireField(fields, "Count"))).toBe(64);
    expect(expectList(requireField(fields, "Palette"))).toHaveLength(1);
    expect(Array.from(expectLongArray(requireField(fields, "States")))).toEqual([1n, 2n]);
  });

  it("throws on a type mismatch instead of returning a wrong value", () => {
    expect(() => expectString(requireField(fields, "Count"))).toThrow(TypeError);
    expect(() => expectInt(requireField(fields, "Name"))).toThrow(TypeError);
  });

  it("throws on a missing field instead of returning undefined", () => {
    expect(() => requireField(fields, "DoesNotExist")).toThrow(TypeError);
  });
});

describe("failure modes", () => {
  it("rejects writing a non-compound root", () => {
    expect(() => writeNbt(nbt.int(1))).toThrow(TypeError);
  });

  it("rejects reading a non-compound root", () => {
    const bytes = Uint8Array.from([0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]); // TAG_Int at root
    expect(() => readNbt(bytes)).toThrow(TypeError);
  });

  it("rejects truncated data instead of returning a partial tree", () => {
    const truncated = writeNbt(nbt.compound({ Foo: nbt.int(1) })).slice(0, 6);
    expect(() => readNbt(truncated)).toThrow(RangeError);
  });

  it("rejects an unrecognized tag id", () => {
    const bytes = Uint8Array.from([0x0a, 0x00, 0x00, 0x7f, 0x00, 0x01, 0x41]); // compound, child tag id 0x7f
    expect(() => readNbt(bytes)).toThrow(RangeError);
  });
});
