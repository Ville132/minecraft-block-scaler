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

/** The replica's face, one pixel per voxel, read straight off the resolved voxel grid — see `positionOnFace`'s doc comment for why this already reflects the edge-ownership rule with no extra logic here. */
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

export interface PreviewCanvasProps {
  readonly direction: CubeFaceDirection;
  readonly edgeBlocks: number;
  readonly voxels: readonly Voxel[];
  readonly sourceFaceTexture: DecodedTexture;
}

export function PreviewCanvas({ direction, edgeBlocks, voxels, sourceFaceTexture }: PreviewCanvasProps) {
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
        <span className="caption">
          Replica face ({edgeBlocks}×{edgeBlocks})
        </span>
        <ReplicaFaceCanvas direction={direction} edgeBlocks={edgeBlocks} voxelByPosition={voxelByPosition} />
      </div>
    </div>
  );
}
