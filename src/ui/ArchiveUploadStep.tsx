import { useRef, useState, type DragEvent } from "react";
import { readMinecraftArchive, type MinecraftArchive } from "../assets/archiveReader.ts";
import { clearCachedArchive, saveCachedArchive } from "../assets/archiveCache.ts";

/** What to type into the Windows Run dialog (Win+R) to jump straight to the versions/26.3 folder. */
const WINDOWS_RUN_PATH = String.raw`%appdata%\.minecraft\versions\26.3`;

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
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [windowsPathCopied, setWindowsPathCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleCopyWindowsPath(): Promise<void> {
    try {
      await navigator.clipboard.writeText(WINDOWS_RUN_PATH);
      setWindowsPathCopied(true);
      setTimeout(() => setWindowsPathCopied(false), 2000);
    } catch {
      // Clipboard access can be denied (e.g. no HTTPS, or the user
      // blocked the permission) — the path is still shown as plain
      // text right next to the button, so copying by hand still works.
    }
  }

  function handleDragOver(event: DragEvent<HTMLLabelElement>): void {
    // Required so the browser allows a drop here at all — without
    // preventDefault, "dragover" cancels the drop and nothing happens.
    event.preventDefault();
    setIsDraggingOver(true);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>): void {
    event.preventDefault();
    setIsDraggingOver(false);
    const file = event.dataTransfer.files[0];
    if (file !== undefined) void handleFileChosen(file);
  }

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
    if (!window.confirm("Use a different file? This clears the uploaded archive and your selected block.")) {
      return;
    }
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
          <strong>Windows:</strong> press <kbd>Win</kbd> + <kbd>R</kbd>, paste this, press Enter:{" "}
          <code>{WINDOWS_RUN_PATH}</code>{" "}
          <button type="button" className="copy-button" onClick={() => void handleCopyWindowsPath()}>
            {windowsPathCopied ? "Copied!" : "Copy"}
          </button>
        </li>
      </ul>
      <p className="hint-text">
        Everything is read locally in your browser — nothing is uploaded anywhere, and it's remembered for
        next time so you only need to do this once.
      </p>
      {loadedFileName === null ? (
        <label
          className="drop-zone"
          data-dragging-over={isDraggingOver}
          onDragOver={handleDragOver}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={handleDrop}
        >
          <svg
            className="drop-zone-icon"
            width="30"
            height="26"
            viewBox="0 0 30 26"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M15 2 L15 17 M8 9 L15 2 L22 9" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2 18 L2 22 Q2 24 4 24 L26 24 Q28 24 28 22 L28 18" fill="none" strokeLinecap="round" />
          </svg>
          <span>
            <strong>Drag your jar or zip here</strong>, or click to browse
          </span>
          <input
            ref={inputRef}
            type="file"
            accept=".jar,.zip"
            className="visually-hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) void handleFileChosen(file);
            }}
          />
        </label>
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
