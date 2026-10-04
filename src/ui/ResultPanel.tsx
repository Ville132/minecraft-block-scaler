import { useState } from "react";
import { CUBE_FACE_DIRECTIONS, type CubeFaceDirection } from "../domain/faces.ts";
import type { BuildReplicaResult } from "./buildReplica.ts";
import { downloadBytes, downloadText } from "./download.ts";
import { materialListToCsv, materialListToText } from "./materialListExport.ts";
import { PreviewCanvas } from "./PreviewCanvas.tsx";

export interface ResultPanelProps {
  readonly result: BuildReplicaResult;
  readonly edgeBlocks: number;
}

export function ResultPanel({ result, edgeBlocks }: ResultPanelProps) {
  const [previewFace, setPreviewFace] = useState<CubeFaceDirection>("up");
  const totalBlocks = result.voxels.length;

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
