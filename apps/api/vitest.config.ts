import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.spec.ts"],
    setupFiles: ["./src/test-setup.ts"],
    testTimeout: 20000,
    // The integration suites share one seeded database and book the same doctors' free slots:
    // running the files one at a time keeps them from stealing each other's slots.
    fileParallelism: false,
  },
});
