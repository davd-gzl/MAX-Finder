import type { SearchQuery, SearchMode, CardType } from "../types";
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
  if (q.region) p.set("rg", q.region);
  if (q.cities && q.cities.length > 0) p.set("cities", q.cities.join("~"));
  if (q.minDays != null && q.minDays !== 1) p.set("dmin", String(q.minDays));
  if (q.maxDays != null && q.maxDays !== 3) p.set("dmax", String(q.maxDays));
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
    region: p.get("rg") ?? undefined,
    cities: cities ? cities.split("~").filter(Boolean) : undefined,
    minDays: p.has("dmin") ? clampDay(dmin, 1) : undefined,
    maxDays: p.has("dmax") ? clampDay(dmax, 3) : undefined,
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
