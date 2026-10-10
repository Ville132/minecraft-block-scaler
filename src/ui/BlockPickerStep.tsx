import { useMemo, useState } from "react";
import type { AxisOrientation } from "../assets/modelResolver.ts";
import { matchesSearch, searchTermsFor } from "../domain/blockSearch.ts";
import type { PaletteBlock, PaletteOptions } from "../domain/palette.ts";
import { swatchColor } from "./swatchColor.ts";

export interface BlockPickerStepProps {
  readonly isReady: boolean;
  readonly isLoadingPalette: boolean;
  readonly palette: readonly PaletteBlock[];
  /** Axis-pillar blocks (logs, wood, basalt, quartz/purpur pillars, …), shown here so one of them can be picked as the scale source with an orientation choice — App.tsx also folds this list into fill material (see `domain/palette.ts`'s `listAxisVariantBlocks`), so excluding one from this picker would silently remove it from fill color-matching too. */
  readonly axisVariantBlocks: readonly PaletteBlock[];
  readonly options: PaletteOptions;
  readonly onOptionsChange: (options: PaletteOptions) => void;
  readonly selectedBlockId: string | null;
  readonly onSelectBlock: (blockId: string) => void;
  /** Non-null only while the selected block is from `axisVariantBlocks`. */
  readonly sourceBlockOrientation: AxisOrientation | null;
  readonly onOrientationChange: (orientation: AxisOrientation) => void;
  /** Restricts fill material to wood blocks only — unlike `options`, never hides a block from this picker, only from what can be used to color the build. */
  readonly onlyWoodFillMaterial: boolean;
  readonly onOnlyWoodFillMaterialChange: (value: boolean) => void;
  /** Excludes wool/hay/bookshelf/wood-family fill material (catches fire) — same picker-vs-fill distinction as `onlyWoodFillMaterial`. */
  readonly avoidFlammableFillMaterial: boolean;
  readonly onAvoidFlammableFillMaterialChange: (value: boolean) => void;
}

/**
 * Shows every block eligible either as the scale source or as fill
 * material — `palette` and `axisVariantBlocks` together, the latter
 * kept as a distinct prop only because picking one of THEM as the
 * source needs an orientation choice (below) that a `palette` entry
 * has no concept of. Both lists are also what App.tsx merges for fill
 * material (see `domain/palette.ts`'s `listAxisVariantBlocks`), so
 * this picker is a complete, accurate view of what the build can use.
 */
export function BlockPickerStep({
  isReady,
  isLoadingPalette,
  palette,
  axisVariantBlocks,
  options,
  onOptionsChange,
  selectedBlockId,
  onSelectBlock,
  sourceBlockOrientation,
  onOrientationChange,
  onlyWoodFillMaterial,
  onOnlyWoodFillMaterialChange,
  avoidFlammableFillMaterial,
  onAvoidFlammableFillMaterialChange,
}: BlockPickerStepProps) {
  const [search, setSearch] = useState("");

  const allBlocks = useMemo(
    () => [...palette, ...axisVariantBlocks].sort((a, b) => a.blockId.localeCompare(b.blockId)),
    [palette, axisVariantBlocks],
  );

  // Derived once per block list rather than per keystroke: the term sets
  // depend only on the ids, and this runs over every block on every
  // character typed.
  const searchTermsByBlockId = useMemo(
    () => new Map(allBlocks.map((block) => [block.blockId, searchTermsFor(block.blockId)])),
    [allBlocks],
  );

  const visibleBlocks = useMemo(() => {
    if (search.trim() === "") return allBlocks;
    return allBlocks.filter((block) => matchesSearch(searchTermsByBlockId.get(block.blockId)!, search));
  }, [allBlocks, searchTermsByBlockId, search]);

  const selectedIsAxisVariant = axisVariantBlocks.some((block) => block.blockId === selectedBlockId);

  return (
    <section className="step" data-disabled={!isReady}>
      <h2>
        <span className="step-number">2</span>
        Choose a block to scale
      </h2>

      {isLoadingPalette ? (
        <p className="spinner-text">Reading block textures…</p>
      ) : (
        <>
          <input
            type="text"
            placeholder="Search blocks… (try &quot;warped log&quot;)"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="block-search"
          />
          {allBlocks.length === 0 ? (
            isReady ? (
              <p className="error-text">
                No buildable blocks were found with the current options — try relaxing one of the toggles
                below.
              </p>
            ) : (
              <p className="hint-text">Upload a jar or resource pack above to see its blocks here.</p>
            )
          ) : (
            <>
              {search.trim() !== "" && (
                <p className="result-count">
                  {visibleBlocks.length} of {allBlocks.length} block{allBlocks.length === 1 ? "" : "s"} match
                  {visibleBlocks.length === 0 ? ` — nothing found for "${search.trim()}"` : ""}
                </p>
              )}
              <div className="block-grid">
                {visibleBlocks.map((block) => (
                  <button
                    key={block.blockId}
                    type="button"
                    className="block-tile"
                    data-selected={block.blockId === selectedBlockId}
                    onClick={() => onSelectBlock(block.blockId)}
                    title={`${block.resourceLocation} · texture variance ${block.textureVariance.toFixed(4)} (how busy/noisy its texture is — a flatter texture, lower here, is a cleaner stand-in for a solid color; see the "prefer clean textures" option in step 3)`}
                  >
                    <span className="swatch" style={{ background: swatchColor(block.color) }} />
                    <span className="label">{block.blockId}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {axisVariantBlocks.length > 0 && (
            <p className="hint-text">
              Logs and other pillar-shaped blocks can be built standing up or lying down — pick one to
              choose.
            </p>
          )}

          {selectedIsAxisVariant && (
            <div className="fill-style-row">
              <label>
                <input
                  type="radio"
                  name="sourceOrientation"
                  checked={sourceBlockOrientation === "upright"}
                  onChange={() => onOrientationChange("upright")}
                />
                Standing up
              </label>
              <label>
                <input
                  type="radio"
                  name="sourceOrientation"
                  checked={sourceBlockOrientation === "sideways"}
                  onChange={() => onOrientationChange("sideways")}
                />
                Lying down (rotate freely once placed)
              </label>
            </div>
          )}

          <div className="options-row">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={options.survivalFriendlyOnly}
                onChange={(event) =>
                  onOptionsChange({ ...options, survivalFriendlyOnly: event.target.checked })
                }
              />
              Survival-friendly only (hide netherite/diamond/gold/emerald/iron/lapis blocks)
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={options.allowGravityBlocks}
                onChange={(event) => onOptionsChange({ ...options, allowGravityBlocks: event.target.checked })}
              />
              Allow gravity blocks (sand, gravel)
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={options.allowBiomeTintedBlocks}
                onChange={(event) =>
                  onOptionsChange({ ...options, allowBiomeTintedBlocks: event.target.checked })
                }
              />
              Allow biome-tinted blocks (grass, leaves — coloured for a temperate biome)
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={onlyWoodFillMaterial}
                onChange={(event) => onOnlyWoodFillMaterialChange(event.target.checked)}
              />
              Only use wood as fill material (logs, wood, planks — any species)
            </label>
            <label className="checkbox" title="Excludes wool, hay, bookshelves, and wood-family blocks from fill material — they catch fire from a nearby flame.">
              <input
                type="checkbox"
                checked={avoidFlammableFillMaterial}
                onChange={(event) => onAvoidFlammableFillMaterialChange(event.target.checked)}
              />
              Avoid flammable fill material (wool, hay, wood — catches fire near lava or lightning)
            </label>
          </div>
        </>
      )}
    </section>
  );
}
