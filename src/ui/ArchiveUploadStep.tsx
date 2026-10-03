import { useRef, useState } from "react";
import { readMinecraftArchive, type MinecraftArchive } from "../assets/archiveReader.ts";

export interface ArchiveUploadStepProps {
  readonly loadedFileName: string | null;
  readonly onArchiveLoaded: (archive: MinecraftArchive, fileName: string) => void;
}

/**
 * Lets the user supply their own client jar or resource pack, since
 * Mojang's block textures cannot be bundled in this app (see PLAN.md).
 * Reading the zip itself is synchronous and fast even for a full jar,
 * so no loading state is needed here — the slow step (decoding
 * candidate textures) happens later, in `buildPalette`.
 */
export function ArchiveUploadStep({ loadedFileName, onArchiveLoaded }: ArchiveUploadStepProps) {
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFileChosen(file: File): Promise<void> {
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const archive = readMinecraftArchive(bytes);
      onArchiveLoaded(archive, file.name);
    } catch (cause) {
      setError(
        `Could not read '${file.name}' as a Minecraft jar or resource pack. ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
  }

  return (
    <section className="step">
      <h2>
        <span className="step-number">1</span>
        Upload your Minecraft files
      </h2>
      <p className="hint-text">
        Pick your <code>26.3.jar</code> client file (usually under{" "}
        <code>~/Library/Application Support/minecraft/versions/26.3/</code>) or any resource pack
        <code>.zip</code>. Everything is read locally in your browser — nothing is uploaded anywhere.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".jar,.zip"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) void handleFileChosen(file);
        }}
      />
      {loadedFileName !== null && error === null && (
        <p className="hint-text">
          Loaded <strong>{loadedFileName}</strong>.
        </p>
      )}
      {error !== null && <p className="error-text">{error}</p>}
    </section>
  );
}
