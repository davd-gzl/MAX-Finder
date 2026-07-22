/**
 * Theme pre-paint. A tiny classic (non-module) script loaded synchronously in <head>,
 * BEFORE the body renders and long before the app bundle boots. Without it the page
 * paints with no `data-theme` on <html> until app.ts runs (after the ~350 KB module
 * downloads + parses), so a user whose saved theme differs from the CSS default sees a
 * brief flash of the wrong theme ("black then my mode"). Reading the stored preference
 * here and stamping <html> first makes the very first paint match the chosen theme.
 *
 * Must stay in sync with the app: storage key `mj.settings`, theme values
 * light | dark | auto (see src/state/store.ts). CSP is `script-src 'self'`, so this is
 * an external file (inline would be blocked), mirroring guard.js.
 */
(function () {
  var theme = "auto";
  try {
    var raw = localStorage.getItem("mj.settings");
    if (raw) {
      var s = JSON.parse(raw);
      if (s && (s.theme === "light" || s.theme === "dark" || s.theme === "auto")) theme = s.theme;
    }
  } catch (e) {
    /* private mode / bad JSON — fall back to auto (follows the OS) */
  }
  var root = document.documentElement;
  root.dataset.theme = theme;
  // Resolve `auto` to the OS preference so the initial background is right even before the
  // stylesheet's prefers-color-scheme media query has a chance to apply.
  var dark =
    theme === "dark" ||
    (theme === "auto" &&
      typeof matchMedia === "function" &&
      matchMedia("(prefers-color-scheme: dark)").matches);
  // Paint the canvas background immediately (matches --bg light/dark), so there is no
  // white/black flash before the CSS file loads. The stylesheet takes over once parsed.
  root.style.backgroundColor = dark ? "#181613" : "#efece3";
})();
