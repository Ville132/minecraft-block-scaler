/**
 * Decodes a PNG texture's raw pixels (`decodePngTexture`), plus a
 * synchronous, canvas-free way to read just a PNG's width
 * (`readPngWidth`) — see each function's own doc comment.
 *
 * `decodePngTexture` has no automated test: `createImageBitmap`/
 * `OffscreenCanvas` are browser APIs this project's Vitest environment
 * (Node, see vitest.config.ts) does not have, and polyfilling a canvas
 * in Node is a dependency this plan didn't call for just to re-test a
 * three-line passthrough. Its correctness is instead covered by the
 * manual verification step in PLAN.md (loading a real archive in the
 * running app) and by keeping the function minimal enough that the only
 * thing which could be wrong is the browser's own decoder.
 *
 * `readPngWidth` has the opposite shape — plain byte parsing, no browser
 * API involved — so it IS covered, in `textureDecoder.test.ts`.
 */

export interface DecodedTexture {
  readonly width: number;
  readonly height: number;
  /** RGBA, 4 bytes per pixel, row-major from the top-left — `pixels.length === width * height * 4`. */
  readonly pixels: Uint8ClampedArray;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Byte offset of the big-endian width field within a PNG's first (always IHDR) chunk: 8-byte signature + 4-byte chunk length + 4-byte chunk type. */
const IHDR_WIDTH_OFFSET = 16;

/**
 * Reads a PNG's width straight from its IHDR chunk, without decoding any
 * pixels — synchronous and needs no canvas, unlike
 * {@link decodePngTexture}. Used only to classify a replica's candidate
 * sizes against a resource pack's REAL texture resolution (see
 * `domain/scale.ts`'s `classifyScale`) before the full, async decode
 * happens; this app's own 16x16 vanilla assumption is just a default,
 * not a requirement this function checks.
 *
 * Inputs: `pngBytes`, the raw file bytes of a PNG. The PNG format
 * guarantees IHDR is always the first chunk, so no chunk-walking is
 * needed.
 * Output: the image's width in pixels.
 * Failure mode: throws `Error` if the bytes are too short, do not start
 * with a valid PNG signature, or that signature is not immediately
 * followed by an IHDR chunk — i.e. are not a PNG at all.
 */
export function readPngWidth(pngBytes: Uint8Array): number {
  if (pngBytes.length < IHDR_WIDTH_OFFSET + 4) {
    throw new Error("Not a valid PNG file (too short to contain a signature and IHDR chunk)");
  }
  if (!PNG_SIGNATURE.every((signatureByte, index) => pngBytes[index] === signatureByte)) {
    throw new Error("Not a valid PNG file (missing PNG signature)");
  }
  const chunkType = String.fromCharCode(pngBytes[12]!, pngBytes[13]!, pngBytes[14]!, pngBytes[15]!);
  if (chunkType !== "IHDR") {
    throw new Error(`Expected an IHDR chunk immediately after the PNG signature, got '${chunkType}'`);
  }
  return new DataView(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength).getUint32(
    IHDR_WIDTH_OFFSET,
    false,
  );
}

/**
 * Inputs: `pngBytes`, the raw file bytes of a single texture PNG.
 * Output: its decoded dimensions and RGBA pixels.
 * Failure mode: rejects if the bytes are not a decodable image, or if a
 * 2D canvas context cannot be acquired.
 */
export async function decodePngTexture(pngBytes: Uint8Array): Promise<DecodedTexture> {
  // Re-wrapped in a fresh, plain ArrayBuffer: `Blob`'s type declarations
  // reject a `Uint8Array` that could be backed by a `SharedArrayBuffer`,
  // which `pngBytes`'s type does not rule out.
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(pngBytes)], { type: "image/png" }));
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new Error("Could not acquire a 2D canvas context to decode a texture");
    }
    context.drawImage(bitmap, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return { width, height, pixels: data };
  } finally {
    bitmap.close();
  }
}
