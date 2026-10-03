/**
 * Triggers a browser "Save As" for in-memory bytes via a throwaway
 * `<a download>` element. No automated test: this is a thin wrapper
 * around DOM/Blob APIs with no logic of its own to verify, and jsdom
 * (this project's Vitest environment is plain Node, see
 * vitest.config.ts) does not implement anchor-click downloads anyway.
 */
export function downloadBytes(bytes: Uint8Array, fileName: string, mimeType = "application/octet-stream"): void {
  // Re-wrapped for the same reason as in textureDecoder.ts: Blob's
  // types reject a Uint8Array that could be backed by a SharedArrayBuffer.
  const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  // Deferred rather than immediate: some browsers resolve the download
  // asynchronously after the simulated click, and revoking the object
  // URL too early can cancel it.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text: string, fileName: string, mimeType: string): void {
  downloadBytes(new TextEncoder().encode(text), fileName, mimeType);
}
