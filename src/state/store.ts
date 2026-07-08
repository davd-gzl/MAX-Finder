import type { SearchQuery, SearchMode, CardType, Journey, SortKey } from "../types";
import type { Tour } from "../core/tour";
import { isLang, detectLang, type Lang } from "../i18n";

export type Theme = "light" | "dark" | "auto";
export type ViewMode = "list" | "map";

export interface RoutePair {
  origin: string;
  destination: string;
}

export interface Settings {
  lang: Lang;
  theme: Theme;
  card: CardType;
  view: ViewMode;
}

const KEY = {
  settings: "mj.settings",
  favorites: "mj.favorites",
  watched: "mj.watched",
  trips: "mj.trips",
} as const;

function readLS<T>(key: string, fallback: T, valid?: (v: unknown) => boolean): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    // The try/catch only guards against invalid JSON. A valid-but-wrong-TYPE value
    // (e.g. an object where an array is expected) would parse fine and then crash the
    // caller's .some()/.findIndex() — so callers can pass a shape check to fall back.
    if (valid && !valid(parsed)) return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

function writeLS(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage may be full or denied (private mode) — ignore */
  }
}

// --- settings ---------------------------------------------------------------

export function loadSettings(): Settings {
  const s = readLS<Partial<Settings>>(KEY.settings, {}, (v) => typeof v === "object" && v !== null && !Array.isArray(v));
  return {
    lang: isLang(s.lang) ? s.lang : detectLang(),
    theme: s.theme === "light" || s.theme === "dark" ? s.theme : "auto",
    card: s.card === "senior" ? "senior" : "jeune",
    view: s.view === "map" ? "map" : "list",
  };
}

export function saveSettings(s: Settings): void {
  writeLS(KEY.settings, s);
}

// --- favorites & watched routes ---------------------------------------------

function sameRoute(a: RoutePair, b: RoutePair): boolean {
  return a.origin === b.origin && a.destination === b.destination;
}

export function loadFavorites(): RoutePair[] {
  return readLS<RoutePair[]>(KEY.favorites, [], Array.isArray);
}

export function isFavorite(r: RoutePair): boolean {
  return loadFavorites().some((f) => sameRoute(f, r));
}

export function toggleFavorite(r: RoutePair): RoutePair[] {
  const list = loadFavorites();
  const i = list.findIndex((f) => sameRoute(f, r));
  if (i >= 0) list.splice(i, 1);
  else list.push(r);
  writeLS(KEY.favorites, list);
  return list;
}

export function loadWatched(): RoutePair[] {
  return readLS<RoutePair[]>(KEY.watched, [], Array.isArray);
}

export function isWatched(r: RoutePair): boolean {
  return loadWatched().some((f) => sameRoute(f, r));
}

export function toggleWatched(r: RoutePair): RoutePair[] {
  const list = loadWatched();
  const i = list.findIndex((f) => sameRoute(f, r));
  if (i >= 0) list.splice(i, 1);
  else list.push(r);
  writeLS(KEY.watched, list);
  return list;
}

// --- saved trips ------------------------------------------------------------

/**
 * A saved travel: a single journey ("one-way"), a round trip (outbound +
 * inbound), or a multi-city "tour". Stored as a snapshot of the chosen trains so
 * it survives a data refresh — a record of intent the traveller can re-check on
 * SNCF Connect.
 */
export interface SavedTrip {
  id: string;
  kind: "one-way" | "round" | "tour";
  outbound: Journey; // for a tour, its first leg (used for the rail label)
  inbound?: Journey;
  tour?: Tour; // full itinerary when kind === "tour"
  savedAt: number; // epoch ms, for newest-first ordering
}

/** Key for one journey's legs (dates + train numbers). */
function journeyKey(j: Journey): string {
  return j.legs.map((l) => `${l.date}/${l.trainNo}`).join(">");
}

/** Stable identity for a trip: its legs' dates + train numbers (both directions). */
export function tripId(outbound: Journey, inbound?: Journey): string {
  return inbound ? `${journeyKey(outbound)}|${journeyKey(inbound)}` : journeyKey(outbound);
}

/** Stable identity for a tour: every hop's legs, in order (prefixed to avoid clashes). */
export function tourId(tour: Tour): string {
  return `tour:${tour.legs.map(journeyKey).join("|")}`;
}

export function loadTrips(): SavedTrip[] {
  return readLS<SavedTrip[]>(KEY.trips, [], Array.isArray);
}

export function isTripSaved(id: string): boolean {
  return loadTrips().some((t) => t.id === id);
}

/** Save a trip (no-op if already saved). Returns the updated, newest-first list. */
export function saveTrip(trip: SavedTrip): SavedTrip[] {
  const list = loadTrips();
  if (!list.some((t) => t.id === trip.id)) list.unshift(trip);
  writeLS(KEY.trips, list);
  return list;
}

export function removeTrip(id: string): SavedTrip[] {
  const list = loadTrips().filter((t) => t.id !== id);
  writeLS(KEY.trips, list);
  return list;
}

/** Save the trip if absent, else remove it. Returns whether it is now saved. */
export function toggleTrip(trip: SavedTrip): boolean {
  if (isTripSaved(trip.id)) {
    removeTrip(trip.id);
    return false;
  }
  saveTrip(trip);
  return true;
}

// --- URL deep-links ---------------------------------------------------------

export function queryToParams(q: SearchQuery): URLSearchParams {
  const p = new URLSearchParams();
  p.set("mode", q.mode);
  if (q.origin) p.set("from", q.origin);
  if (q.destination) p.set("to", q.destination);
  if (q.via) p.set("via", q.via);
  if (q.hidden) p.set("hidden", "1");
  if (q.flexDays != null && q.flexDays > 0) p.set("flex", String(q.flexDays));
  p.set("date", q.date);
  p.set("card", q.card);
  if (q.departAfter) p.set("after", q.departAfter);
  if (q.departBefore) p.set("before", q.departBefore);
  if (q.arriveBefore) p.set("arrbefore", q.arriveBefore);
  if (q.maxDurationMin != null) p.set("maxdur", String(q.maxDurationMin));
  if (q.trainType) p.set("type", q.trainType);
  if (q.maxConnections !== 1) p.set("conn", String(q.maxConnections));
  if (q.overnight) p.set("night", "1");
  if (q.excludeNight) p.set("nonight", "1");
  if (q.onlyNight) p.set("onlynight", "1");
  if (q.region) p.set("rg", q.region);
  if (q.cities && q.cities.length > 0) p.set("cities", q.cities.join("~"));
  if (q.minDays != null && q.minDays !== 1) p.set("dmin", String(q.minDays));
  if (q.maxDays != null && q.maxDays !== 3) p.set("dmax", String(q.maxDays));
  if (q.maxKm != null && q.maxKm > 0) p.set("maxkm", String(q.maxKm));
  if (q.maxLegKm != null && q.maxLegKm > 0) p.set("legkm", String(q.maxLegKm));
  if (q.maxLegDurationMin != null && q.maxLegDurationMin > 0) p.set("legdur", String(q.maxLegDurationMin));
  if (q.minLegDurationMin != null && q.minLegDurationMin > 0) p.set("legdurmin", String(q.minLegDurationMin));
  if (q.maxSpanDays != null && q.maxSpanDays > 0) p.set("span", String(q.maxSpanDays));
  if (q.radiusKm != null && q.radiusKm > 0) p.set("rad", String(q.radiusKm));
  if (q.roundTrip) p.set("rt", "1");
  if (q.nights != null && q.nights > 0) p.set("nights", String(q.nights));
  if (q.flexNights) p.set("fn", "1");
  if (q.stayMinHours != null && q.stayMinHours > 0) p.set("stayh", String(q.stayMinHours));
  if (q.lateReturn) p.set("late", "1");
  if (q.tourEndDate) p.set("by", q.tourEndDate);
  if (q.sort && q.sort !== "rec") p.set("sort", q.sort);
  return p;
}

const SORT_KEYS = ["rec", "trains", "days", "closest", "fastest", "name"] as const;

export function queryFromParams(p: URLSearchParams, fallbackDate: string): SearchQuery {
  const rawMode = p.get("mode") ?? "from";
  const mode = (["from", "to", "od", "best", "tour"].includes(rawMode) ? rawMode : "from") as SearchMode;
  const maxdur = Number(p.get("maxdur"));
  const connRaw = p.get("conn");
  const conn = connRaw == null ? 1 : Number(connRaw);
  const cities = p.get("cities");
  const dmin = Number(p.get("dmin"));
  const dmax = Number(p.get("dmax"));
  const maxkm = Number(p.get("maxkm"));
  const legkm = Number(p.get("legkm"));
  const legdur = Number(p.get("legdur"));
  const legdurmin = Number(p.get("legdurmin"));
  const span = Number(p.get("span"));
  const rad = Number(p.get("rad"));
  const nights = Number(p.get("nights"));
  const stayh = Number(p.get("stayh"));
  const clampDay = (n: number, fallback: number): number =>
    Number.isFinite(n) && n >= 1 ? Math.min(14, Math.floor(n)) : fallback;
  return {
    mode,
    origin: p.get("from") ?? undefined,
    destination: p.get("to") ?? undefined,
    via: p.get("via") ?? undefined,
    // od-only; readQueryFromForm re-gates it to od so it never leaks to other modes.
    hidden: p.get("hidden") === "1" || undefined,
    // Clamp to the stepper's 0..7 range (like setStepper) — an out-of-range link
    // should mean "the widest window", not silently fall back to no flexibility.
    flexDays: Number.isFinite(Number(p.get("flex"))) && Math.floor(Number(p.get("flex"))) >= 1 ? Math.min(7, Math.floor(Number(p.get("flex")))) : undefined,
    date: p.get("date") ?? fallbackDate,
    card: p.get("card") === "senior" ? "senior" : "jeune",
    departAfter: p.get("after") ?? undefined,
    departBefore: p.get("before") ?? undefined,
    arriveBefore: p.get("arrbefore") ?? undefined,
    maxDurationMin: Number.isFinite(maxdur) && maxdur > 0 ? maxdur : undefined,
    trainType: p.get("type") ?? undefined,
    maxConnections: Number.isFinite(conn) && conn >= 0 && conn <= 6 ? conn : 1,
    overnight: p.get("night") === "1" || undefined,
    excludeNight: p.get("nonight") === "1" || undefined,
    onlyNight: p.get("onlynight") === "1" || undefined,
    region: p.get("rg") ?? undefined,
    cities: cities ? cities.split("~").filter(Boolean) : undefined,
    minDays: p.has("dmin") ? clampDay(dmin, 1) : undefined,
    maxDays: p.has("dmax") ? clampDay(dmax, 3) : undefined,
    maxKm: Number.isFinite(maxkm) && maxkm > 0 ? Math.floor(maxkm) : undefined,
    maxLegKm: Number.isFinite(legkm) && legkm > 0 ? Math.floor(legkm) : undefined,
    // Per-train time cap (tour). readQueryFromForm re-gates it to tour mode.
    maxLegDurationMin: Number.isFinite(legdur) && legdur > 0 ? Math.max(30, Math.floor(legdur)) : undefined,
    minLegDurationMin: Number.isFinite(legdurmin) && legdurmin > 0 ? Math.floor(legdurmin) : undefined,
    // od-only; readQueryFromForm re-gates it to od so it never leaks to other modes.
    maxSpanDays: Number.isFinite(span) && span > 0 ? Math.min(14, Math.floor(span)) : undefined,
    // Search radius (km) for nearby paid-hop alternatives (od + browse modes).
    // readQueryFromForm re-gates it to those modes so it never leaks elsewhere.
    radiusKm: Number.isFinite(rad) && rad > 0 ? Math.min(300, Math.floor(rad)) : undefined,
    // "Round trip" (day trips + N-night getaways) — readQueryFromForm re-gates to "from".
    roundTrip: p.get("rt") === "1" || undefined,
    nights: Number.isFinite(nights) && nights >= 1 ? Math.min(3, Math.floor(nights)) : undefined,
    flexNights: p.get("fn") === "1" || undefined,
    stayMinHours: Number.isFinite(stayh) && stayh >= 1 ? Math.min(12, Math.floor(stayh)) : undefined,
    lateReturn: p.get("late") === "1" || undefined,
    tourEndDate: p.get("by") ?? undefined,
    sort: parseSort(p.get("sort")),
  };
}

/** Validate a URL sort value against the known keys (undefined = the default rank). */
function parseSort(raw: string | null): SortKey | undefined {
  return raw && (SORT_KEYS as readonly string[]).includes(raw) ? (raw as SortKey) : undefined;
}

export function updateUrl(q: SearchQuery): void {
  history.replaceState(null, "", `${location.pathname}?${queryToParams(q).toString()}`);
}

/** Push a new history entry, so the browser Back button returns to the prior page. */
export function pushUrl(q: SearchQuery): void {
  history.pushState(null, "", `${location.pathname}?${queryToParams(q).toString()}`);
}

export function urlHasQuery(): boolean {
  const p = new URLSearchParams(location.search);
  return p.has("from") || p.has("to") || p.has("mode");
}
