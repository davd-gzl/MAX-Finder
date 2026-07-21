import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

// Single source of truth for the app version: package.json. Injected at build time
// (and for tests) so the UI can show which build a user is on, and a bug report can
// name an exact version.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as { version: string };

// Project is deployed to GitHub Pages at https://<user>.github.io/MAX-Finder/
// so production assets must be served from that sub-path. Dev server uses "/".
//
// The Capacitor (native mobile) build is different: the WebView loads assets
// from the app bundle root (capacitor://…/ or https://localhost/), so it must
// use base "/" — a "/MAX-Finder/" prefix would 404 every asset. Select it with
// `vite build --mode capacitor` (see the `build:mobile` npm script).
export default defineConfig(({ command, mode }) => ({
  base: command === "build" && mode !== "capacitor" ? "/MAX-Finder/" : "/",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
}));
