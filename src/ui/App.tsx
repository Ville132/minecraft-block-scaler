import { useEffect, useMemo, useRef, useState } from "react";
import { clearCachedArchive, loadCachedArchive } from "../assets/archiveCache.ts";
import { readMinecraftArchive, type MinecraftArchive } from "../assets/archiveReader.ts";
import type { AxisOrientation } from "../assets/modelResolver.ts";
import { DEFAULT_COLOR_TOLERANCE } from "../domain/color.ts";
import { DEFAULT_CONTRAST_GAIN } from "../domain/contrast.ts";
import {
  buildPalette,
  DEFAULT_PALETTE_OPTIONS,
  isFlammableBlock,
  isWoodFamilyBlock,
  listAxisVariantBlocks,
  type PaletteBlock,
  type PaletteOptions,
} from "../domain/palette.ts";
import { VANILLA_TEXTURE_SIZE_PX } from "../domain/scale.ts";
import type { FillStyle } from "../domain/shell.ts";
import grassBlockLogoUrl from "./grass-block.svg";
import { ArchiveUploadStep } from "./ArchiveUploadStep.tsx";
import { Callout } from "./Callout.tsx";
import { BlockPickerStep } from "./BlockPickerStep.tsx";
import { buildReplica, resolveSourceTexturePixelsPerSide, type BuildReplicaResult } from "./buildReplica.ts";
import { ResultPanel } from "./ResultPanel.tsx";
import { DEFAULT_MAX_DISTINCT_BLOCKS, ScaleAndOptionsStep } from "./ScaleAndOptionsStep.tsx";
import { usePersistedState } from "./usePersistedState.ts";

export function App() {
  const [archive, setArchive] = useState<MinecraftArchive | null>(null);
  const [loadedFileName, setLoadedFileName] = useState<string | null>(null);
  const [loadedFromCache, setLoadedFromCache] = useState(false);

  const [paletteOptions, setPaletteOptions] = usePersistedState<PaletteOptions>(
    "paletteOptions",
    DEFAULT_PALETTE_OPTIONS,
  );
  const [palette, setPalette] = useState<readonly PaletteBlock[]>([]);
  const [axisVariantBlocks, setAxisVariantBlocks] = useState<readonly PaletteBlock[]>([]);
  const [isLoadingPalette, setIsLoadingPalette] = useState(false);
  /** Restricts FILL material to wood blocks only — unlike `paletteOptions`, this never hides a block from the "choose a block to scale" picker, only from what can be used to color it in. */
  const [onlyWoodFillMaterial, setOnlyWoodFillMaterial] = usePersistedState("onlyWoodFillMaterial", false);
  /** Excludes wool/hay/bookshelf/wood-family FILL material (same picker-vs-fill distinction as `onlyWoodFillMaterial`) — not a `paletteOptions` toggle because most axis-pillar SOURCE blocks (logs) are themselves flammable wood, so excluding flammable blocks archive-wide would also remove logs from the scale-source picker, which defeats scaling up a log at all. Off by default: wood/wool are often the best color match for a natural-looking source block, and most builds are nowhere near fire. */
  const [avoidFlammableFillMaterial, setAvoidFlammableFillMaterial] = usePersistedState(
    "avoidFlammableFillMaterial",
    false,
  );

  // Axis-pillar blocks (stripped logs, plain "wood"/all-bark variants,
  // nether stems/hyphae, …) are just as usable as fill material as any
  // other block — their precomputed "upright" color is exactly right
  // for that, since a schematic entry with no Properties defaults to
  // axis=y (see listAxisVariantBlocks's doc comment in palette.ts).
  // They're kept in a separate list from palette.ts's buildPalette only
  // because the picker needs an orientation choice for them when one is
  // chosen as the scale SOURCE, which fill material has no use for.
  const allFillCandidates = useMemo(() => [...palette, ...axisVariantBlocks], [palette, axisVariantBlocks]);
  const fillPalette = useMemo(
    () =>
      allFillCandidates
        .filter((block) => !onlyWoodFillMaterial || isWoodFamilyBlock(block.blockId))
        .filter((block) => !avoidFlammableFillMaterial || !isFlammableBlock(block.blockId)),
    [allFillCandidates, onlyWoodFillMaterial, avoidFlammableFillMaterial],
  );

  const [sourceBlockId, setSourceBlockId] = useState<string | null>(null);
  /** Non-null only while `sourceBlockId` names a block from `axisVariantBlocks` — see `hasAxisVariants` in `assets/modelResolver.ts`. */
  const [sourceBlockOrientation, setSourceBlockOrientation] = useState<AxisOrientation | null>(null);
  // Synchronous (see resolveSourceTexturePixelsPerSide's doc comment) —
  // a plain memo, not a loading-state effect. Falls back to vanilla's
  // 16px, the only sane default before any block is chosen (or if the
  // chosen one's texture can't be read for some reason buildReplica will
  // surface more specifically if the user goes on to build anyway).
  const texturePixelsPerSide = useMemo(
    () =>
      archive === null || sourceBlockId === null
        ? VANILLA_TEXTURE_SIZE_PX
        : (resolveSourceTexturePixelsPerSide(archive, sourceBlockId, sourceBlockOrientation) ??
          VANILLA_TEXTURE_SIZE_PX),
    [archive, sourceBlockId, sourceBlockOrientation],
  );
  // edgeBlocks is deliberately NOT persisted — it depends on the
  // selected source block's own texture resolution (texturePixelsPerSide),
  // so a size that was "exact" for one block could be "distorted" for a
  // completely different one restored from a past visit.
  const [edgeBlocks, setEdgeBlocks] = useState<number | null>(null);
  const [fillStyle, setFillStyle] = usePersistedState<FillStyle>("fillStyle", "hollow");
  // A NEW storage key on purpose, not the old "varianceWeight": that key
  // holds a weight (0 / 1 / 2.5), and reading it back as a tolerance would
  // be catastrophic — a stored 1 is a tolerance of 1.0 Oklab, wider than
  // any real color distance, so every voxel would resolve to the flattest
  // block in the whole palette: a uniformly pale, flat replica that looks
  // exactly like the bug this replaced, silently, for every returning
  // visitor. An absent key just falls back to the default.
  const [colorTolerance, setColorTolerance] = usePersistedState<number>("colorTolerance", DEFAULT_COLOR_TOLERANCE);
  /** `1` (no enhancement) by default — see `domain/contrast.ts`. A brand-new storage key, so there is no older stored value of a different meaning to misread. */
  const [contrastGain, setContrastGain] = usePersistedState<number>("contrastGain", DEFAULT_CONTRAST_GAIN);
  /** Off by default — see `domain/dither.ts`'s header comment. */
  const [ditherEnabled, setDitherEnabled] = usePersistedState("ditherEnabled", false);
  /** `null` means no cap — see `domain/consolidate.ts`. Defaults ON: nothing upstream limits distinct block count, and a cap at or above whatever a build would naturally use is a no-op, so defaulting it on costs nothing for a build that was already simple. */
  const [maxDistinctBlocks, setMaxDistinctBlocks] = usePersistedState<number | null>(
    "maxDistinctBlocks",
    DEFAULT_MAX_DISTINCT_BLOCKS,
  );

  const [isBuilding, setIsBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [result, setResult] = useState<BuildReplicaResult | null>(null);
  /** True once any option changes after a build — the result stays on screen (it's still valid data, just from before the change) rather than vanishing, so "is this tweak better?" can actually be answered by comparison instead of a blind rebuild. Only a SUCCESSFUL rebuild clears it; a failed one leaves the last working result in place, still clearly marked stale, alongside the new error. */
  const [resultIsStale, setResultIsStale] = useState(false);

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
    if (archive === null || sourceBlockId === null || edgeBlocks === null || fillPalette.length === 0) return;
    setIsBuilding(true);
    setBuildError(null);
    try {
      const built = await buildReplica({
        archive,
        sourceBlockId,
        sourceBlockOrientation,
        edgeBlocks,
        fillStyle,
        palette: fillPalette,
        colorTolerance,
        contrastGain,
        dither: ditherEnabled,
        ...(maxDistinctBlocks !== null && { maxDistinctBlocks }),
      });
      setResult(built);
      setResultIsStale(false);
    } catch (cause) {
      setBuildError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsBuilding(false);
    }
  }

  const canBuild = archive !== null && sourceBlockId !== null && edgeBlocks !== null && fillPalette.length > 0;

  return (
    <main>
      <div className="app-header">
        {/* Imported rather than inlined so the header and the browser-tab icon
            cannot drift apart, and so Vite resolves the URL against the app's
            base — the build is served from a sub-path. `alt=""` marks it
            decorative: the <h1> beside it already names the app. */}
        <img className="logo-cube" src={grassBlockLogoUrl} width="34" height="34" alt="" />
        <h1>Minecraft Block Scaler</h1>
      </div>
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
          setResultIsStale(true);
        }}
        onArchiveCleared={() => {
          setArchive(null);
          setLoadedFileName(null);
          setLoadedFromCache(false);
          setSourceBlockId(null);
          setSourceBlockOrientation(null);
          setResultIsStale(true);
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
          setResultIsStale(true);
        }}
        sourceBlockOrientation={sourceBlockOrientation}
        onOrientationChange={(orientation) => {
          setSourceBlockOrientation(orientation);
          setResultIsStale(true);
        }}
        onlyWoodFillMaterial={onlyWoodFillMaterial}
        onOnlyWoodFillMaterialChange={(value) => {
          setOnlyWoodFillMaterial(value);
          setResultIsStale(true);
        }}
        avoidFlammableFillMaterial={avoidFlammableFillMaterial}
        onAvoidFlammableFillMaterialChange={(value) => {
          setAvoidFlammableFillMaterial(value);
          setResultIsStale(true);
        }}
      />

      <ScaleAndOptionsStep
        isReady={sourceBlockId !== null}
        sourceBlockId={sourceBlockId}
        texturePixelsPerSide={texturePixelsPerSide}
        edgeBlocks={edgeBlocks}
        onEdgeBlocksChange={(edge) => {
          setEdgeBlocks(edge);
          setResultIsStale(true);
        }}
        fillStyle={fillStyle}
        onFillStyleChange={(style) => {
          setFillStyle(style);
          setResultIsStale(true);
        }}
        colorTolerance={colorTolerance}
        onColorToleranceChange={(tolerance) => {
          setColorTolerance(tolerance);
          setResultIsStale(true);
        }}
        contrastGain={contrastGain}
        onContrastGainChange={(gain) => {
          setContrastGain(gain);
          setResultIsStale(true);
        }}
        ditherEnabled={ditherEnabled}
        onDitherEnabledChange={(enabled) => {
          setDitherEnabled(enabled);
          setResultIsStale(true);
        }}
        maxDistinctBlocks={maxDistinctBlocks}
        onMaxDistinctBlocksChange={(value) => {
          setMaxDistinctBlocks(value);
          setResultIsStale(true);
        }}
      />

      <section className="step" data-disabled={!canBuild}>
        <h2>
          <span className="step-number">4</span>
          Build
          {sourceBlockId !== null && <span className="step-context">scaling {sourceBlockId}</span>}
        </h2>
        <button
          type="button"
          className="primary"
          disabled={!canBuild || isBuilding}
          data-busy={isBuilding}
          // Draws the eye only while building is genuinely the outstanding
          // action: before the first build, and after an option change has
          // left the shown result stale. Once the result matches the options,
          // the download below is the thing to reach for, and two buttons
          // competing for attention would just be noise.
          data-cta={result === null || resultIsStale}
          onClick={handleBuild}
        >
          {isBuilding ? "Building…" : result !== null && resultIsStale ? "Rebuild replica" : "Build replica"}
        </button>
        {result !== null && resultIsStale && (
          <Callout tone="warn">
            Your options have changed since this result was built — it's still shown below, but rebuild to see
            the effect of your latest change.
          </Callout>
        )}
        {(onlyWoodFillMaterial || avoidFlammableFillMaterial) && palette.length > 0 && fillPalette.length === 0 && (
          <Callout tone="warn">
            "{onlyWoodFillMaterial ? "Only use wood blocks" : "Avoid flammable blocks"}" left nothing to build
            with — your archive's matching blocks were already excluded by one of the toggles above (or it
            has none at all). Try relaxing a toggle or turning this one off.
          </Callout>
        )}
        {buildError !== null && <p className="error-text">{buildError}</p>}
      </section>

      {result !== null && edgeBlocks !== null && <ResultPanel result={result} edgeBlocks={edgeBlocks} />}

      <p className="footer-note">Minecraft Block Scaler v{__APP_VERSION__}</p>
    </main>
  );
}
