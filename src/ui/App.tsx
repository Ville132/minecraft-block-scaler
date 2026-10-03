import { useEffect, useRef, useState } from "react";
import { clearCachedArchive, loadCachedArchive } from "../assets/archiveCache.ts";
import { readMinecraftArchive, type MinecraftArchive } from "../assets/archiveReader.ts";
import type { AxisOrientation } from "../assets/modelResolver.ts";
import {
  buildPalette,
  DEFAULT_PALETTE_OPTIONS,
  listAxisVariantBlocks,
  type PaletteBlock,
  type PaletteOptions,
} from "../domain/palette.ts";
import type { FillStyle } from "../domain/shell.ts";
import { ArchiveUploadStep } from "./ArchiveUploadStep.tsx";
import { BlockPickerStep } from "./BlockPickerStep.tsx";
import { buildReplica, type BuildReplicaResult } from "./buildReplica.ts";
import { ResultPanel } from "./ResultPanel.tsx";
import { ScaleAndOptionsStep } from "./ScaleAndOptionsStep.tsx";

export function App() {
  const [archive, setArchive] = useState<MinecraftArchive | null>(null);
  const [loadedFileName, setLoadedFileName] = useState<string | null>(null);
  const [loadedFromCache, setLoadedFromCache] = useState(false);

  const [paletteOptions, setPaletteOptions] = useState<PaletteOptions>(DEFAULT_PALETTE_OPTIONS);
  const [palette, setPalette] = useState<readonly PaletteBlock[]>([]);
  const [axisVariantBlocks, setAxisVariantBlocks] = useState<readonly PaletteBlock[]>([]);
  const [isLoadingPalette, setIsLoadingPalette] = useState(false);

  const [sourceBlockId, setSourceBlockId] = useState<string | null>(null);
  /** Non-null only while `sourceBlockId` names a block from `axisVariantBlocks` — see `hasAxisVariants` in `assets/modelResolver.ts`. */
  const [sourceBlockOrientation, setSourceBlockOrientation] = useState<AxisOrientation | null>(null);
  const [edgeBlocks, setEdgeBlocks] = useState<number | null>(null);
  const [fillStyle, setFillStyle] = useState<FillStyle>("hollow");

  const [isBuilding, setIsBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [result, setResult] = useState<BuildReplicaResult | null>(null);

  // Re-derives both the fill palette and the axis-pillar candidate list
  // whenever the archive or its options change. A stale request guard
  // discards a slower, superseded run rather than letting it clobber a
  // newer one that resolved first.
  const paletteRequestId = useRef(0);
  useEffect(() => {
    if (archive === null) {
      setPalette([]);
      setAxisVariantBlocks([]);
      return;
    }
    const requestId = ++paletteRequestId.current;
    setIsLoadingPalette(true);
    Promise.all([buildPalette(archive, paletteOptions), listAxisVariantBlocks(archive, paletteOptions)])
      .then(([builtPalette, builtAxisVariantBlocks]) => {
        if (paletteRequestId.current !== requestId) return;
        setPalette(builtPalette);
        setAxisVariantBlocks(builtAxisVariantBlocks);
        const stillSelectable =
          builtPalette.some((block) => block.blockId === sourceBlockId) ||
          builtAxisVariantBlocks.some((block) => block.blockId === sourceBlockId);
        if (sourceBlockId !== null && !stillSelectable) {
          setSourceBlockId(null);
          setSourceBlockOrientation(null);
        }
      })
      .finally(() => {
        if (paletteRequestId.current === requestId) setIsLoadingPalette(false);
      });
    // sourceBlockId is deliberately not a dependency: clearing it when
    // the new palette drops it should not itself trigger another rebuild.
  }, [archive, paletteOptions]);

  // Restores a previously uploaded archive on mount, so a returning
  // visitor does not need to upload the same jar/resource pack again
  // (see ArchiveUploadStep.tsx and archiveCache.ts). Runs once; if
  // nothing was cached, or the cached bytes no longer parse (e.g. an
  // interrupted save), this just leaves the upload step empty rather
  // than surfacing an error for something the user didn't just do.
  useEffect(() => {
    let cancelled = false;
    loadCachedArchive()
      .then((cached) => {
        if (cancelled || cached === undefined) return;
        try {
          const restoredArchive = readMinecraftArchive(cached.bytes);
          setArchive(restoredArchive);
          setLoadedFileName(cached.fileName);
          setLoadedFromCache(true);
        } catch {
          void clearCachedArchive();
        }
      })
      .catch(() => {
        // IndexedDB can be unavailable (e.g. private browsing) — that
        // just means no restore happens, same as a first-ever visit.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleBuild(): Promise<void> {
    if (archive === null || sourceBlockId === null || edgeBlocks === null || palette.length === 0) return;
    setIsBuilding(true);
    setBuildError(null);
    try {
      const built = await buildReplica({
        archive,
        sourceBlockId,
        sourceBlockOrientation,
        edgeBlocks,
        fillStyle,
        palette,
      });
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
        loadedFromCache={loadedFromCache}
        onArchiveLoaded={(loadedArchive, fileName) => {
          setArchive(loadedArchive);
          setLoadedFileName(fileName);
          setLoadedFromCache(false);
          setSourceBlockId(null);
          setSourceBlockOrientation(null);
          setResult(null);
        }}
        onArchiveCleared={() => {
          setArchive(null);
          setLoadedFileName(null);
          setLoadedFromCache(false);
          setSourceBlockId(null);
          setSourceBlockOrientation(null);
          setResult(null);
        }}
      />

      <BlockPickerStep
        isReady={archive !== null}
        isLoadingPalette={isLoadingPalette}
        palette={palette}
        axisVariantBlocks={axisVariantBlocks}
        options={paletteOptions}
        onOptionsChange={setPaletteOptions}
        selectedBlockId={sourceBlockId}
        onSelectBlock={(blockId) => {
          setSourceBlockId(blockId);
          const isAxisVariant = axisVariantBlocks.some((block) => block.blockId === blockId);
          setSourceBlockOrientation(isAxisVariant ? "upright" : null);
          setResult(null);
        }}
        sourceBlockOrientation={sourceBlockOrientation}
        onOrientationChange={(orientation) => {
          setSourceBlockOrientation(orientation);
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
