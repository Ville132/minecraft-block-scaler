import { useMemo } from "react";
import { oklabToRgb8 } from "../domain/color.ts";
import type { CubeFaceDirection } from "../domain/faces.ts";
import { positionOnFace, type Voxel } from "../domain/shell.ts";
import type { DecodedTexture } from "../assets/textureDecoder.ts";
import { useRenderedCanvas } from "./useRenderedCanvas.ts";

/**
 * The narrowest a preview canvas is ever laid out at — see `.preview-grid` in
 * `app.css`, whose track minimum this mirrors.
 *
 * It is the threshold for {@link scalingOf}: a backing store no wider than
 * this is guaranteed to be drawn larger than it is, whatever the viewport.
 */
const MIN_PREVIEW_DISPLAY_PX = 240;

/**
 * Whether a canvas of `backingSizePx` will be drawn larger than life, which
 * decides how the browser should fill in between its pixels.
 *
 * Blowing one texel up to a visible square is the whole point of these views,
 * so an upscaled canvas must stay hard-edged (`pixelated`). Shrinking one is
 * the opposite case: nearest-neighbour DOWNsampling just throws pixels away
 * and aliases what is left, so a dense canvas is left to interpolate
 * smoothly. The 512px realistic view squeezed into 220px used to do exactly
 * that, and came out visibly grainier than the two views beside it.
 */
function scalingOf(backingSizePx: number): "up" | "down" {
  return backingSizePx <= MIN_PREVIEW_DISPLAY_PX ? "up" : "down";
}

interface OriginalTextureCanvasProps {
  readonly texture: DecodedTexture;
}

/** The source block's own texture, shown at the same on-screen size as the replica preview so the two are directly comparable. */
function OriginalTextureCanvas({ texture }: OriginalTextureCanvasProps) {
  const canvasRef = useRenderedCanvas(texture.width, texture.height, (imageData) => {
    imageData.data.set(texture.pixels);
  });
  return (
    <canvas ref={canvasRef} width={texture.width} height={texture.height} data-scaling={scalingOf(texture.width)} />
  );
}

interface ReplicaFaceCanvasProps {
  readonly direction: CubeFaceDirection;
  readonly edgeBlocks: number;
  readonly voxelByPosition: ReadonlyMap<string, Voxel>;
}

/** The replica's face, one pixel per voxel, read straight off the resolved voxel grid — see `positionOnFace`'s doc comment for why this already reflects the edge-ownership rule with no extra logic here. Each voxel renders as its chosen block's flat AVERAGED color — a quick, exact view of what the color-matcher resolved, but see `RealisticReplicaFaceCanvas` below for what the block actually looks like close up. */
function ReplicaFaceCanvas({ direction, edgeBlocks, voxelByPosition }: ReplicaFaceCanvasProps) {
  const canvasRef = useRenderedCanvas(edgeBlocks, edgeBlocks, (imageData) => {
    for (let v = 0; v < edgeBlocks; v++) {
      for (let u = 0; u < edgeBlocks; u++) {
        const { x, y, z } = positionOnFace(direction, u, v, edgeBlocks);
        const voxel = voxelByPosition.get(`${x},${y},${z}`);
        const pixelIndex = (v * edgeBlocks + u) * 4;
        if (voxel === undefined) continue; // geometrically unreachable: every face position is on the shell
        const { r, g, b } = oklabToRgb8(voxel.paletteBlock.color);
        imageData.data[pixelIndex] = r;
        imageData.data[pixelIndex + 1] = g;
        imageData.data[pixelIndex + 2] = b;
        imageData.data[pixelIndex + 3] = 255;
      }
    }
  });
  return <canvas ref={canvasRef} width={edgeBlocks} height={edgeBlocks} data-scaling={scalingOf(edgeBlocks)} />;
}

/** The realistic preview's own canvas pixel budget — independent of `edgeBlocks`, which can run into the hundreds. Large enough to show real texture detail per voxel tile, small enough to stay a fast, synchronous `putImageData` call. */
const MAX_REALISTIC_CANVAS_PX = 512;
const MIN_TILE_PX = 1;

interface GridSampling {
  /** How many replica voxels apart each sampled column/row is — 1 samples every voxel; >1 skips some so edge counts far beyond the pixel budget (an unusually large custom size) still render, just coarser. */
  readonly stride: number;
  /** How many columns/rows are actually sampled and drawn — `ceil(edgeBlocks / stride)`. */
  readonly sampledCells: number;
  /** How many canvas pixels wide/tall one sampled voxel's own tile is. */
  readonly tilePx: number;
}

function computeGridSampling(edgeBlocks: number): GridSampling {
  if (edgeBlocks <= MAX_REALISTIC_CANVAS_PX) {
    return { stride: 1, sampledCells: edgeBlocks, tilePx: Math.max(MIN_TILE_PX, Math.floor(MAX_REALISTIC_CANVAS_PX / edgeBlocks)) };
  }
  const stride = Math.ceil(edgeBlocks / MAX_REALISTIC_CANVAS_PX);
  return { stride, sampledCells: Math.ceil(edgeBlocks / stride), tilePx: MIN_TILE_PX };
}

/** One pixel of `texture`, nearest-sampled as if `texture` were scaled to exactly `tileSizePx` square and read at `(tileX, tileY)` — the standard "pixelated" scaling this app already uses in CSS for every other texture canvas, done here in JS because `putImageData` has no scaling of its own. */
function sampleTexturePixel(
  texture: DecodedTexture,
  tileX: number,
  tileY: number,
  tileSizePx: number,
): { readonly r: number; readonly g: number; readonly b: number } {
  const sourceX = Math.min(texture.width - 1, Math.floor((tileX * texture.width) / tileSizePx));
  const sourceY = Math.min(texture.height - 1, Math.floor((tileY * texture.height) / tileSizePx));
  const pixelIndex = (sourceY * texture.width + sourceX) * 4;
  return { r: texture.pixels[pixelIndex]!, g: texture.pixels[pixelIndex + 1]!, b: texture.pixels[pixelIndex + 2]! };
}

interface RealisticReplicaFaceCanvasProps {
  readonly direction: CubeFaceDirection;
  readonly edgeBlocks: number;
  readonly voxelByPosition: ReadonlyMap<string, Voxel>;
  readonly usedBlockTextures: ReadonlyMap<string, Readonly<Record<CubeFaceDirection, DecodedTexture>>>;
}

/**
 * The replica's face rendered as what it would actually look like built
 * from real blocks: each voxel's tile shows a nearest-sampled thumbnail
 * of its CHOSEN block's own texture (see `ui/buildReplica.ts`'s
 * `usedBlockTextures`), not that block's flat averaged color.
 *
 * This is the one view that can actually reveal the failure mode a flat
 * color preview cannot: a wall of one visually noisy block previews as
 * a clean, plausible flat color in {@link ReplicaFaceCanvas}, but shows
 * up here exactly as busy as it will look in-game.
 *
 * A voxel whose block has no resolved texture (rare — see
 * `usedBlockTextures`'s own doc comment) falls back to that block's
 * flat averaged color for just that one tile, same as every tile looked
 * before this view existed.
 */
function RealisticReplicaFaceCanvas({
  direction,
  edgeBlocks,
  voxelByPosition,
  usedBlockTextures,
}: RealisticReplicaFaceCanvasProps) {
  const { stride, sampledCells, tilePx } = useMemo(() => computeGridSampling(edgeBlocks), [edgeBlocks]);
  const canvasSizePx = sampledCells * tilePx;

  const canvasRef = useRenderedCanvas(canvasSizePx, canvasSizePx, (imageData) => {
    for (let vi = 0; vi < sampledCells; vi++) {
      const v = Math.min(edgeBlocks - 1, vi * stride);
      for (let ui = 0; ui < sampledCells; ui++) {
        const u = Math.min(edgeBlocks - 1, ui * stride);
        const { x, y, z } = positionOnFace(direction, u, v, edgeBlocks);
        const voxel = voxelByPosition.get(`${x},${y},${z}`);
        if (voxel === undefined) continue; // geometrically unreachable: every face position is on the shell

        const texture = usedBlockTextures.get(voxel.paletteBlock.blockId)?.[direction];
        for (let dy = 0; dy < tilePx; dy++) {
          for (let dx = 0; dx < tilePx; dx++) {
            const { r, g, b } =
              texture === undefined ? oklabToRgb8(voxel.paletteBlock.color) : sampleTexturePixel(texture, dx, dy, tilePx);
            const canvasX = ui * tilePx + dx;
            const canvasY = vi * tilePx + dy;
            const pixelIndex = (canvasY * canvasSizePx + canvasX) * 4;
            imageData.data[pixelIndex] = r;
            imageData.data[pixelIndex + 1] = g;
            imageData.data[pixelIndex + 2] = b;
            imageData.data[pixelIndex + 3] = 255;
          }
        }
      }
    }
  });

  return <canvas ref={canvasRef} width={canvasSizePx} height={canvasSizePx} data-scaling={scalingOf(canvasSizePx)} />;
}

export interface PreviewCanvasProps {
  readonly direction: CubeFaceDirection;
  readonly edgeBlocks: number;
  readonly voxels: readonly Voxel[];
  readonly sourceFaceTexture: DecodedTexture;
  readonly usedBlockTextures: ReadonlyMap<string, Readonly<Record<CubeFaceDirection, DecodedTexture>>>;
}

export function PreviewCanvas({
  direction,
  edgeBlocks,
  voxels,
  sourceFaceTexture,
  usedBlockTextures,
}: PreviewCanvasProps) {
  const voxelByPosition = useMemo(() => {
    const map = new Map<string, Voxel>();
    for (const voxel of voxels) map.set(`${voxel.x},${voxel.y},${voxel.z}`, voxel);
    return map;
  }, [voxels]);

  return (
    <div className="preview-grid">
      <figure className="preview-col">
        <RealisticReplicaFaceCanvas
          direction={direction}
          edgeBlocks={edgeBlocks}
          voxelByPosition={voxelByPosition}
          usedBlockTextures={usedBlockTextures}
        />
        <figcaption className="caption">
          Your replica <span>real block textures, {edgeBlocks}×{edgeBlocks}</span>
        </figcaption>
      </figure>
      <figure className="preview-col">
        <ReplicaFaceCanvas direction={direction} edgeBlocks={edgeBlocks} voxelByPosition={voxelByPosition} />
        <figcaption className="caption">
          Colors only <span>one flat color per block, {edgeBlocks}×{edgeBlocks}</span>
        </figcaption>
      </figure>
      <figure className="preview-col">
        <OriginalTextureCanvas texture={sourceFaceTexture} />
        <figcaption className="caption">
          Original block <span>what you are copying, {direction}</span>
        </figcaption>
      </figure>
    </div>
  );
}
