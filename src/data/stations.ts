import type { Station } from "../types";
import { CITY_REFERENCE } from "./cities";

/** Lowercase, strip accents/diacritics for tolerant matching. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Tolerant match key for city resolution: accent/case-folded, hyphens → spaces,
 * "St"/"Ste" → "Saint"/"Sainte". Lets "ST MALO", "Saint-Malo" and "SAINT MALO"
 * all resolve to the same city.
 */
export function matchNorm(s: string): string {
  return normalizeText(s)
    .replace(/[(),]/g, " ") // e.g. "ESSLINGEN(NECKAR)" -> "esslingen neckar"
    .replace(/-/g, " ")
    .replace(/\bst\b/g, "saint")
    .replace(/\bste\b/g, "sainte")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fallback display name for a station id not present in the registry. */
export function prettyLabel(id: string): string {
  return id
    .replace(/\s*\(intramuros\)/i, "")
    .toLowerCase()
    .replace(/(^|[\s'-])([a-zà-ÿ])/g, (_m, p1: string, p2: string) => p1 + p2.toUpperCase());
}

interface CityInfo {
  lat: number;
  lng: number;
  city: string;
  region?: string;
}

// Station-name qualifiers stripped when guessing a city name for guide links.
const QUALIFIERS = new Set([
  "tgv", "ville", "intramuros", "gare", "sncf", "hb", "centrale", "midi", "nord",
  "sud", "est", "ouest", "centre", "europe", "flandres", "sants", "atocha",
  "delicias", "main", "porta", "susa",
]);

export class StationRegistry {
  private byId = new Map<string, Station>();
  private index: { station: Station; hay: string; words: string[] }[] = [];
  // City coordinate references, longest key first, so specific names ("lille
  // flandres") win over short prefixes ("lille") when matching a station id.
  private cityKeys: { key: string; info: CityInfo }[] = [];
  // Ids actually present in the loaded dataset (i.e. bookable).
  private present = new Set<string>();

  constructor(stations: Station[]) {
    for (const s of stations) this.add(s);

    const refMap = new Map<string, CityInfo>();
    const addRef = (name: string | undefined, info: CityInfo): void => {
      if (!name) return;
      const k = matchNorm(name);
      if (k && !refMap.has(k)) refMap.set(k, info);
    };
    // Seed from curated stations (authoritative coords), then the supplementary
    // city table for the smaller / international stations.
    for (const s of this.byId.values()) {
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
      const info: CityInfo = { lat: s.lat, lng: s.lng, city: s.city ?? s.label, region: s.region };
      addRef(s.label, info);
      addRef(s.city, info);
      for (const a of s.aliases ?? []) addRef(a, info);
    }
    for (const c of CITY_REFERENCE) {
      const info: CityInfo = { lat: c.lat, lng: c.lng, city: c.name, region: c.region };
      addRef(c.name, info);
      for (const a of c.aliases ?? []) addRef(a, info);
    }
    this.cityKeys = [...refMap.entries()]
      .map(([key, info]) => ({ key, info }))
      .sort((a, b) => b.key.length - a.key.length);
  }

  private add(s: Station): void {
    this.byId.set(s.id, s);
    const hay = [s.id, s.label, s.city ?? "", ...(s.aliases ?? [])]
      .map(normalizeText)
      .join(" ");
    this.index.push({ station: s, hay, words: hay.split(/\s+/).filter(Boolean) });
  }

  /** Best city reference matching a station id (whole-word, longest match). */
  private matchCity(id: string): CityInfo | undefined {
    const n = matchNorm(id);
    if (!n) return undefined;
    for (const { key, info } of this.cityKeys) {
      if (n === key || n.startsWith(`${key} `) || n.endsWith(` ${key}`) || n.includes(` ${key} `)) {
        return info;
      }
    }
    return undefined;
  }

  /**
   * Add minimal entries for any ids not already known, so every station in the
   * dataset is searchable. Coordinates, city and region are inherited from the
   * nearest city reference when one matches (else the station stays unplotted).
   * Every id passed here is also recorded as "present" (bookable).
   */
  addMissing(ids: Iterable<string>): void {
    for (const id of ids) {
      if (!id) continue;
      this.present.add(id);
      if (this.byId.has(id)) continue;
      const m = this.matchCity(id);
      this.add({
        id,
        label: prettyLabel(id),
        lat: m ? m.lat : NaN,
        lng: m ? m.lng : NaN,
        city: m?.city,
        region: m?.region,
      });
    }
  }

  get(id: string): Station | undefined {
    return this.byId.get(id);
  }

  /** Every registered station (may contain label duplicates). */
  all(): Station[] {
    return [...this.byId.values()];
  }

  /** Display-ready stations, one per label, preferring bookable / located ids. */
  list(): Station[] {
    return this.dedupe(this.all());
  }

  label(id: string): string {
    return this.byId.get(id)?.label ?? prettyLabel(id);
  }

  /** Best-guess city name for a station, used for external info links. */
  city(id: string): string {
    const s = this.byId.get(id);
    if (s?.city) return s.city;
    const m = this.matchCity(id);
    if (m) return m.city;
    return this.stripQualifiers(this.label(id));
  }

  private stripQualifiers(label: string): string {
    const kept = label.split(/[\s-]+/).filter((w) => !QUALIFIERS.has(normalizeText(w)));
    return kept.join(" ").trim() || label;
  }

  coords(id: string): [number, number] | undefined {
    const s = this.byId.get(id);
    return s && Number.isFinite(s.lat) && Number.isFinite(s.lng) ? [s.lat, s.lng] : undefined;
  }

  /** Accent-insensitive, word-prefix-aware autocomplete (deduped by label). */
  search(query: string, limit = 8): Station[] {
    const q = normalizeText(query);
    if (!q) {
      return this.list()
        .sort((a, b) => a.label.localeCompare(b.label))
        .slice(0, limit);
    }
    const prefix: Station[] = [];
    const contains: Station[] = [];
    for (const { station, hay, words } of this.index) {
      if (words.some((w) => w.startsWith(q))) prefix.push(station);
      else if (hay.includes(q)) contains.push(station);
    }
    return this.dedupe([...prefix, ...contains]).slice(0, limit);
  }

  /** Prefer a bookable id, then one with coordinates, else keep the first seen. */
  private better(a: Station, b: Station): boolean {
    const pa = this.present.has(a.id);
    const pb = this.present.has(b.id);
    if (pa !== pb) return pa;
    const ca = Number.isFinite(a.lat) && Number.isFinite(a.lng);
    const cb = Number.isFinite(b.lat) && Number.isFinite(b.lng);
    if (ca !== cb) return ca;
    return false;
  }

  private dedupe(stations: Station[]): Station[] {
    const byLabel = new Map<string, Station>();
    const order: string[] = [];
    for (const s of stations) {
      const k = normalizeText(s.label);
      const cur = byLabel.get(k);
      if (!cur) {
        byLabel.set(k, s);
        order.push(k);
      } else if (this.better(s, cur)) {
        byLabel.set(k, s);
      }
    }
    return order.map((k) => byLabel.get(k)!);
  }
}
