/** SNCF Open Data — Explore API v2.1 records endpoint for the `tgvmax` dataset. */
export const SNCF_API_URL =
  "https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/tgvmax/records";

/** Major interchange stations used to build single-connection journeys. */
export const HUB_STATIONS: string[] = [
  "PARIS (intramuros)",
  "LYON (intramuros)",
  "LILLE",
  "MARSEILLE ST CHARLES",
  "BORDEAUX ST JEAN",
  "RENNES",
  "STRASBOURG",
  "NANTES",
  "MONTPELLIER SAINT ROCH",
  "TOULOUSE MATABIAU",
];

/** Allowed layover window (minutes) for a connection. */
export const MIN_CONNECTION_MIN = 15;
export const MAX_CONNECTION_MIN = 240;
/** Layover ceiling when overnight stopovers are allowed (sleep at the hub). */
export const OVERNIGHT_MAX_CONNECTION_MIN = 15 * 60;

/**
 * Destinations that appear in the open data but are NOT bookable with a MAX pass
 * (MAX JEUNE / SENIOR cover domestic France; these international stops show
 * od_happy_card="OUI" in the feed but can't actually be reserved with the pass).
 * Matched as accent-insensitive substrings of the station label — extend freely.
 */
export const NON_BOOKABLE_PATTERNS: string[] = [
  "geneve", // Genève / Geneva (CH)
  "lausanne", // (CH)
  "zurich", // (CH)
  "bruxelles", // Brussels (BE)
  "brussel",
];

const BASE = (import.meta.env?.BASE_URL ?? "/") as string;

/** Base-relative data URLs (work under the GitHub Pages sub-path). */
export const DATA_URL = `${BASE}data/tgvmax.json`;
export const META_URL = `${BASE}data/meta.json`;

export const SNCF_CONNECT_URL = "https://www.sncf-connect.com/";

export const SITE_URL = "https://davd-gzl.github.io/MAX-Finder/";

/** Project repository (used for the header star link and the feedback button). */
export const GITHUB_URL = "https://github.com/davd-gzl/MAX-Finder";
export const GITHUB_ISSUES_URL = `${GITHUB_URL}/issues/new`;

/** Official SNCF pages describing the MAX JEUNE / MAX SENIOR subscriptions. */
export const MAX_JEUNE_URL = "https://www.sncf-connect.com/catalogue/description/max-jeune";
export const MAX_SENIOR_URL = "https://www.sncf-connect.com/catalogue/description/max-senior";

/** App version + build date, injected from package.json at build time (see vite.config).
 *  Falls back to "dev" when the defines aren't present (e.g. a raw ts-node run). */
declare const __APP_VERSION__: string;
declare const __APP_BUILD__: string;
export const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
export const APP_BUILD = typeof __APP_BUILD__ === "string" ? __APP_BUILD__ : "";
