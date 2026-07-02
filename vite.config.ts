import { defineConfig } from "vite";

// Project is deployed to GitHub Pages at https://<user>.github.io/MAX-Finder/
// so production assets must be served from that sub-path. Dev server uses "/".
//
// The Capacitor (native mobile) build is different: the WebView loads assets
// from the app bundle root (capacitor://…/ or https://localhost/), so it must
// use base "/" — a "/MAX-Finder/" prefix would 404 every asset. Select it with
// `vite build --mode capacitor` (see the `build:mobile` npm script).
export default defineConfig(({ command, mode }) => ({
  base: command === "build" && mode !== "capacitor" ? "/MAX-Finder/" : "/",
  build: {
    target: "es2022",
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.ts"],
  },
}));
