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

/** The default cap offered by the "limit distinct materials" control — the middle of BACKLOG.md 1.1's suggested 8-16 range. Purely a UI starting point; `domain/consolidate.ts` places no meaning on this specific number. */
export const DEFAULT_MAX_DISTINCT_BLOCKS = 12;

export interface ScaleAndOptionsStepProps {
  readonly isReady: boolean;
  /** The selected source block, shown in this step's own heading so scrolling past step 2 doesn't lose track of what's actually being scaled — `null` before anything is picked. */
  readonly sourceBlockId: string | null;
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
  /** `null` means no cap — see `domain/consolidate.ts`'s `consolidateVoxels`. */
  readonly maxDistinctBlocks: number | null;
  readonly onMaxDistinctBlocksChange: (maxDistinctBlocks: number | null) => void;
}

const DEFAULT_MAX_EDGE = 128;
/** Above this many blocks, a synchronous client-side build would noticeably freeze the browser (there is no background worker — see PLAN.md's step 10, which explicitly allows cutting lower-priority polish first). Applies to any selected size — a preset card as much as a custom one — since the freeze risk only depends on the resulting block count, not on how that size was picked. */
const MAX_VOXELS_BEFORE_WARNING = 1_000_000;
/** The largest custom edge length this app accepts. Not a soft guideline like `MAX_VOXELS_BEFORE_WARNING` above — `writeSchematic.ts` packs `edgeBlocks ** 3` into a signed 32-bit NBT int, which overflows into a negative, corrupt `TotalVolume` around 1291; this cap stays comfortably under that, and well under it a solid build there is already tens of millions of blocks, deep into "the tab will hang" territory anyway. */
const MAX_CUSTOM_EDGE_BLOCKS = 1024;

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
  sourceBlockId,
  texturePixelsPerSide,
  edgeBlocks,
  onEdgeBlocksChange,
  fillStyle,
  onFillStyleChange,
  varianceWeight,
  onVarianceWeightChange,
  ditherEnabled,
  onDitherEnabledChange,
  maxDistinctBlocks,
  onMaxDistinctBlocksChange,
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
  const customSizeIsInRange =
    customSizeText.trim() !== "" && Number.isInteger(customSizeValue) && customSizeValue > 0;
  const customSizeIsValid = customSizeIsInRange && customSizeValue <= MAX_CUSTOM_EDGE_BLOCKS;
  const customClassification = customSizeIsValid ? classifyScale(customSizeValue, texturePixelsPerSide) : null;

  return (
    <section className="step" data-disabled={!isReady}>
      <h2>
        <span className="step-number">3</span>
        Choose a size
        {sourceBlockId !== null && <span className="step-context">scaling {sourceBlockId}</span>}
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
          max={MAX_CUSTOM_EDGE_BLOCKS}
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
      {customSizeIsInRange && customSizeValue > MAX_CUSTOM_EDGE_BLOCKS && (
        <p className="error-text">
          {MAX_CUSTOM_EDGE_BLOCKS} is the largest size this app supports — the schematic format's own block-count
          field can't represent anything bigger. Pick {MAX_CUSTOM_EDGE_BLOCKS} or smaller.
        </p>
      )}
      {customClassification?.kind === "distorted" && (
        <p className="error-text">
          {customSizeValue} doesn't divide or multiply {texturePixelsPerSide} evenly — the texture's pixel grid
          won't line up,
          so the replica will look smeared rather than a clean scaled-up version. The sizes listed above all
          keep the original look.
        </p>
      )}
      {edgeBlocks !== null && blockCountFor(edgeBlocks, fillStyle) > MAX_VOXELS_BEFORE_WARNING && (
        <p className="error-text">
          That's {blockCountFor(edgeBlocks, fillStyle).toLocaleString()} blocks — large enough to freeze your
          browser for a while when building. Consider a smaller size{fillStyle !== "hollow" ? " or the hollow-shell fill style" : ""}.
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

      <div className="options-row" style={{ alignItems: "center" }}>
        <label
          className="checkbox"
          title="Keeps only the N most-used blocks in the finished build and reassigns every voxel that used a dropped block to whichever surviving block is now closest in color. A build with dozens of distinct block types, many used only a handful of times, is hard to finish by hand — this trades a little color accuracy for far fewer materials to go find."
        >
          <input
            type="checkbox"
            checked={maxDistinctBlocks !== null}
            onChange={(event) =>
              onMaxDistinctBlocksChange(event.target.checked ? DEFAULT_MAX_DISTINCT_BLOCKS : null)
            }
          />
          Limit distinct materials to
        </label>
        <input
          type="number"
          min={1}
          disabled={maxDistinctBlocks === null}
          value={maxDistinctBlocks ?? DEFAULT_MAX_DISTINCT_BLOCKS}
          onChange={(event) => {
            const parsed = Number.parseInt(event.target.value, 10);
            if (Number.isInteger(parsed) && parsed > 0) onMaxDistinctBlocksChange(parsed);
          }}
          style={{ width: 60 }}
        />
      </div>
    </section>
  );
}
