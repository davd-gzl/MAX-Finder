import type { CardType } from "./types";

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

export const DEFAULT_CARD: CardType = "jeune";

const BASE = (import.meta.env?.BASE_URL ?? "/") as string;

/** Base-relative data URLs (work under the GitHub Pages sub-path). */
export const DATA_URL = `${BASE}data/tgvmax.json`;
export const META_URL = `${BASE}data/meta.json`;

export const SNCF_CONNECT_URL = "https://www.sncf-connect.com/";

/** Project repository (used for the header star link and the feedback button). */
export const GITHUB_URL = "https://github.com/davd-gzl/MAX-Finder";
export const GITHUB_ISSUES_URL = `${GITHUB_URL}/issues/new`;

/** Official SNCF pages describing the MAX JEUNE / MAX SENIOR subscriptions. */
export const MAX_JEUNE_URL = "https://www.sncf-connect.com/catalogue/description/max-jeune";
export const MAX_SENIOR_URL = "https://www.sncf-connect.com/catalogue/description/max-senior";
