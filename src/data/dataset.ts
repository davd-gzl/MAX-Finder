import type { RawRecord, MaxTrain, DataMeta } from "../types";
import { DATA_URL, META_URL, SAMPLE_DATA_URL } from "../config";
import { parseTimeToMinutes, minutesToHHMM } from "../util/time";

/** Normalize one raw SNCF record into a `MaxTrain`. Returns null if invalid. */
export function normalizeRecord(r: RawRecord): MaxTrain | null {
  if (!r || !r.origine || !r.destination || !r.date) return null;
  const departMin = parseTimeToMinutes(r.heure_depart);
  let arriveMin = parseTimeToMinutes(r.heure_arrivee);
  if (Number.isNaN(departMin) || Number.isNaN(arriveMin)) return null;
  if (arriveMin < departMin) arriveMin += 1440; // crosses midnight
  return {
    date: r.date,
    origin: r.origine.trim(),
    destination: r.destination.trim(),
    depart: minutesToHHMM(departMin),
    arrive: minutesToHHMM(arriveMin),
    departMin,
    arriveMin,
    durationMin: arriveMin - departMin,
    trainNo: String(r.train_no ?? "").trim(),
    available: String(r.od_happy_card ?? "").trim().toUpperCase() === "OUI",
    axe: r.axe?.trim() || undefined,
  };
}

export function normalizeRecords(rows: RawRecord[]): MaxTrain[] {
  const out: MaxTrain[] = [];
  for (const r of rows) {
    const n = normalizeRecord(r);
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
 * Load the committed daily snapshot. Falls back to the bundled sample fixture
 * if the snapshot is missing/empty, so the app always has something to show.
 */
export async function loadDataset(): Promise<Dataset> {
  const meta = await fetchJson<DataMeta>(META_URL).catch(() => null);
  let rows = await fetchJson<RawRecord[]>(DATA_URL).catch(() => null);
  if (!rows || rows.length === 0) {
    rows = (await fetchJson<RawRecord[]>(SAMPLE_DATA_URL).catch(() => [])) ?? [];
  }
  const trains = normalizeRecords(rows ?? []);
  return {
    trains,
    meta: meta ?? { updatedAt: "", source: "unknown", recordCount: trains.length },
  };
}
