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

  constructor(stations: Station[]) {
    for (const s of stations) {
      this.byId.set(s.id, s);
      const hay = [s.id, s.label, s.city ?? "", ...(s.aliases ?? [])]
        .map(normalizeText)
        .join(" ");
      this.index.push({ station: s, hay, words: hay.split(/\s+/).filter(Boolean) });
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

  coords(id: string): [number, number] | undefined {
    const s = this.byId.get(id);
    return s ? [s.lat, s.lng] : undefined;
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
