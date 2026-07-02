import type { CapacitorConfig } from "@capacitor/cli";

// Native (Android / iOS) wrapper around the same static web app that ships to
// GitHub Pages. `webDir` points at the Vite build output; build it for native
// with `npm run build:mobile` (which uses base "/" — see vite.config.ts) before
// running `npx cap sync`.
const config: CapacitorConfig = {
  appId: "org.maxfinder.app",
  appName: "MAX Finder",
  webDir: "dist",
  backgroundColor: "#0f7a52",
  android: {
    // Keep the WebView background matched to the app theme-color so there is no
    // white flash between the native splash and the first paint.
    backgroundColor: "#0f7a52",
  },
};

export default config;
