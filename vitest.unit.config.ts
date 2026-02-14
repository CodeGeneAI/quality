import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "quality:unit",
    include: ["src/**/*.unit.test.ts"],
    environment: "node",
    // Bun + Vitest fork workers can become unstable under monorepo load.
    // Keep this suite deterministic with a single worker.
    fileParallelism: false,
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      enabled: false,
    },
  },
});
