import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.unit.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      enabled: false,
    },
  },
});
