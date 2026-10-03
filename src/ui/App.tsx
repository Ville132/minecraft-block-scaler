import { useEffect, useRef, useState } from "react";
import type { MinecraftArchive } from "../assets/archiveReader.ts";
import { buildPalette, DEFAULT_PALETTE_OPTIONS, type PaletteBlock, type PaletteOptions } from "../domain/palette.ts";
import type { FillStyle } from "../domain/shell.ts";
import { ArchiveUploadStep } from "./ArchiveUploadStep.tsx";
import { BlockPickerStep } from "./BlockPickerStep.tsx";
import { buildReplica, type BuildReplicaResult } from "./buildReplica.ts";
import { ResultPanel } from "./ResultPanel.tsx";
import { ScaleAndOptionsStep } from "./ScaleAndOptionsStep.tsx";

export function App() {
  const [archive, setArchive] = useState<MinecraftArchive | null>(null);
  const [loadedFileName, setLoadedFileName] = useState<string | null>(null);

  const [paletteOptions, setPaletteOptions] = useState<PaletteOptions>(DEFAULT_PALETTE_OPTIONS);
  const [palette, setPalette] = useState<readonly PaletteBlock[]>([]);
  const [isLoadingPalette, setIsLoadingPalette] = useState(false);

  const [sourceBlockId, setSourceBlockId] = useState<string | null>(null);
  const [edgeBlocks, setEdgeBlocks] = useState<number | null>(null);
  const [fillStyle, setFillStyle] = useState<FillStyle>("hollow");

  const [isBuilding, setIsBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [result, setResult] = useState<BuildReplicaResult | null>(null);

  // Re-derives the palette whenever the archive or its options change.
  // A stale request guard discards a slower, superseded run rather than
  // letting it clobber a newer one that resolved first.
  const paletteRequestId = useRef(0);
  useEffect(() => {
    if (archive === null) {
      setPalette([]);
      return;
    }
    const requestId = ++paletteRequestId.current;
    setIsLoadingPalette(true);
    buildPalette(archive, paletteOptions)
      .then((builtPalette) => {
        if (paletteRequestId.current !== requestId) return;
        setPalette(builtPalette);
        if (sourceBlockId !== null && !builtPalette.some((block) => block.blockId === sourceBlockId)) {
          setSourceBlockId(null);
        }
      })
      .finally(() => {
        if (paletteRequestId.current === requestId) setIsLoadingPalette(false);
      });
    // sourceBlockId is deliberately not a dependency: clearing it when
    // the new palette drops it should not itself trigger another rebuild.
  }, [archive, paletteOptions]);

  async function handleBuild(): Promise<void> {
    if (archive === null || sourceBlockId === null || edgeBlocks === null || palette.length === 0) return;
    setIsBuilding(true);
    setBuildError(null);
    try {
      const built = await buildReplica({ archive, sourceBlockId, edgeBlocks, fillStyle, palette });
      setResult(built);
    } catch (cause) {
      setBuildError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsBuilding(false);
    }
  }

  const canBuild = archive !== null && sourceBlockId !== null && edgeBlocks !== null && palette.length > 0;

  return (
    <main>
      <h1>Minecraft Block Scaler</h1>
      <p className="subtitle">
        Turn one block into a giant, scale-true replica — with the exact material list to build it.
      </p>

      <ArchiveUploadStep
        loadedFileName={loadedFileName}
        onArchiveLoaded={(loadedArchive, fileName) => {
          setArchive(loadedArchive);
          setLoadedFileName(fileName);
          setSourceBlockId(null);
          setResult(null);
        }}
      />

      <BlockPickerStep
        isReady={archive !== null}
        isLoadingPalette={isLoadingPalette}
        palette={palette}
        options={paletteOptions}
        onOptionsChange={setPaletteOptions}
        selectedBlockId={sourceBlockId}
        onSelectBlock={(blockId) => {
          setSourceBlockId(blockId);
          setResult(null);
        }}
      />

      <ScaleAndOptionsStep
        isReady={sourceBlockId !== null}
        edgeBlocks={edgeBlocks}
        onEdgeBlocksChange={(edge) => {
          setEdgeBlocks(edge);
          setResult(null);
        }}
        fillStyle={fillStyle}
        onFillStyleChange={(style) => {
          setFillStyle(style);
          setResult(null);
        }}
      />

      <section className="step" data-disabled={!canBuild}>
        <h2>
          <span className="step-number">4</span>
          Build
        </h2>
        <button type="button" className="primary" disabled={!canBuild || isBuilding} onClick={handleBuild}>
          {isBuilding ? "Building…" : "Build replica"}
        </button>
        {buildError !== null && <p className="error-text">{buildError}</p>}
      </section>

      {result !== null && edgeBlocks !== null && <ResultPanel result={result} edgeBlocks={edgeBlocks} />}

      <p className="footer-note">Minecraft Block Scaler v{__APP_VERSION__}</p>
    </main>
  );
}
