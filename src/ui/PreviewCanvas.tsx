import { useEffect, useMemo, useRef } from "react";
import { oklabToRgb8 } from "../domain/color.ts";
import type { CubeFaceDirection } from "../domain/faces.ts";
import { positionOnFace, type Voxel } from "../domain/shell.ts";
import type { DecodedTexture } from "../assets/textureDecoder.ts";

const DISPLAY_SIZE_PX = 220;

function useRenderedCanvas(width: number, height: number, draw: (imageData: ImageData) => void) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const context = canvas.getContext("2d");
    if (context === null) return;
    const imageData = context.createImageData(width, height);
    draw(imageData);
    context.putImageData(imageData, 0, 0);
    // `draw` must stay in the dependency list even though `width`/
    // `height` are listed too: switching, say, the previewed face can
    // change `draw`'s captured data (a different texture or direction)
    // while leaving the canvas's own dimensions unchanged, and only
    // `draw`'s identity (a fresh closure each render) catches that.
  }, [width, height, draw]);
  return canvasRef;
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
    <canvas
      ref={canvasRef}
      width={texture.width}
      height={texture.height}
      style={{ width: DISPLAY_SIZE_PX, height: DISPLAY_SIZE_PX }}
    />
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
  return (
    <canvas
      ref={canvasRef}
      width={edgeBlocks}
      height={edgeBlocks}
      style={{ width: DISPLAY_SIZE_PX, height: DISPLAY_SIZE_PX }}
    />
  );
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
  readonly usedBlockTextures: ReadonlyMap<string, DecodedTexture>;
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

        const texture = usedBlockTextures.get(voxel.paletteBlock.blockId);
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

  return (
    <canvas
      ref={canvasRef}
      width={canvasSizePx}
      height={canvasSizePx}
      style={{ width: DISPLAY_SIZE_PX, height: DISPLAY_SIZE_PX }}
    />
  );
}

export interface PreviewCanvasProps {
  readonly direction: CubeFaceDirection;
  readonly edgeBlocks: number;
  readonly voxels: readonly Voxel[];
  readonly sourceFaceTexture: DecodedTexture;
  readonly usedBlockTextures: ReadonlyMap<string, DecodedTexture>;
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
    <div className="preview-row">
      <div className="preview-col">
        <span className="caption">Original texture ({direction})</span>
        <OriginalTextureCanvas texture={sourceFaceTexture} />
      </div>
      <div className="preview-col">
        <span className="caption">Replica face — real textures ({edgeBlocks}×{edgeBlocks})</span>
        <RealisticReplicaFaceCanvas
          direction={direction}
          edgeBlocks={edgeBlocks}
          voxelByPosition={voxelByPosition}
          usedBlockTextures={usedBlockTextures}
        />
      </div>
      <div className="preview-col">
        <span className="caption">Replica face — average color ({edgeBlocks}×{edgeBlocks})</span>
        <ReplicaFaceCanvas direction={direction} edgeBlocks={edgeBlocks} voxelByPosition={voxelByPosition} />
      </div>
    </div>
  );
}
