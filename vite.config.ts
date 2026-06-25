import { defineConfig } from "vite";

// Project is deployed to GitHub Pages at https://<user>.github.io/MAX-Finder/
// so production assets must be served from that sub-path. Dev server uses "/".
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/MAX-Finder/" : "/",
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
