import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    cache: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
    sequence: { concurrent: false }
  }
});
