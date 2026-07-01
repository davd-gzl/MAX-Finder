import type { RawRecord, MaxTrain, DataMeta } from "../types";
import { parseTimeToMinutes, minutesToHHMM } from "../util/time";
import { normalizeText } from "./stations";
import { SNCF_PROFILE, type DatasetProfile, type RawSourceRecord } from "./profile";
import sampleData from "../../data/tgvmax.sample.json";

/** Accent-insensitive substring match of a station name against a pattern list. */
function matchesPattern(name: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  const n = normalizeText(name);
  return patterns.some((p) => n.includes(p));
}

/**
 * Normalize one raw record into a `MaxTrain`, reading fields and the "bookable"
 * rule through a {@link DatasetProfile} (default: SNCF). Returns null if invalid.
 */
export function normalizeRecord(r: RawRecord, profile: DatasetProfile = SNCF_PROFILE): MaxTrain | null {
  if (!r) return null;
  const f = profile.read(r as unknown as RawSourceRecord);
  const origin = f.origin;
  const destination = f.destination;
  if (!origin || !destination || !f.date) return null;
  if (origin === destination) return null; // skip self-loops (X → X)
  const departMin = parseTimeToMinutes(f.depart ?? "");
  let arriveMin = parseTimeToMinutes(f.arrive ?? "");
  if (Number.isNaN(departMin) || Number.isNaN(arriveMin)) return null;
  if (arriveMin < departMin) arriveMin += 1440; // crosses midnight
  // Bookable only if the source's rule says so AND neither endpoint is a
  // non-bookable (e.g. international) stop the pass doesn't cover.
  const reservable = profile.isReservable(r as unknown as RawSourceRecord);
  const excluded =
    matchesPattern(origin, profile.nonBookablePatterns) ||
    matchesPattern(destination, profile.nonBookablePatterns);
  return {
    date: f.date,
    origin,
    destination,
    depart: minutesToHHMM(departMin),
    arrive: minutesToHHMM(arriveMin),
    departMin,
    arriveMin,
    durationMin: arriveMin - departMin,
    trainNo: f.trainNo ?? "",
    available: reservable && !excluded,
    axe: f.category,
  };
}

export function normalizeRecords(rows: RawRecord[], profile: DatasetProfile = SNCF_PROFILE): MaxTrain[] {
  const out: MaxTrain[] = [];
  for (const r of rows) {
    const n = normalizeRecord(r, profile);
    if (n) out.push(n);
  }
  return out;
}

export interface Dataset {
  trains: MaxTrain[];
  meta: DataMeta;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

/**
 * Load the committed daily snapshot for a {@link DatasetProfile} (default: SNCF).
 * Falls back to the bundled sample fixture if the snapshot is missing/empty, so the
 * app always has something to show.
 */
export async function loadDataset(profile: DatasetProfile = SNCF_PROFILE): Promise<Dataset> {
  const meta = await fetchJson<DataMeta>(profile.metaUrl).catch(() => null);
  let rows = await fetchJson<RawRecord[]>(profile.dataUrl).catch(() => null);
  let usedSample = false;
  if (!rows || rows.length === 0) {
    rows = sampleData as RawRecord[]; // bundled fixture: app still works offline
    usedSample = true;
  }
  const trains = normalizeRecords(rows, profile);
  return {
    trains,
    meta:
      meta ??
      ({
        updatedAt: "",
        source: usedSample ? "sample" : "unknown",
        recordCount: trains.length,
        isSample: usedSample,
      } as DataMeta),
  };
}
