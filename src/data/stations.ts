import type { Station } from "../types";

/** Lowercase, strip accents/diacritics for tolerant matching. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Fallback display name for a station id not present in the registry. */
export function prettyLabel(id: string): string {
  return id
    .replace(/\s*\(intramuros\)/i, "")
    .toLowerCase()
    .replace(/(^|[\s'-])([a-zà-ÿ])/g, (_m, p1: string, p2: string) => p1 + p2.toUpperCase());
}

export class StationRegistry {
  private byId = new Map<string, Station>();
  private index: { station: Station; hay: string; words: string[] }[] = [];
  private cityCoords = new Map<string, [number, number]>();

  constructor(stations: Station[]) {
    for (const s of stations) this.add(s);
    // Index coordinates by city / first word so station-name variants (e.g.
    // "LILLE FLANDRES", "LILLE EUROPE") can inherit the city's coordinates.
    for (const s of this.byId.values()) {
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
      const keys: string[] = [];
      const first = normalizeText(s.label).split(/\s+/)[0];
      if (first) keys.push(first);
      if (s.city) keys.push(normalizeText(s.city));
      for (const key of keys) {
        if (!this.cityCoords.has(key)) this.cityCoords.set(key, [s.lat, s.lng]);
      }
    }
  }

  private add(s: Station): void {
    this.byId.set(s.id, s);
    const hay = [s.id, s.label, s.city ?? "", ...(s.aliases ?? [])]
      .map(normalizeText)
      .join(" ");
    this.index.push({ station: s, hay, words: hay.split(/\s+/).filter(Boolean) });
  }

  /**
   * Add minimal entries (label only, no coordinates) for any ids not already known,
   * so every station present in the dataset is searchable even if it isn't in the
   * curated registry. Such stations are listed/searchable but not plotted on the map.
   */
  addMissing(ids: Iterable<string>): void {
    for (const id of ids) {
      if (!id || this.byId.has(id)) continue;
      const first = normalizeText(id).split(/\s+/)[0] ?? "";
      const c = this.cityCoords.get(first);
      this.add({ id, label: prettyLabel(id), lat: c ? c[0] : NaN, lng: c ? c[1] : NaN });
    }
  }

  get(id: string): Station | undefined {
    return this.byId.get(id);
  }

  all(): Station[] {
    return [...this.byId.values()];
  }

  label(id: string): string {
    return this.byId.get(id)?.label ?? prettyLabel(id);
  }

  /** Best-guess city name for a station, used for external info links. */
  city(id: string): string {
    return this.byId.get(id)?.city ?? this.label(id);
  }

  coords(id: string): [number, number] | undefined {
    const s = this.byId.get(id);
    return s && Number.isFinite(s.lat) && Number.isFinite(s.lng) ? [s.lat, s.lng] : undefined;
  }

  /** Accent-insensitive, word-prefix-aware autocomplete. */
  search(query: string, limit = 8): Station[] {
    const q = normalizeText(query);
    if (!q) {
      return this.all()
        .sort((a, b) => a.label.localeCompare(b.label))
        .slice(0, limit);
    }
    const prefix: Station[] = [];
    const contains: Station[] = [];
    for (const { station, hay, words } of this.index) {
      if (words.some((w) => w.startsWith(q))) prefix.push(station);
      else if (hay.includes(q)) contains.push(station);
    }
    const seen = new Set<string>();
    return [...prefix, ...contains]
      .filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)))
      .slice(0, limit);
  }
}
