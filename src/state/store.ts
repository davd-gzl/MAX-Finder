import type { SearchQuery, SearchMode, CardType, Journey } from "../types";
import { isLang, detectLang, type Lang } from "../i18n";

export type Theme = "light" | "dark" | "auto";

export interface RoutePair {
  origin: string;
  destination: string;
}

export interface Settings {
  lang: Lang;
  theme: Theme;
  card: CardType;
}

const KEY = {
  settings: "mj.settings",
  favorites: "mj.favorites",
  watched: "mj.watched",
  trips: "mj.trips",
} as const;

function readLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
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
  const s = readLS<Partial<Settings>>(KEY.settings, {});
  return {
    lang: isLang(s.lang) ? s.lang : detectLang(),
    theme: s.theme === "light" || s.theme === "dark" ? s.theme : "auto",
    card: s.card === "senior" ? "senior" : "jeune",
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
  return readLS<RoutePair[]>(KEY.favorites, []);
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
  return readLS<RoutePair[]>(KEY.watched, []);
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
 * A saved travel: a single journey ("one-way") or a round trip (outbound +
 * inbound). Stored as a snapshot of the chosen trains so it survives a data
 * refresh — a record of intent the traveller can re-check on SNCF Connect.
 */
export interface SavedTrip {
  id: string;
  kind: "one-way" | "round";
  outbound: Journey;
  inbound?: Journey;
  savedAt: number; // epoch ms, for newest-first ordering
}

/** Stable identity for a trip: its legs' dates + train numbers (both directions). */
export function tripId(outbound: Journey, inbound?: Journey): string {
  const legs = (j: Journey): string => j.legs.map((l) => `${l.date}/${l.trainNo}`).join(">");
  return inbound ? `${legs(outbound)}|${legs(inbound)}` : legs(outbound);
}

export function loadTrips(): SavedTrip[] {
  return readLS<SavedTrip[]>(KEY.trips, []);
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
  if (q.flexDays != null && q.flexDays > 0) p.set("flex", String(q.flexDays));
  p.set("date", q.date);
  p.set("card", q.card);
  if (q.departAfter) p.set("after", q.departAfter);
  if (q.departBefore) p.set("before", q.departBefore);
  if (q.maxDurationMin != null) p.set("maxdur", String(q.maxDurationMin));
  if (q.trainType) p.set("type", q.trainType);
  if (q.maxConnections !== 1) p.set("conn", String(q.maxConnections));
  if (q.overnight) p.set("night", "1");
  if (q.excludeNight) p.set("nonight", "1");
  if (q.region) p.set("rg", q.region);
  if (q.cities && q.cities.length > 0) p.set("cities", q.cities.join("~"));
  if (q.minDays != null && q.minDays !== 1) p.set("dmin", String(q.minDays));
  if (q.maxDays != null && q.maxDays !== 3) p.set("dmax", String(q.maxDays));
  if (q.maxKm != null && q.maxKm > 0) p.set("maxkm", String(q.maxKm));
  if (q.maxLegKm != null && q.maxLegKm > 0) p.set("legkm", String(q.maxLegKm));
  if (q.maxLegDurationMin != null && q.maxLegDurationMin > 0) p.set("legdur", String(q.maxLegDurationMin));
  if (q.maxSpanDays != null && q.maxSpanDays > 0) p.set("span", String(q.maxSpanDays));
  if (q.radiusKm != null && q.radiusKm > 0) p.set("rad", String(q.radiusKm));
  if (q.roundTrip) p.set("rt", "1");
  if (q.nights != null && q.nights > 0) p.set("nights", String(q.nights));
  if (q.flexNights) p.set("fn", "1");
  if (q.stayMinHours != null && q.stayMinHours > 0) p.set("stayh", String(q.stayMinHours));
  if (q.lateReturn) p.set("late", "1");
  if (q.tourEndDate) p.set("by", q.tourEndDate);
  return p;
}

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
    flexDays: [1, 2, 3, 7].includes(Number(p.get("flex"))) ? Number(p.get("flex")) : undefined,
    date: p.get("date") ?? fallbackDate,
    card: p.get("card") === "senior" ? "senior" : "jeune",
    departAfter: p.get("after") ?? undefined,
    departBefore: p.get("before") ?? undefined,
    maxDurationMin: Number.isFinite(maxdur) && maxdur > 0 ? maxdur : undefined,
    trainType: p.get("type") ?? undefined,
    maxConnections: Number.isFinite(conn) && conn >= 0 && conn <= 6 ? conn : 1,
    overnight: p.get("night") === "1" || undefined,
    excludeNight: p.get("nonight") === "1" || undefined,
    region: p.get("rg") ?? undefined,
    cities: cities ? cities.split("~").filter(Boolean) : undefined,
    minDays: p.has("dmin") ? clampDay(dmin, 1) : undefined,
    maxDays: p.has("dmax") ? clampDay(dmax, 3) : undefined,
    maxKm: Number.isFinite(maxkm) && maxkm > 0 ? Math.floor(maxkm) : undefined,
    maxLegKm: Number.isFinite(legkm) && legkm > 0 ? Math.floor(legkm) : undefined,
    // Per-train time cap (tour). readQueryFromForm re-gates it to tour mode.
    maxLegDurationMin: Number.isFinite(legdur) && legdur > 0 ? Math.max(30, Math.floor(legdur)) : undefined,
    // od-only; readQueryFromForm re-gates it to od so it never leaks to other modes.
    maxSpanDays: Number.isFinite(span) && span > 0 ? Math.min(14, Math.floor(span)) : undefined,
    // od-only search radius (km) for nearby paid-connection alternatives.
    radiusKm: Number.isFinite(rad) && rad > 0 ? Math.min(300, Math.floor(rad)) : undefined,
    // "Round trip" (day trips + N-night getaways) — readQueryFromForm re-gates to "from".
    roundTrip: p.get("rt") === "1" || undefined,
    nights: Number.isFinite(nights) && nights >= 1 ? Math.min(3, Math.floor(nights)) : undefined,
    flexNights: p.get("fn") === "1" || undefined,
    stayMinHours: Number.isFinite(stayh) && stayh >= 1 ? Math.min(12, Math.floor(stayh)) : undefined,
    lateReturn: p.get("late") === "1" || undefined,
    tourEndDate: p.get("by") ?? undefined,
  };
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
