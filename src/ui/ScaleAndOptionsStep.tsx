import { useMemo, useState } from "react";
import { classifyScale, hollowBlockCount, listScaleOptions, solidBlockCount, type ScaleClassification } from "../domain/scale.ts";
import type { FillStyle } from "../domain/shell.ts";

export interface ScaleAndOptionsStepProps {
  readonly isReady: boolean;
  readonly edgeBlocks: number | null;
  readonly onEdgeBlocksChange: (edgeBlocks: number) => void;
  readonly fillStyle: FillStyle;
  readonly onFillStyleChange: (fillStyle: FillStyle) => void;
}

const DEFAULT_MAX_EDGE = 128;
/** Above this many blocks, a synchronous client-side build would noticeably freeze the browser (there is no background worker — see PLAN.md's step 10, which explicitly allows cutting lower-priority polish first). */
const MAX_VOXELS_BEFORE_WARNING = 4_000_000;

function blockCountFor(edgeBlocks: number, fillStyle: FillStyle): number {
  return fillStyle === "hollow" ? hollowBlockCount(edgeBlocks) : solidBlockCount(edgeBlocks);
}

/** `listScaleOptions` never offers a "distorted" size, but `classifyScale`'s return type covers it anyway — handled exhaustively here rather than assumed away. */
function fidelityLabel(classification: ScaleClassification): string {
  switch (classification.kind) {
    case "exact":
      return `exact · ${classification.blocksPerPixel}×${classification.blocksPerPixel} per pixel`;
    case "reduced":
      return `reduced · ${classification.pixelsPerBlock}×${classification.pixelsPerBlock}px/block`;
    case "distorted":
      return "distorted";
  }
}

export function ScaleAndOptionsStep({
  isReady,
  edgeBlocks,
  onEdgeBlocksChange,
  fillStyle,
  onFillStyleChange,
}: ScaleAndOptionsStepProps) {
  const [customSizeText, setCustomSizeText] = useState("");

  const scaleOptions = useMemo(() => listScaleOptions(DEFAULT_MAX_EDGE), []);

  const customSizeValue = Number.parseInt(customSizeText, 10);
  const customSizeIsValid = customSizeText.trim() !== "" && Number.isInteger(customSizeValue) && customSizeValue > 0;
  const customClassification = customSizeIsValid ? classifyScale(customSizeValue) : null;

  return (
    <section className="step" data-disabled={!isReady}>
      <h2>
        <span className="step-number">3</span>
        Choose a size
      </h2>

      <div className="scale-grid">
        {scaleOptions.map((edge) => {
          const classification = classifyScale(edge);
          const hollow = hollowBlockCount(edge);
          const solid = solidBlockCount(edge);
          return (
            <button
              key={edge}
              type="button"
              className="scale-card"
              data-selected={edge === edgeBlocks}
              onClick={() => onEdgeBlocksChange(edge)}
            >
              <div className="edge">{edge}³</div>
              <span className={`fidelity ${classification.kind}`}>{fidelityLabel(classification)}</span>
              <div className="counts">
                hollow: {hollow.toLocaleString()}
                <br />
                solid: {solid.toLocaleString()}
              </div>
            </button>
          );
        })}
      </div>

      <div className="options-row" style={{ alignItems: "center" }}>
        <span className="hint-text">Need a size outside the list above?</span>
        <input
          type="number"
          min={1}
          placeholder="custom size"
          value={customSizeText}
          onChange={(event) => setCustomSizeText(event.target.value)}
          style={{ width: 110 }}
        />
        <button
          type="button"
          disabled={!customSizeIsValid}
          onClick={() => onEdgeBlocksChange(customSizeValue)}
        >
          Use this size
        </button>
      </div>
      {customClassification?.kind === "distorted" && (
        <p className="error-text">
          {customSizeValue} doesn't divide or multiply 16 evenly — the texture's pixel grid won't line up,
          so the replica will look smeared rather than a clean scaled-up version. The sizes listed above all
          keep the original look.
        </p>
      )}
      {customSizeIsValid && blockCountFor(customSizeValue, fillStyle) > MAX_VOXELS_BEFORE_WARNING && (
        <p className="error-text">
          That's {blockCountFor(customSizeValue, fillStyle).toLocaleString()} blocks — large enough to
          freeze your browser for a while when building. Consider a smaller size.
        </p>
      )}

      <div className="fill-style-row">
        <label>
          <input
            type="radio"
            name="fillStyle"
            checked={fillStyle === "hollow"}
            onChange={() => onFillStyleChange("hollow")}
          />
          Hollow shell (less material, same outside appearance)
        </label>
        <label>
          <input
            type="radio"
            name="fillStyle"
            checked={fillStyle === "solid"}
            onChange={() => onFillStyleChange("solid")}
          />
          Solid (much more material, survives being dug into)
        </label>
      </div>
    </section>
  );
}
