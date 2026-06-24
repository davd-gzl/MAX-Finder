import type { SearchQuery, SearchMode, CardType } from "../types";
import type { Lang } from "../i18n";

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
    lang: s.lang === "en" ? "en" : "fr",
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
  p.set("date", q.date);
  p.set("card", q.card);
  if (q.departAfter) p.set("after", q.departAfter);
  if (q.departBefore) p.set("before", q.departBefore);
  if (q.maxDurationMin != null) p.set("maxdur", String(q.maxDurationMin));
  if (q.trainType) p.set("type", q.trainType);
  if (!q.allowConnections) p.set("nc", "1");
  return p;
}

export function queryFromParams(p: URLSearchParams, fallbackDate: string): SearchQuery {
  const rawMode = p.get("mode") ?? "from";
  const mode = (["from", "to", "od"].includes(rawMode) ? rawMode : "from") as SearchMode;
  const maxdur = Number(p.get("maxdur"));
  return {
    mode,
    origin: p.get("from") ?? undefined,
    destination: p.get("to") ?? undefined,
    date: p.get("date") ?? fallbackDate,
    card: p.get("card") === "senior" ? "senior" : "jeune",
    departAfter: p.get("after") ?? undefined,
    departBefore: p.get("before") ?? undefined,
    maxDurationMin: Number.isFinite(maxdur) && maxdur > 0 ? maxdur : undefined,
    trainType: p.get("type") ?? undefined,
    allowConnections: p.get("nc") !== "1",
  };
}

export function updateUrl(q: SearchQuery): void {
  history.replaceState(null, "", `${location.pathname}?${queryToParams(q).toString()}`);
}

export function urlHasQuery(): boolean {
  const p = new URLSearchParams(location.search);
  return p.has("from") || p.has("to") || p.has("mode");
}
