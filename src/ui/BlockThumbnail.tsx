import type { DecodedTexture } from "../assets/textureDecoder.ts";
import type { Oklab } from "../domain/color.ts";
import { swatchColor } from "./swatchColor.ts";
import { useRenderedCanvas } from "./useRenderedCanvas.ts";

interface BlockThumbnailProps {
  /** The face to show. `undefined` falls back to a flat chip of {@link BlockThumbnailProps.averageColor}. */
  readonly texture: DecodedTexture | undefined;
  /** The block's own representative color, used when no texture is available. */
  readonly averageColor: Oklab;
}

/**
 * A tiny picture of one block, for naming it at a glance in a list.
 *
 * Prefers the block's real texture over its averaged color, because telling
 * cobblestone from andesite in a material list is exactly the job a single
 * flat gray chip cannot do.
 *
 * Falls back to that flat chip when a texture is missing, which
 * `buildReplica.ts` documents as unlikely but possible — a ragged column with
 * gaps in it would read as a rendering fault rather than as missing data.
 */
export function BlockThumbnail({ texture, averageColor }: BlockThumbnailProps) {
  if (texture === undefined) {
    return <span className="swatch" style={{ background: swatchColor(averageColor) }} />;
  }
  return <TextureThumbnail texture={texture} />;
}

/** Split out so the canvas hook is never called conditionally — the fallback above returns before any hook would run. */
function TextureThumbnail({ texture }: { readonly texture: DecodedTexture }) {
  const canvasRef = useRenderedCanvas(texture.width, texture.height, (imageData) => {
    imageData.data.set(texture.pixels);
  });
  return <canvas className="swatch" ref={canvasRef} width={texture.width} height={texture.height} />;
}
