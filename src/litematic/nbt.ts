/**
 * A minimal, typed reader/writer for NBT (Named Binary Tag), the binary
 * format `.litematic` files are serialized as (before gzip). Only what
 * `writeSchematic.ts` and its tests need is implemented — this is not a
 * general-purpose NBT library.
 *
 * Strings are encoded/decoded as plain UTF-8 rather than Java's "modified
 * UTF-8". The two differ only for embedded NUL bytes and characters
 * outside the Basic Multilingual Plane, neither of which occurs in the
 * ASCII block names and metadata text this module ever writes or reads
 * back in tests.
 */

export type NbtTagKind =
  | "byte"
  | "short"
  | "int"
  | "long"
  | "float"
  | "double"
  | "byteArray"
  | "string"
  | "list"
  | "compound"
  | "intArray"
  | "longArray";

export type NbtTag =
  | { readonly kind: "byte"; readonly value: number }
  | { readonly kind: "short"; readonly value: number }
  | { readonly kind: "int"; readonly value: number }
  | { readonly kind: "long"; readonly value: bigint }
  | { readonly kind: "float"; readonly value: number }
  | { readonly kind: "double"; readonly value: number }
  | { readonly kind: "byteArray"; readonly value: Int8Array }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "list"; readonly elementKind: NbtTagKind; readonly value: readonly NbtTag[] }
  | { readonly kind: "compound"; readonly value: Readonly<Record<string, NbtTag>> }
  | { readonly kind: "intArray"; readonly value: Int32Array }
  | { readonly kind: "longArray"; readonly value: BigInt64Array };

/** Builder functions for every NBT tag kind — the normal way to construct a tree to pass to {@link writeNbt}. */
export const nbt = {
  byte: (value: number): NbtTag => ({ kind: "byte", value }),
  short: (value: number): NbtTag => ({ kind: "short", value }),
  int: (value: number): NbtTag => ({ kind: "int", value }),
  long: (value: bigint): NbtTag => ({ kind: "long", value }),
  float: (value: number): NbtTag => ({ kind: "float", value }),
  double: (value: number): NbtTag => ({ kind: "double", value }),
  byteArray: (value: Int8Array): NbtTag => ({ kind: "byteArray", value }),
  string: (value: string): NbtTag => ({ kind: "string", value }),
  list: (elementKind: NbtTagKind, value: readonly NbtTag[]): NbtTag => ({
    kind: "list",
    elementKind,
    value,
  }),
  compound: (value: Readonly<Record<string, NbtTag>>): NbtTag => ({ kind: "compound", value }),
  intArray: (value: Int32Array): NbtTag => ({ kind: "intArray", value }),
  longArray: (value: BigInt64Array): NbtTag => ({ kind: "longArray", value }),
};

const TAG_ID: Record<NbtTagKind, number> = {
  byte: 1,
  short: 2,
  int: 3,
  long: 4,
  float: 5,
  double: 6,
  byteArray: 7,
  string: 8,
  list: 9,
  compound: 10,
  intArray: 11,
  longArray: 12,
};

const KIND_BY_TAG_ID: Readonly<Record<number, NbtTagKind>> = Object.fromEntries(
  Object.entries(TAG_ID).map(([kind, id]) => [id, kind as NbtTagKind]),
);

/** A growable big-endian byte buffer. Internal to this module — callers only ever see the final `Uint8Array`. */
class ByteWriter {
  private buffer: Uint8Array;
  private view: DataView;
  private length = 0;

  constructor(initialCapacity = 1024) {
    this.buffer = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buffer.buffer);
  }

  private ensureCapacity(additional: number): void {
    if (this.length + additional <= this.buffer.length) return;
    let newCapacity = this.buffer.length * 2;
    while (newCapacity < this.length + additional) newCapacity *= 2;
    const grown = new Uint8Array(newCapacity);
    grown.set(this.buffer.subarray(0, this.length));
    this.buffer = grown;
    this.view = new DataView(this.buffer.buffer);
  }

  writeByte(value: number): void {
    this.ensureCapacity(1);
    this.view.setInt8(this.length, value);
    this.length += 1;
  }

  writeShort(value: number): void {
    this.ensureCapacity(2);
    this.view.setInt16(this.length, value, false);
    this.length += 2;
  }

  writeUnsignedShort(value: number): void {
    this.ensureCapacity(2);
    this.view.setUint16(this.length, value, false);
    this.length += 2;
  }

  writeInt(value: number): void {
    this.ensureCapacity(4);
    this.view.setInt32(this.length, value, false);
    this.length += 4;
  }

  writeLong(value: bigint): void {
    this.ensureCapacity(8);
    this.view.setBigInt64(this.length, value, false);
    this.length += 8;
  }

  writeFloat(value: number): void {
    this.ensureCapacity(4);
    this.view.setFloat32(this.length, value, false);
    this.length += 4;
  }

  writeDouble(value: number): void {
    this.ensureCapacity(8);
    this.view.setFloat64(this.length, value, false);
    this.length += 8;
  }

  writeBytes(bytes: Int8Array | Uint8Array): void {
    this.ensureCapacity(bytes.length);
    this.buffer.set(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length), this.length);
    this.length += bytes.length;
  }

  writeUtf8String(text: string): void {
    const encoded = new TextEncoder().encode(text);
    this.writeUnsignedShort(encoded.length);
    this.writeBytes(encoded);
  }

  toUint8Array(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }
}

function writeTagPayload(writer: ByteWriter, tag: NbtTag): void {
  switch (tag.kind) {
    case "byte":
      writer.writeByte(tag.value);
      return;
    case "short":
      writer.writeShort(tag.value);
      return;
    case "int":
      writer.writeInt(tag.value);
      return;
    case "long":
      writer.writeLong(tag.value);
      return;
    case "float":
      writer.writeFloat(tag.value);
      return;
    case "double":
      writer.writeDouble(tag.value);
      return;
    case "byteArray":
      writer.writeInt(tag.value.length);
      writer.writeBytes(tag.value);
      return;
    case "string":
      writer.writeUtf8String(tag.value);
      return;
    case "list":
      writer.writeByte(TAG_ID[tag.elementKind]);
      writer.writeInt(tag.value.length);
      for (const element of tag.value) writeTagPayload(writer, element);
      return;
    case "compound":
      for (const [name, child] of Object.entries(tag.value)) {
        writer.writeByte(TAG_ID[child.kind]);
        writer.writeUtf8String(name);
        writeTagPayload(writer, child);
      }
      writer.writeByte(0); // TAG_End
      return;
    case "intArray":
      writer.writeInt(tag.value.length);
      for (const element of tag.value) writer.writeInt(element);
      return;
    case "longArray":
      writer.writeInt(tag.value.length);
      for (const element of tag.value) writer.writeLong(element);
      return;
  }
}

/**
 * Serializes an NBT compound to bytes, ready to gzip.
 *
 * Inputs: `root`, the tag tree to write (must be a compound — NBT files
 * always have a compound at the root); `rootName`, the root tag's name
 * (Litematica, like most NBT files, uses the empty string).
 * Failure mode: throws `TypeError` if `root` is not a compound, since
 * writing anything else would not parse back as a valid NBT file.
 */
export function writeNbt(root: NbtTag, rootName = ""): Uint8Array {
  if (root.kind !== "compound") {
    throw new TypeError(`NBT root tag must be a compound, got '${root.kind}'`);
  }
  const writer = new ByteWriter();
  writer.writeByte(TAG_ID.compound);
  writer.writeUtf8String(rootName);
  writeTagPayload(writer, root);
  return writer.toUint8Array();
}

/** A cursor over a big-endian byte buffer. Internal to this module. */
class ByteReader {
  private readonly view: DataView;
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private ensure(remaining: number): void {
    if (this.offset + remaining > this.bytes.length) {
      throw new RangeError(`Unexpected end of NBT data at offset ${this.offset}`);
    }
  }

  readByte(): number {
    this.ensure(1);
    const value = this.view.getInt8(this.offset);
    this.offset += 1;
    return value;
  }

  readUnsignedByte(): number {
    this.ensure(1);
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  readShort(): number {
    this.ensure(2);
    const value = this.view.getInt16(this.offset, false);
    this.offset += 2;
    return value;
  }

  readUnsignedShort(): number {
    this.ensure(2);
    const value = this.view.getUint16(this.offset, false);
    this.offset += 2;
    return value;
  }

  readInt(): number {
    this.ensure(4);
    const value = this.view.getInt32(this.offset, false);
    this.offset += 4;
    return value;
  }

  readLong(): bigint {
    this.ensure(8);
    const value = this.view.getBigInt64(this.offset, false);
    this.offset += 8;
    return value;
  }

  readFloat(): number {
    this.ensure(4);
    const value = this.view.getFloat32(this.offset, false);
    this.offset += 4;
    return value;
  }

  readDouble(): number {
    this.ensure(8);
    const value = this.view.getFloat64(this.offset, false);
    this.offset += 8;
    return value;
  }

  readBytes(count: number): Uint8Array {
    this.ensure(count);
    const value = this.bytes.slice(this.offset, this.offset + count);
    this.offset += count;
    return value;
  }

  readUtf8String(): string {
    const length = this.readUnsignedShort();
    return new TextDecoder("utf-8").decode(this.readBytes(length));
  }
}

function readTagPayload(reader: ByteReader, tagId: number): NbtTag {
  switch (tagId) {
    case TAG_ID.byte:
      return nbt.byte(reader.readByte());
    case TAG_ID.short:
      return nbt.short(reader.readShort());
    case TAG_ID.int:
      return nbt.int(reader.readInt());
    case TAG_ID.long:
      return nbt.long(reader.readLong());
    case TAG_ID.float:
      return nbt.float(reader.readFloat());
    case TAG_ID.double:
      return nbt.double(reader.readDouble());
    case TAG_ID.byteArray: {
      const length = reader.readInt();
      const bytes = reader.readBytes(length);
      return nbt.byteArray(new Int8Array(bytes.buffer, bytes.byteOffset, bytes.length));
    }
    case TAG_ID.string:
      return nbt.string(reader.readUtf8String());
    case TAG_ID.list: {
      const elementTagId = reader.readUnsignedByte();
      const length = reader.readInt();
      const elementKind = KIND_BY_TAG_ID[elementTagId];
      if (elementKind === undefined && length > 0) {
        throw new RangeError(`Unknown NBT list element tag id ${elementTagId}`);
      }
      const value: NbtTag[] = [];
      for (let i = 0; i < length; i++) value.push(readTagPayload(reader, elementTagId));
      return nbt.list(elementKind ?? "byte", value);
    }
    case TAG_ID.compound: {
      const value: Record<string, NbtTag> = {};
      for (;;) {
        const childTagId = reader.readUnsignedByte();
        if (childTagId === 0) break; // TAG_End
        const name = reader.readUtf8String();
        value[name] = readTagPayload(reader, childTagId);
      }
      return nbt.compound(value);
    }
    case TAG_ID.intArray: {
      const length = reader.readInt();
      const value = new Int32Array(length);
      for (let i = 0; i < length; i++) value[i] = reader.readInt();
      return nbt.intArray(value);
    }
    case TAG_ID.longArray: {
      const length = reader.readInt();
      const value = new BigInt64Array(length);
      for (let i = 0; i < length; i++) value[i] = reader.readLong();
      return nbt.longArray(value);
    }
    default:
      throw new RangeError(`Unknown NBT tag id ${tagId}`);
  }
}

/**
 * Parses bytes previously produced by {@link writeNbt} (after gunzip).
 * Used by this project's own round-trip tests and by anything that needs
 * to inspect a written schematic.
 *
 * Failure modes: throws `TypeError` if the root tag is not a compound;
 * throws `RangeError` on truncated data or an unrecognized tag id,
 * rather than returning a partially-parsed tree.
 */
export function readNbt(bytes: Uint8Array): { readonly name: string; readonly tag: NbtTag } {
  const reader = new ByteReader(bytes);
  const rootTagId = reader.readUnsignedByte();
  if (rootTagId !== TAG_ID.compound) {
    throw new TypeError(`NBT root tag must be a compound, got tag id ${rootTagId}`);
  }
  const name = reader.readUtf8String();
  const tag = readTagPayload(reader, rootTagId);
  return { name, tag };
}

/** Narrows a tag to a compound's field map, or throws — use when a missing/wrong field means the file is malformed, not absent-by-design. */
export function expectCompound(tag: NbtTag): Readonly<Record<string, NbtTag>> {
  if (tag.kind !== "compound") throw new TypeError(`expected a compound tag, got '${tag.kind}'`);
  return tag.value;
}

/** Narrows a tag to a list's elements, or throws. */
export function expectList(tag: NbtTag): readonly NbtTag[] {
  if (tag.kind !== "list") throw new TypeError(`expected a list tag, got '${tag.kind}'`);
  return tag.value;
}

/** Narrows a tag to its long-array payload, or throws. */
export function expectLongArray(tag: NbtTag): BigInt64Array {
  if (tag.kind !== "longArray") throw new TypeError(`expected a longArray tag, got '${tag.kind}'`);
  return tag.value;
}

/** Narrows a tag to its string payload, or throws. */
export function expectString(tag: NbtTag): string {
  if (tag.kind !== "string") throw new TypeError(`expected a string tag, got '${tag.kind}'`);
  return tag.value;
}

/** Narrows a tag to its int payload, or throws. */
export function expectInt(tag: NbtTag): number {
  if (tag.kind !== "int") throw new TypeError(`expected an int tag, got '${tag.kind}'`);
  return tag.value;
}

/** Looks up a required field in a compound's field map, or throws — never returns `undefined`. */
export function requireField(
  fields: Readonly<Record<string, NbtTag>>,
  name: string,
): NbtTag {
  const field = fields[name];
  if (field === undefined) throw new TypeError(`missing required NBT field '${name}'`);
  return field;
}
