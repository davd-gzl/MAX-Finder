import type { Theme } from "../state/store";

/* ── inline icon markup (trusted static SVG, drawn in currentColor) ── */

export const SHARE_SVG =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';

export const CHECK_SVG =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12.5l5 5L20 7"/></svg>';

export const MENU_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';

export const MENU_CLOSE_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

export const INSTALL_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v10m0 0-3.5-3.5M12 13l3.5-3.5"/><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/></svg>';

export const LOGO_SVG =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="14" rx="3.2"/><path d="M5 10.5h14"/><path d="M9 17l-2.2 3.3M15 17l2.2 3.3"/><circle cx="9" cy="13.6" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="13.6" r="1" fill="currentColor" stroke="none"/></svg>';

export const GITHUB_SVG =
  '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 1.3a10.7 10.7 0 0 0-3.38 20.86c.53.1.73-.23.73-.51 0-.25-.01-.92-.01-1.8-2.98.65-3.6-1.44-3.6-1.44-.49-1.24-1.19-1.57-1.19-1.57-.97-.66.08-.65.08-.65 1.07.08 1.64 1.1 1.64 1.1.95 1.64 2.5 1.16 3.11.89.1-.69.37-1.16.68-1.43-2.38-.27-4.88-1.19-4.88-5.3 0-1.17.42-2.13 1.1-2.88-.11-.27-.48-1.36.1-2.84 0 0 .9-.29 2.95 1.1a10.2 10.2 0 0 1 5.36 0c2.05-1.39 2.95-1.1 2.95-1.1.58 1.48.21 2.57.1 2.84.69.75 1.1 1.71 1.1 2.88 0 4.12-2.5 5.02-4.89 5.29.38.33.72.98.72 1.98 0 1.43-.01 2.58-.01 2.93 0 .28.19.62.74.51A10.7 10.7 0 0 0 12 1.3Z"/></svg>';

export const SEARCH_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>';

/**
 * Monochrome theme glyph for the theme toggle: sun (light), moon (dark), or a
 * half-disc (auto), drawn in currentColor.
 * @param theme the theme the glyph should represent.
 * @returns the SVG markup string.
 */
export function themeSvg(theme: Theme): string {
  const wrap = (inner: string): string =>
    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  if (theme === "light")
    return wrap(
      '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4l1.4-1.4M18 6l1.4-1.4"/>',
    );
  if (theme === "dark") return wrap('<path d="M20.5 13.2A8 8 0 1 1 10.8 3.5 6.3 6.3 0 0 0 20.5 13.2z"/>');
  return wrap('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>');
}
