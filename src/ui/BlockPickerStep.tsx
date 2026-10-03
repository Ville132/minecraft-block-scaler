import { useMemo, useState } from "react";
import type { PaletteBlock, PaletteOptions } from "../domain/palette.ts";
import { swatchColor } from "./swatchColor.ts";

export interface BlockPickerStepProps {
  readonly isReady: boolean;
  readonly isLoadingPalette: boolean;
  readonly palette: readonly PaletteBlock[];
  readonly options: PaletteOptions;
  readonly onOptionsChange: (options: PaletteOptions) => void;
  readonly selectedBlockId: string | null;
  readonly onSelectBlock: (blockId: string) => void;
}

/**
 * The same palette serves two roles: which block to scale up, and
 * which blocks are allowed as replacement material for the rest (see
 * `ui/buildReplica.ts`'s header comment for why one list is enough).
 */
export function BlockPickerStep({
  isReady,
  isLoadingPalette,
  palette,
  options,
  onOptionsChange,
  selectedBlockId,
  onSelectBlock,
}: BlockPickerStepProps) {
  const [search, setSearch] = useState("");

  const visibleBlocks = useMemo(() => {
    const query = search.trim().toLowerCase();
    const sorted = [...palette].sort((a, b) => a.blockId.localeCompare(b.blockId));
    return query === "" ? sorted : sorted.filter((block) => block.blockId.includes(query));
  }, [palette, search]);

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
            placeholder="Search blocks…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            style={{ marginBottom: 10, width: 220 }}
          />
          {palette.length === 0 ? (
            <p className="error-text">
              No buildable blocks were found with the current options — try relaxing one of the toggles
              below.
            </p>
          ) : (
            <div className="block-grid">
              {visibleBlocks.map((block) => (
                <button
                  key={block.blockId}
                  type="button"
                  className="block-tile"
                  data-selected={block.blockId === selectedBlockId}
                  onClick={() => onSelectBlock(block.blockId)}
                  title={block.resourceLocation}
                >
                  <span className="swatch" style={{ background: swatchColor(block.color) }} />
                  <span className="label">{block.blockId}</span>
                </button>
              ))}
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
              Allow biome-tinted blocks (grass, leaves)
            </label>
          </div>
        </>
      )}
    </section>
  );
}
