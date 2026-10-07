import { useMemo, useState } from "react";
import { CUBE_FACE_DIRECTIONS, type CubeFaceDirection } from "../domain/faces.ts";
import { buildLayerBreakdown, summarizeMaterialList } from "../domain/materials.ts";
import { BlockThumbnail } from "./BlockThumbnail.tsx";
import type { BuildReplicaResult } from "./buildReplica.ts";
import { downloadBytes, downloadText } from "./download.ts";
import { materialListToCsv, materialListToText } from "./materialListExport.ts";
import { PreviewCanvas } from "./PreviewCanvas.tsx";
import { useCountUp } from "./useCountUp.ts";

/** What to type into the Windows Run dialog (Win+R) to jump straight to the schematics folder — same trick as `ArchiveUploadStep.tsx`'s `WINDOWS_RUN_PATH`, pointed at the sibling `schematics` folder instead of `versions/26.3`. */
const WINDOWS_SCHEMATICS_RUN_PATH = String.raw`%appdata%\.minecraft\schematics`;

/** `{ facing: "north", half: "top" }` -> `"facing=north, half=top"` for the material table's Properties column — a comma reads more naturally in prose than `materialListExport.ts`'s `;`-joined CSV cells, so this is kept separate rather than shared. */
function formatPropertiesForDisplay(properties: Readonly<Record<string, string>> | undefined): string {
  if (properties === undefined) return "–";
  return Object.entries(properties)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

/** One headline figure from the finished build. The number counts up on reveal — see `useCountUp` for why that one animation is JavaScript rather than CSS. */
function Stat({ value, label }: { readonly value: number; readonly label: string }) {
  const displayed = useCountUp(value);
  return (
    <div className="stat">
      <span className="stat-value">{displayed.toLocaleString()}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export interface ResultPanelProps {
  readonly result: BuildReplicaResult;
  readonly edgeBlocks: number;
}

export function ResultPanel({ result, edgeBlocks }: ResultPanelProps) {
  const [previewFace, setPreviewFace] = useState<CubeFaceDirection>("up");
  const [windowsPathCopied, setWindowsPathCopied] = useState(false);
  const [materialListCopied, setMaterialListCopied] = useState(false);
  const totalBlocks = result.voxels.length;

  const totals = useMemo(() => summarizeMaterialList(result.materialList), [result.materialList]);
  const layers = useMemo(() => buildLayerBreakdown(result.voxels), [result.voxels]);
  // `MaterialListEntry` carries no color, so the fallback chip for a block
  // whose texture is missing is sourced from the voxels the list was built
  // from — which necessarily covers every block the list can name.
  const colorByBlockId = useMemo(
    () => new Map(result.voxels.map((voxel) => [voxel.paletteBlock.blockId, voxel.paletteBlock.color])),
    [result.voxels],
  );
  // Every other download this panel offers is named after the build
  // (schematicFileName's own "<sourceBlockId>_x<edgeBlocks>" stem) so
  // that building several configs from the same source block doesn't
  // collide into "material-list(2).txt" with no way to tell them apart.
  const fileStem = result.fileName.replace(/\.litematic$/, "");

  async function handleCopyWindowsPath(): Promise<void> {
    try {
      await navigator.clipboard.writeText(WINDOWS_SCHEMATICS_RUN_PATH);
      setWindowsPathCopied(true);
      setTimeout(() => setWindowsPathCopied(false), 2000);
    } catch {
      // Same reasoning as ArchiveUploadStep.tsx's identical handler:
      // clipboard access can be denied, and the path is still shown as
      // plain text right next to the button either way.
    }
  }

  async function handleCopyMaterialList(): Promise<void> {
    try {
      await navigator.clipboard.writeText(materialListToText(result.materialList));
      setMaterialListCopied(true);
      setTimeout(() => setMaterialListCopied(false), 2000);
    } catch {
      // Clipboard access can be denied — the .txt/.csv downloads below
      // are always available as a fallback way to get the same data out.
    }
  }

  return (
    <section className="step step-result">
      <h2>
        <span className="step-number">5</span>
        Your replica
        <span className="step-context">
          {edgeBlocks}³ · {result.fileName}
        </span>
      </h2>

      <div className="stat-row">
        <Stat value={totalBlocks} label="blocks total" />
        <Stat value={result.materialList.length} label={`block type${result.materialList.length === 1 ? "" : "s"}`} />
        <Stat value={totals.shulkerBoxes} label={`shulker box${totals.shulkerBoxes === 1 ? "" : "es"}`} />
        <Stat value={totals.inventoryLoads} label={`inventory trip${totals.inventoryLoads === 1 ? "" : "s"}`} />
        <Stat value={totals.recommendedWithSpares} label="gather with ~10% spare" />
      </div>

      {result.interiorFillBlockId !== null && (
        <p className="hint-text">
          The hidden interior uses <code>{result.interiorFillBlockId}</code> — cheap and never visible, so it
          wasn't color-matched.
        </p>
      )}

      {result.contrastHeadroom.isLowContrast && (
        <p className="callout">
          Some faces of this block have only a faint light/dark pattern of their own, so the replica of them can
          read as nearly flat. "Boost contrast" in the options above exaggerates whatever pattern there is,
          while keeping each face's average color exactly as it was.
        </p>
      )}

      {result.consolidation !== null && (
        <p className="callout">
          Capped at {result.consolidation.consolidatedBlockCount} of{" "}
          {result.consolidation.originalBlockCount} distinct blocks — voxels that lost their block were
          reassigned to the closest survivor (average color shift: {result.consolidation.averageColorErrorIntroduced.toFixed(3)}
          , in Oklab distance).
        </p>
      )}

      <h2 className="preview-heading">Preview</h2>
      <div className="face-tabs">
        {CUBE_FACE_DIRECTIONS.map((direction) => (
          <button
            key={direction}
            type="button"
            data-active={direction === previewFace}
            onClick={() => setPreviewFace(direction)}
          >
            {direction}
          </button>
        ))}
      </div>
      <PreviewCanvas
        direction={previewFace}
        edgeBlocks={edgeBlocks}
        voxels={result.voxels}
        sourceFaceTexture={result.sourceFaceTextures[previewFace]}
        usedBlockTextures={result.usedBlockTextures}
      />

      <h2 className="preview-heading">Materials</h2>
      <div className="material-table-wrap">
        <table className="material-table">
          <thead>
            <tr>
              <th>Block</th>
              <th className="count">Count</th>
              <th className="count">Shulkers</th>
              <th className="count">Stacks</th>
              <th className="count">Loose</th>
              <th>Properties</th>
            </tr>
          </thead>
          <tbody>
            {result.materialList.map((entry) => (
              <tr key={entry.blockId}>
                <td className="block-name">
                  <span className="block-cell">
                    <BlockThumbnail
                      texture={result.usedBlockTextures.get(entry.blockId)?.up}
                      // Safe to assert: the material list is derived from these
                      // very voxels, so it cannot name a block they don't contain.
                      averageColor={colorByBlockId.get(entry.blockId)!}
                    />
                    {entry.resourceLocation}
                  </span>
                </td>
                <td className="count primary">{entry.count.toLocaleString()}</td>
                <td className="count">{entry.breakdown.shulkerBoxes || "–"}</td>
                <td className="count">{entry.breakdown.stacks || "–"}</td>
                <td className="count">{entry.breakdown.singles || "–"}</td>
                <td className="block-name">{formatPropertiesForDisplay(entry.properties)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="layer-breakdown">
        <summary>
          Layer-by-layer breakdown ({layers.length} layer{layers.length === 1 ? "" : "s"}, bottom to top)
        </summary>
        <div className="layer-list">
          {layers.map((layer) => (
            <div className="layer-row" key={layer.y}>
              <span className="layer-y">
                Y={layer.y} ({layer.totalCount.toLocaleString()})
              </span>
              <span className="layer-entries">
                {layer.entries.map((entry) => `${entry.blockId} ×${entry.count}`).join(", ")}
              </span>
            </div>
          ))}
        </div>
      </details>

      <div className="export-row">
        <button
          type="button"
          onClick={() =>
            downloadText(materialListToText(result.materialList), `${fileStem}-material-list.txt`, "text/plain")
          }
        >
          ↓ Material list (.txt)
        </button>
        <button
          type="button"
          onClick={() =>
            downloadText(materialListToCsv(result.materialList), `${fileStem}-material-list.csv`, "text/csv")
          }
        >
          ↓ Material list (.csv)
        </button>
        <button type="button" onClick={() => void handleCopyMaterialList()}>
          {materialListCopied ? "Copied!" : "⧉ Copy material list"}
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => downloadBytes(result.schematicBytes, result.fileName)}
        >
          ↓ {result.fileName}
        </button>
      </div>

      <p className="hint-text">
        To place this: you'll need the <strong>Litematica</strong> mod (Fabric, plus Fabric API) in your
        Minecraft client. Put <code>{result.fileName}</code> into:
      </p>
      <ul className="hint-text file-path-list">
        <li>
          <strong>Mac:</strong> <code>~/Library/Application Support/minecraft/schematics/</code>
        </li>
        <li>
          <strong>Windows:</strong> press <kbd>Win</kbd> + <kbd>R</kbd>, paste this, press Enter:{" "}
          <code>{WINDOWS_SCHEMATICS_RUN_PATH}</code>{" "}
          <button type="button" className="copy-button" onClick={() => void handleCopyWindowsPath()}>
            {windowsPathCopied ? "Copied!" : "Copy"}
          </button>
        </li>
      </ul>
      <p className="hint-text">
        Then in-game, press <kbd>M</kbd> to open Litematica's menu → <strong>Load Schematics</strong> → select
        it → <strong>Load Schematic</strong>. That shows a ghost outline of the whole build where you're
        standing, which is what you place blocks into by hand, one at a time.
      </p>
    </section>
  );
}
