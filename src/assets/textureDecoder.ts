/**
 * Decodes a PNG texture's raw pixels. Delegates entirely to the
 * browser's own image decoder (`createImageBitmap` + `OffscreenCanvas`)
 * rather than a bespoke PNG parser — there is nothing format-specific
 * here to get wrong.
 *
 * No automated test: `createImageBitmap`/`OffscreenCanvas` are browser
 * APIs this project's Vitest environment (Node, see vitest.config.ts)
 * does not have, and polyfilling a canvas in Node is a dependency this
 * plan didn't call for just to re-test a three-line passthrough. This
 * function's correctness is instead covered by the manual verification
 * step in PLAN.md (loading a real archive in the running app) and by
 * keeping the function minimal enough that the only thing which could
 * be wrong is the browser's own decoder.
 */

export interface DecodedTexture {
  readonly width: number;
  readonly height: number;
  /** RGBA, 4 bytes per pixel, row-major from the top-left — `pixels.length === width * height * 4`. */
  readonly pixels: Uint8ClampedArray;
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
