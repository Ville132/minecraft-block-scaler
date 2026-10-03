import { useRef, useState } from "react";
import { readMinecraftArchive, type MinecraftArchive } from "../assets/archiveReader.ts";
import { clearCachedArchive, saveCachedArchive } from "../assets/archiveCache.ts";

export interface ArchiveUploadStepProps {
  readonly loadedFileName: string | null;
  /** True when `loadedFileName` was restored from a previous visit rather than just picked — changes the status line's wording. */
  readonly loadedFromCache: boolean;
  readonly onArchiveLoaded: (archive: MinecraftArchive, fileName: string) => void;
  readonly onArchiveCleared: () => void;
}

/**
 * Lets the user supply their own client jar or resource pack, since
 * Mojang's block textures cannot be bundled in this app (see PLAN.md).
 * Reading the zip itself is synchronous and fast even for a full jar,
 * so no loading state is needed here — the slow step (decoding
 * candidate textures) happens later, in `buildPalette`.
 *
 * A successful upload is also cached (`archiveCache.ts`) in IndexedDB,
 * so a later visit restores it automatically instead of asking the
 * user to upload the same file again — see `App.tsx`'s mount effect.
 */
export function ArchiveUploadStep({
  loadedFileName,
  loadedFromCache,
  onArchiveLoaded,
  onArchiveCleared,
}: ArchiveUploadStepProps) {
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFileChosen(file: File): Promise<void> {
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const archive = readMinecraftArchive(bytes);
      onArchiveLoaded(archive, file.name);
      try {
        await saveCachedArchive(file.name, bytes);
      } catch {
        // Caching is a convenience, not a requirement (e.g. private
        // browsing can block IndexedDB entirely) — the archive is
        // already loaded in memory via onArchiveLoaded above, so a
        // cache failure here just means next visit needs a re-upload,
        // not that anything about this visit is broken.
      }
    } catch (cause) {
      setError(
        `Could not read '${file.name}' as a Minecraft jar or resource pack. ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
  }

  async function handleUseDifferentFile(): Promise<void> {
    setError(null);
    if (inputRef.current !== null) inputRef.current.value = "";
    onArchiveCleared();
    try {
      await clearCachedArchive();
    } catch {
      // Same reasoning as above: failing to clear the cache just means
      // it may reappear next visit, which the user can clear again.
    }
  }

  return (
    <section className="step">
      <h2>
        <span className="step-number">1</span>
        Upload your Minecraft files
      </h2>
      <p className="hint-text">
        Pick your <code>26.3.jar</code> client file or any resource pack <code>.zip</code>. It's usually
        under:
      </p>
      <ul className="hint-text file-path-list">
        <li>
          <strong>Mac:</strong> <code>~/Library/Application Support/minecraft/versions/26.3/</code>
        </li>
        <li>
          <strong>Windows:</strong> <code>%APPDATA%\.minecraft\versions\26.3\</code>
        </li>
      </ul>
      <p className="hint-text">
        Everything is read locally in your browser — nothing is uploaded anywhere, and it's remembered for
        next time so you only need to do this once.
      </p>
      {loadedFileName === null ? (
        <input
          ref={inputRef}
          type="file"
          accept=".jar,.zip"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) void handleFileChosen(file);
          }}
        />
      ) : (
        <p className="hint-text">
          {loadedFromCache ? "Remembered from last time: " : "Loaded "}
          <strong>{loadedFileName}</strong>.{" "}
          <button type="button" onClick={() => void handleUseDifferentFile()}>
            Use a different file
          </button>
        </p>
      )}
      {error !== null && <p className="error-text">{error}</p>}
    </section>
  );
}
