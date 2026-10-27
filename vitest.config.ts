import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/e2e/**"],
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
