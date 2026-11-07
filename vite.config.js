import { defineConfig } from "vite";
import { copyFileSync } from "node:fs";
import { resolve } from "node:path";

// Files the editor loads at runtime by URL (not via import), so Vite can't see them.
// They stay next to index.html in editor/ so the source still runs unbundled (GitHub Pages).
const RUNTIME_FILES = [
  "examples.json", "sw.js",
  "favicon.ico", "icon.svg", "icon-192.png", "icon-512.png",
];

const copyRuntimeFiles = {
  name: "copy-runtime-files",
  apply: "build",
  writeBundle(options) {
    for (const f of RUNTIME_FILES) copyFileSync(resolve("editor", f), resolve(options.dir, f));
  },
};

export default defineConfig({
  root: "editor",
  base: "./",
  publicDir: false,
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "es2022",
  },
  plugins: [copyRuntimeFiles],
});
