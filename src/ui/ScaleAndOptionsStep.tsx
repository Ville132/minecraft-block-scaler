import { useMemo, useState } from "react";
import { DEFAULT_COLOR_TOLERANCE } from "../domain/color.ts";
import { DEFAULT_CONTRAST_GAIN } from "../domain/contrast.ts";
import { classifyScale, hollowBlockCount, listScaleOptions, solidBlockCount, type ScaleClassification } from "../domain/scale.ts";
import type { FillStyle } from "../domain/shell.ts";

/** The tolerance behind "Strongly prefer clean textures": a deliberately visible trade of color accuracy for texture, at 2.5x the default. */
const STRONG_COLOR_TOLERANCE = 0.05;

/** The three color-tolerance choices offered in the picker. What a tolerance MEANS is defined in `domain/color.ts`'s `MatchOptions.colorTolerance` (how much worse than the nearest color a block may be and still win on a flatter texture); these are the values it's offered at: `0` is plain nearest-color matching, `DEFAULT_COLOR_TOLERANCE` is about one just-noticeable difference, and `STRONG_COLOR_TOLERANCE` is a deliberately visible trade. */
export const COLOR_TOLERANCE_CHOICES = [
  {
    tolerance: 0,
    label: "Closest color, always",
    hint: "Always picks the single nearest-colored block, however busy its texture is.",
  },
  {
    tolerance: DEFAULT_COLOR_TOLERANCE,
    label: "Prefer clean textures",
    hint: `Accepts a block up to ${DEFAULT_COLOR_TOLERANCE} off in color — about one just-noticeable difference — if its texture is flatter (recommended).`,
  },
  {
    tolerance: STRONG_COLOR_TOLERANCE,
    label: "Strongly prefer clean textures",
    hint: `Accepts a visibly different block (up to ${STRONG_COLOR_TOLERANCE} off in color) in exchange for a flatter texture.`,
  },
] as const;

/** The contrast-enhancement choices offered in the picker. What a gain MEANS is defined in `domain/contrast.ts`'s `amplifyLightness`: it exaggerates each face's own light/dark pattern around that face's own average, so average colors never move. `1` is the default and means none. Stops at 2 — past that a face's darkest and lightest pixels start leaving their own color family, which defeats the purpose. */
export const CONTRAST_GAIN_CHOICES = [
  {
    gain: DEFAULT_CONTRAST_GAIN,
    label: "True colors",
    hint: "Every block matches its source pixel's actual color (recommended).",
  },
  {
    gain: 1.5,
    label: "Boost contrast",
    hint: "Pushes light and dark areas 50% further apart around each face's own average brightness. The average color of every face stays exactly the same.",
  },
  {
    gain: 2,
    label: "Strong contrast",
    hint: "Doubles the light/dark spread. Useful for a texture with very little pattern of its own; can push subtle shades into a neighbouring color family.",
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
  readonly colorTolerance: number;
  readonly onColorToleranceChange: (colorTolerance: number) => void;
  readonly contrastGain: number;
  readonly onContrastGainChange: (contrastGain: number) => void;
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
  colorTolerance,
  onColorToleranceChange,
  contrastGain,
  onContrastGainChange,
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
        {COLOR_TOLERANCE_CHOICES.map(({ tolerance, label }) => (
          <label key={tolerance}>
            <input
              type="radio"
              name="colorTolerance"
              checked={colorTolerance === tolerance}
              onChange={() => onColorToleranceChange(tolerance)}
            />
            {label}
          </label>
        ))}
      </div>
      {/* Was a title= tooltip on each radio — invisible on touch and unreachable by keyboard (BACKLOG.md 4.5). Shows the SELECTED option's own explanation rather than all three at once, so it stays useful context instead of a wall of text covering choices not even picked. */}
      <p className="hint-text">
        {COLOR_TOLERANCE_CHOICES.find((choice) => choice.tolerance === colorTolerance)?.hint}
      </p>

      <div className="fill-style-row">
        {CONTRAST_GAIN_CHOICES.map(({ gain, label }) => (
          <label key={gain}>
            <input
              type="radio"
              name="contrastGain"
              checked={contrastGain === gain}
              onChange={() => onContrastGainChange(gain)}
            />
            {label}
          </label>
        ))}
      </div>
      <p className="hint-text">{CONTRAST_GAIN_CHOICES.find((choice) => choice.gain === contrastGain)?.hint}</p>

      <div className="options-row">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={ditherEnabled}
            onChange={(event) => onDitherEnabledChange(event.target.checked)}
          />
          Smooth color blending (dithering)
        </label>
      </div>
      <p className="hint-text">
        Floyd-Steinberg dithering: neighbouring voxels alternate between nearby blocks so an area's AVERAGE color
        gets closer to the source. Each voxel stays close to its own pixel's color — it never jumps to a far-off
        block — but the result is speckled: more accurate from a distance, noisier up close.
      </p>

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
