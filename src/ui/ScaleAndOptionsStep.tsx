import { useMemo, useState } from "react";
import { classifyScale, hollowBlockCount, listScaleOptions, solidBlockCount, type ScaleClassification } from "../domain/scale.ts";
import type { FillStyle } from "../domain/shell.ts";

/** The three variance-weight choices offered in the picker — see `domain/shell.ts`'s `DEFAULT_VARIANCE_WEIGHT` for why `1` (not just any positive number) is the principled middle option. */
export const VARIANCE_WEIGHT_CHOICES = [
  { weight: 0, label: "Any block", hint: "Pure color match — a block's own texture noise is never a factor." },
  {
    weight: 1,
    label: "Prefer clean textures",
    hint: "Penalizes a busy/noisy block exactly as much as the blur it would actually add (recommended).",
  },
  {
    weight: 2.5,
    label: "Strongly prefer clean textures",
    hint: "Leans further toward flat blocks even at a slightly worse color match.",
  },
] as const;

export interface ScaleAndOptionsStepProps {
  readonly isReady: boolean;
  /** The selected source block's REAL texture resolution (16 for vanilla; see `ui/buildReplica.ts`'s `resolveSourceTexturePixelsPerSide`) — sizes are classified against this, not a hardcoded assumption, so a non-vanilla resource pack still gets correctly "exact" vs "distorted" labels. */
  readonly texturePixelsPerSide: number;
  readonly edgeBlocks: number | null;
  readonly onEdgeBlocksChange: (edgeBlocks: number) => void;
  readonly fillStyle: FillStyle;
  readonly onFillStyleChange: (fillStyle: FillStyle) => void;
  readonly varianceWeight: number;
  readonly onVarianceWeightChange: (varianceWeight: number) => void;
  /** Off by default — see `domain/dither.ts`'s header comment for the tradeoff this trades flat-but-off color for (a speckled look up close). */
  readonly ditherEnabled: boolean;
  readonly onDitherEnabledChange: (enabled: boolean) => void;
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
  texturePixelsPerSide,
  edgeBlocks,
  onEdgeBlocksChange,
  fillStyle,
  onFillStyleChange,
  varianceWeight,
  onVarianceWeightChange,
  ditherEnabled,
  onDitherEnabledChange,
}: ScaleAndOptionsStepProps) {
  const [customSizeText, setCustomSizeText] = useState("");

  // Only the upscaled ("exact") sizes are offered as default cards —
  // the downscaled ("reduced") ones lose real texture detail and are
  // rarely what someone wants for a GIANT block; they're still reachable
  // via the custom-size input below for anyone who does want one.
  // Depends on texturePixelsPerSide (not just DEFAULT_MAX_EDGE) because
  // a non-16px resource pack's own multiples/divisors differ from
  // vanilla's — recomputing per selected block keeps every card's
  // "exact" label actually true for THAT block's own texture.
  const scaleOptions = useMemo(
    () =>
      listScaleOptions(DEFAULT_MAX_EDGE, texturePixelsPerSide).filter(
        (edge) => classifyScale(edge, texturePixelsPerSide).kind === "exact",
      ),
    [texturePixelsPerSide],
  );

  const customSizeValue = Number.parseInt(customSizeText, 10);
  const customSizeIsValid = customSizeText.trim() !== "" && Number.isInteger(customSizeValue) && customSizeValue > 0;
  const customClassification = customSizeIsValid ? classifyScale(customSizeValue, texturePixelsPerSide) : null;

  return (
    <section className="step" data-disabled={!isReady}>
      <h2>
        <span className="step-number">3</span>
        Choose a size
      </h2>

      <div className="scale-grid">
        {scaleOptions.map((edge) => {
          const classification = classifyScale(edge, texturePixelsPerSide);
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
          {customSizeValue} doesn't divide or multiply {texturePixelsPerSide} evenly — the texture's pixel grid
          won't line up,
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
        <label title="Fills the inside with one cheap block instead of color-matching it — a hidden block has no 'right' color to match, so this skips gathering thousands of blocks nobody will ever see.">
          <input
            type="radio"
            name="fillStyle"
            checked={fillStyle === "solid-cheap-core"}
            onChange={() => onFillStyleChange("solid-cheap-core")}
          />
          Solid, cheap core (survives being dug into, cheap inside)
        </label>
        <label title="Every interior block is individually color-matched too, same as the surface — far more material for no visible difference.">
          <input
            type="radio"
            name="fillStyle"
            checked={fillStyle === "solid-full"}
            onChange={() => onFillStyleChange("solid-full")}
          />
          Solid, fully matched (much more material)
        </label>
      </div>

      <div className="fill-style-row">
        {VARIANCE_WEIGHT_CHOICES.map(({ weight, label, hint }) => (
          <label key={weight} title={hint}>
            <input
              type="radio"
              name="varianceWeight"
              checked={varianceWeight === weight}
              onChange={() => onVarianceWeightChange(weight)}
            />
            {label}
          </label>
        ))}
      </div>

      <div className="options-row">
        <label
          className="checkbox"
          title="Floyd-Steinberg dithering: lets neighbouring voxels alternate between two blocks so an area's AVERAGE color matches the source more closely, instead of every voxel in that area flatly picking the same one nearest block. More accurate from a distance; speckled up close."
        >
          <input
            type="checkbox"
            checked={ditherEnabled}
            onChange={(event) => onDitherEnabledChange(event.target.checked)}
          />
          Smooth color blending (dithering)
        </label>
      </div>
    </section>
  );
}
