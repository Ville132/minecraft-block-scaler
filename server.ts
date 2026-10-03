/**
 * Minimal static file server for the production build. The app itself
 * is entirely client-side (see PLAN.md — this never touches a
 * Minecraft archive or a schematic; it only serves the already-built
 * static files from `dist/`), so a bespoke tiny server is simpler and
 * has fewer moving parts than pulling in a dependency for it.
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

// ".." because the compiled server lives in dist-server/, a sibling of
// dist/, not inside it (see tsconfig.server.json's outDir).
const DIST_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "..", "dist");
const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);

const CONTENT_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/** Resolves a request path to a file under `dist/`, falling back to `index.html` for client-side routes and refusing any path that escapes `dist/`. */
function resolveRequestedFile(requestUrl: string): string {
  const decodedPath = decodeURIComponent(requestUrl.split("?")[0] ?? "/");
  const candidate = normalize(join(DIST_DIR, decodedPath));
  if (!candidate.startsWith(DIST_DIR)) return join(DIST_DIR, "index.html");
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return join(DIST_DIR, "index.html");
}

function handleRequest(request: IncomingMessage, response: ServerResponse): void {
  const filePath = resolveRequestedFile(request.url ?? "/");
  const contentType = CONTENT_TYPE_BY_EXTENSION[extname(filePath)] ?? "application/octet-stream";
  // Hashed asset filenames (Vite's default) are safe to cache
  // indefinitely; index.html is not, since it is what points at them.
  const cacheControl = filePath.endsWith("index.html")
    ? "no-cache"
    : "public, max-age=31536000, immutable";

  response.writeHead(200, { "Content-Type": contentType, "Cache-Control": cacheControl });
  const fileStream = createReadStream(filePath);
  // Without this, a stream error (e.g. the file vanishing between the
  // existsSync check and this read) would surface as an uncaught
  // 'error' event and crash the whole process rather than just failing
  // this one request.
  fileStream.on("error", (error) => {
    console.error(`Failed to read '${filePath}':`, error);
    if (!response.headersSent) response.writeHead(500);
    response.end("Internal server error");
  });
  fileStream.pipe(response);
}

createServer(handleRequest).listen(PORT, () => {
  console.log(`Serving ${DIST_DIR} on port ${PORT}`);
});
