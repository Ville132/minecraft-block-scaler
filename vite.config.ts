import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import packageJson from "./package.json" with { type: "json" };

// The UI footer reads this instead of duplicating the version string,
// so package.json stays the single source of truth (CLAUDE.md requires
// the running version to always be reportable).
export default defineConfig({
  // Relative URLs let the same build work at the domain root and below a sub-path such as /block-scaler/.
  base: "./",
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  // Fixed rather than left to pick an open port: .claude/launch.json's
  // preview tooling attaches to this exact port.
  server: {
    port: 5173,
    strictPort: true,
  },
});
