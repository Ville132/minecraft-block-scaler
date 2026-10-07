import { useEffect, useRef } from "react";

/**
 * Paints a canvas of exactly `width` x `height` backing pixels by handing
 * `draw` a blank `ImageData` to fill, then blitting it in one
 * `putImageData` call.
 *
 * Every pixel view in this app is nearest-neighbour by nature — one source
 * texel or one voxel per backing pixel, scaled up by CSS — so there is
 * nothing to interpolate and no reason to go through `drawImage`.
 *
 * Inputs: the backing-store dimensions, and `draw`, which mutates the
 * `ImageData` it is given.
 * Output: a ref to attach to the `<canvas>`; its `width`/`height`
 * attributes must match the dimensions passed here.
 * Failure modes: silently does nothing if the ref is unattached or the 2D
 * context is unavailable — there is no partial state to recover from and
 * nothing a caller could do about either.
 */
export function useRenderedCanvas(
  width: number,
  height: number,
  draw: (imageData: ImageData) => void,
): React.RefObject<HTMLCanvasElement | null> {
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
