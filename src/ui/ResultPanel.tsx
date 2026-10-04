import { useState } from "react";
import { CUBE_FACE_DIRECTIONS, type CubeFaceDirection } from "../domain/faces.ts";
import type { BuildReplicaResult } from "./buildReplica.ts";
import { downloadBytes, downloadText } from "./download.ts";
import { materialListToCsv, materialListToText } from "./materialListExport.ts";
import { PreviewCanvas } from "./PreviewCanvas.tsx";

/** What to type into the Windows Run dialog (Win+R) to jump straight to the schematics folder — same trick as `ArchiveUploadStep.tsx`'s `WINDOWS_RUN_PATH`, pointed at the sibling `schematics` folder instead of `versions/26.3`. */
const WINDOWS_SCHEMATICS_RUN_PATH = String.raw`%appdata%\.minecraft\schematics`;

export interface ResultPanelProps {
  readonly result: BuildReplicaResult;
  readonly edgeBlocks: number;
}

export function ResultPanel({ result, edgeBlocks }: ResultPanelProps) {
  const [previewFace, setPreviewFace] = useState<CubeFaceDirection>("up");
  const [windowsPathCopied, setWindowsPathCopied] = useState(false);
  const totalBlocks = result.voxels.length;

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

  return (
    <section className="step">
      <h2>
        <span className="step-number">5</span>
        Material list &amp; schematic
      </h2>

      <p className="hint-text">
        {totalBlocks.toLocaleString()} blocks total across {result.materialList.length} block type
        {result.materialList.length === 1 ? "" : "s"}.
        {result.interiorFillBlockId !== null && (
          <>
            {" "}
            The hidden interior uses <code>{result.interiorFillBlockId}</code> — cheap and never visible, so it
            wasn't color-matched.
          </>
        )}
      </p>

      {result.consolidation !== null && (
        <p className="hint-text">
          Capped at {result.consolidation.consolidatedBlockCount} of{" "}
          {result.consolidation.originalBlockCount} distinct blocks — voxels that lost their block were
          reassigned to the closest survivor (average color shift: {result.consolidation.averageColorErrorIntroduced.toFixed(3)}
          , in Oklab distance).
        </p>
      )}

      <div className="material-table-wrap">
        <table className="material-table">
          <thead>
            <tr>
              <th>Block</th>
              <th className="count">Count</th>
              <th className="count">Shulkers</th>
              <th className="count">Stacks</th>
              <th className="count">Loose</th>
            </tr>
          </thead>
          <tbody>
            {result.materialList.map((entry) => (
              <tr key={entry.blockId}>
                <td className="block-name">{entry.resourceLocation}</td>
                <td className="count primary">{entry.count.toLocaleString()}</td>
                <td className="count">{entry.breakdown.shulkerBoxes || "–"}</td>
                <td className="count">{entry.breakdown.stacks || "–"}</td>
                <td className="count">{entry.breakdown.singles || "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="export-row">
        <button
          type="button"
          onClick={() =>
            downloadText(materialListToText(result.materialList), "material-list.txt", "text/plain")
          }
        >
          ↓ Material list (.txt)
        </button>
        <button
          type="button"
          onClick={() =>
            downloadText(materialListToCsv(result.materialList), "material-list.csv", "text/csv")
          }
        >
          ↓ Material list (.csv)
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
    </section>
  );
}
