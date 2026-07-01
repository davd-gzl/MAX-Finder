import { DATA_URL, META_URL, SNCF_API_URL, HUB_STATIONS, NON_BOOKABLE_PATTERNS } from "../config";

/**
 * A data-source PROFILE: everything about reading and judging ONE train dataset.
 *
 * The core (search / connections / calendar / tour) only ever sees the normalized
 * `MaxTrain` shape, so the SNCF-specifics live here at the edge. Adding another
 * operator later (Deutsche Bahn, Renfe, …) means supplying another profile — a
 * different field mapping and a different "is this seat bookable?" rule — without
 * touching the core. SNCF "tgvmax" is the default profile, and the app currently
 * ships only it (branding, the MAX pass, and the UI stay SNCF-specific for now).
 */
export interface DatasetProfile {
  /** Stable identifier, e.g. "sncf-tgvmax". */
  id: string;
  /** Base-relative snapshot + metadata URLs (served with the static site). */
  dataUrl: string;
  metaUrl: string;
  /** Upstream open-data API (optional; used by the data-refresh script). */
  apiUrl?: string;
  /** Pull the core fields out of one raw record (whatever shape the source uses). */
  read: (r: RawSourceRecord) => ReadFields;
  /**
   * Does this record have a bookable / highlighted seat for this source's pass?
   * SNCF: a free MAX seat (`od_happy_card === "OUI"`). A source with no pass concept
   * can simply return `true`.
   */
  isReservable: (r: RawSourceRecord) => boolean;
  /** Interchange hubs used to build connecting journeys in this network. */
  hubs: string[];
  /**
   * Station-name substrings that appear in the feed but are NOT bookable with the
   * pass (SNCF: international stops). Accent-insensitive substring match; empty for
   * sources with no such exclusions.
   */
  nonBookablePatterns: string[];
}

/** One raw record before normalization — shape varies per source, so it's untyped. */
export type RawSourceRecord = Record<string, unknown>;

/** The fields the core needs, lifted out of a source's own record shape. */
export interface ReadFields {
  origin?: string;
  destination?: string;
  date?: string;
  depart?: string;
  arrive?: string;
  trainNo?: string;
  /** Line / route family / train-type marker (SNCF: the "axe"). */
  category?: string;
}

/** Trim any raw value to a non-empty string, or undefined. */
function str(v: unknown): string | undefined {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return s || undefined;
}

/**
 * SNCF "tgvmax" — the default (and, for now, only) profile. Encodes today's exact
 * behaviour: French field names, and a free MAX seat means `od_happy_card === "OUI"`.
 */
export const SNCF_PROFILE: DatasetProfile = {
  id: "sncf-tgvmax",
  dataUrl: DATA_URL,
  metaUrl: META_URL,
  apiUrl: SNCF_API_URL,
  read: (r) => ({
    origin: str(r.origine),
    destination: str(r.destination),
    date: str(r.date),
    depart: str(r.heure_depart),
    arrive: str(r.heure_arrivee),
    trainNo: str(r.train_no),
    category: str(r.axe),
  }),
  isReservable: (r) => str(r.od_happy_card)?.toUpperCase() === "OUI",
  hubs: HUB_STATIONS,
  nonBookablePatterns: NON_BOOKABLE_PATTERNS,
};
