import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  define: {
    __APP_VERSION__: JSON.stringify("test"),
  },
});
