/**
 * The scale math that decides which replica sizes keep a block looking
 * like itself. Every vanilla block texture is a 16x16 pixel grid, so a
 * replica's appearance survives only when texture pixels land on build
 * blocks on a uniform grid — see PLAN.md's "The scale math" section for
 * the full reasoning. This module turns that reasoning into executable
 * rules; it does not place any blocks (see `shell.ts` for that).
 */

/** Every vanilla block texture is 16x16px. Exposed as a parameter default, not a hardcoded literal, so a resource pack with a different texture resolution can override it later without changing this module's logic. */
export const VANILLA_TEXTURE_SIZE_PX = 16;

export type ScaleClassification =
  | { readonly kind: "exact"; readonly blocksPerPixel: number }
  | { readonly kind: "reduced"; readonly pixelsPerBlock: number }
  | { readonly kind: "distorted" };

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive integer, got ${value}`);
  }
}

/**
 * Classifies a replica edge length by whether it keeps the source
 * texture's pixel grid uniform.
 *
 * Inputs: `edgeBlocks`, the replica's edge length in blocks;
 * `texturePixelsPerSide`, the source texture's resolution (defaults to
 * vanilla's 16).
 * Output: `"exact"` when each texture pixel maps onto a whole number of
 * blocks per side (`edgeBlocks` is a multiple of `texturePixelsPerSide`);
 * `"reduced"` when several whole pixels collapse uniformly into one
 * block (`texturePixelsPerSide` is a multiple of `edgeBlocks`); otherwise
 * `"distorted"`, meaning some blocks would cover more source pixels than
 * their neighbours and the texture's spacing would visibly break.
 * Failure mode: throws `RangeError` for a non-positive or non-integer
 * edge length.
 */
export function classifyScale(
  edgeBlocks: number,
  texturePixelsPerSide: number = VANILLA_TEXTURE_SIZE_PX,
): ScaleClassification {
  assertPositiveInteger(edgeBlocks, "edgeBlocks");
  assertPositiveInteger(texturePixelsPerSide, "texturePixelsPerSide");

  if (edgeBlocks % texturePixelsPerSide === 0) {
    return { kind: "exact", blocksPerPixel: edgeBlocks / texturePixelsPerSide };
  }
  if (texturePixelsPerSide % edgeBlocks === 0) {
    return { kind: "reduced", pixelsPerBlock: texturePixelsPerSide / edgeBlocks };
  }
  return { kind: "distorted" };
}

/**
 * Lists every replica edge length, up to `maxEdgeBlocks`, that
 * {@link classifyScale} would call `"exact"` or `"reduced"` rather than
 * `"distorted"` — i.e. every scale-true size option for the picker.
 *
 * Output: ascending, deduplicated edge lengths. Always includes every
 * divisor of `texturePixelsPerSide` (down-scaled options) followed by
 * every multiple of it up to `maxEdgeBlocks` (up-scaled options).
 * Failure mode: throws `RangeError` for a non-positive or non-integer
 * `maxEdgeBlocks`.
 */
export function listScaleOptions(
  maxEdgeBlocks: number,
  texturePixelsPerSide: number = VANILLA_TEXTURE_SIZE_PX,
): number[] {
  assertPositiveInteger(maxEdgeBlocks, "maxEdgeBlocks");
  assertPositiveInteger(texturePixelsPerSide, "texturePixelsPerSide");

  const options = new Set<number>();
  for (let divisor = 1; divisor <= texturePixelsPerSide; divisor++) {
    if (texturePixelsPerSide % divisor === 0 && divisor <= maxEdgeBlocks) {
      options.add(divisor);
    }
  }
  for (
    let multiple = texturePixelsPerSide;
    multiple <= maxEdgeBlocks;
    multiple += texturePixelsPerSide
  ) {
    options.add(multiple);
  }
  return Array.from(options).sort((a, b) => a - b);
}

/**
 * How many blocks a hollow (surface-only) cube of this edge length
 * needs — the six faces, with no interior.
 *
 * Output: `edgeBlocks**3 - innerEdge**3`, where `innerEdge` is the
 * (possibly zero) edge of the hidden interior void.
 */
export function hollowBlockCount(edgeBlocks: number): number {
  assertPositiveInteger(edgeBlocks, "edgeBlocks");
  const innerEdge = Math.max(edgeBlocks - 2, 0);
  return edgeBlocks ** 3 - innerEdge ** 3;
}

/** How many blocks a fully solid cube of this edge length needs: `edgeBlocks**3`. */
export function solidBlockCount(edgeBlocks: number): number {
  assertPositiveInteger(edgeBlocks, "edgeBlocks");
  return edgeBlocks ** 3;
}
