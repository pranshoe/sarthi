import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * Builds a loadable MV3 extension into dist/:
 *
 *   dist/manifest.json      copied from public/
 *   dist/sidepanel.html     React panel
 *   dist/background.js      service worker
 *   dist/content.js         content script (plain bundle, not a module)
 *   dist/assets/*           hashed panel chunks
 *
 * Load dist/ via chrome://extensions -> Load unpacked.
 */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome116",
    rollupOptions: {
      input: {
        sidepanel: path.resolve(__dirname, "sidepanel.html"),
        background: path.resolve(__dirname, "src/background/index.ts"),
        content: path.resolve(__dirname, "src/content/detector.ts"),
      },
      output: {
        entryFileNames: (chunk: { name: string }) =>
          chunk.name === "background"
            ? "background.js"
            : chunk.name === "content"
              ? "content.js"
              : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  server: { port: 5173, strictPort: true },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    globals: true,
  },
} as never);