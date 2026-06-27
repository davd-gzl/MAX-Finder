import type { MaxTrain, Journey } from "../types";
import { HUB_STATIONS, MIN_CONNECTION_MIN, MAX_CONNECTION_MIN } from "../config";
import { absoluteMinute, addDays, dayIndex, parseTimeToMinutes } from "../util/time";

export interface ConnectionOptions {
  /** 0 = direct only, 1 = one change (default), 2 = two changes. */
  maxConnections?: number;
  hubs?: string[];
  minConnectionMin?: number;
  maxConnectionMin?: number;
  departAfter?: string; // constrains the first leg only
  departBefore?: string;
  maxDurationMin?: number; // total journey duration
  trainType?: string;
  /**
   * How many calendar days of trains to pool, so a journey may chain hops with
   * multi-day stopovers at hubs ("trip over up to N days"). Default 2 — the chosen
   * day plus the next, enough for a normal connection across midnight. Larger spans
   * raise the layover ceiling to the span and widen the pool accordingly.
   */
  spanDays?: number;
}

// Safety bounds for the multi-day search: a wide span with several changes could
// otherwise enumerate an enormous number of itineraries. We stop collecting at the
// result cap, and bail the whole DFS if it expands too many nodes (pathological
// fan-out), so the search always returns promptly.
export const MAX_RESULTS = 200;
const MAX_DFS_EXPANSIONS = 400_000;

// Cache of available trains grouped by date, keyed by the (stable, loaded-once)
// trains array. Avoids re-scanning the whole dataset on every journey lookup —
// matters when callers run findJourneys many times (30-day calendar, best mode).
const byDateCache = new WeakMap<MaxTrain[], Map<string, MaxTrain[]>>();

// Memoize journey lookups per (stable) trains array. The 30-day calendar and
// repeated / back navigation hit the same routes many times; WeakMap keying by
// the trains array keeps results correct across different datasets (e.g. tests).
const journeyCache = new WeakMap<MaxTrain[], Map<string, Journey[]>>();

function journeyMemo(trains: MaxTrain[]): Map<string, Journey[]> {
  let m = journeyCache.get(trains);
  if (!m) {
    m = new Map();
    journeyCache.set(trains, m);
  }
  return m;
}

function availableByDate(trains: MaxTrain[]): Map<string, MaxTrain[]> {
  const cached = byDateCache.get(trains);
  if (cached) return cached;
  const idx = new Map<string, MaxTrain[]>();
  for (const t of trains) {
    if (!t.available) continue;
    const arr = idx.get(t.date);
    if (arr) arr.push(t);
    else idx.set(t.date, [t]);
  }
  byDateCache.set(trains, idx);
  return idx;
}

/** Build a Journey from an ordered list of legs (1..n), on an absolute timeline. */
export function toJourney(legs: MaxTrain[]): Journey {
  const first = legs[0];
  const last = legs[legs.length - 1];
  if (!first || !last) throw new Error("toJourney requires at least one leg");
  const layovers: number[] = [];
  const hubs: string[] = [];
  for (let i = 1; i < legs.length; i++) {
    const prev = legs[i - 1];
    const cur = legs[i];
    if (!prev || !cur) continue;
    layovers.push(absoluteMinute(cur.date, cur.departMin) - absoluteMinute(prev.date, prev.arriveMin));
    hubs.push(prev.destination);
  }
  return {
    date: first.date,
    origin: first.origin,
    destination: last.destination,
    legs,
    departMin: first.departMin,
    arriveMin: last.arriveMin,
    totalDurationMin:
      absoluteMinute(last.date, last.arriveMin) - absoluteMinute(first.date, first.departMin),
    connectionMin: layovers.length === 1 ? layovers[0] : undefined,
    hub: hubs.length === 1 ? hubs[0] : undefined,
    layovers,
    hubs,
  };
}

function dedupe(journeys: Journey[]): Journey[] {
  const seen = new Set<string>();
  const out: Journey[] = [];
  for (const j of journeys) {
    const key = `${j.legs.map((l) => `${l.date}/${l.trainNo}@${l.origin}`).join(">")}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(j);
    }
  }
  return out;
}

/**
 * Find journeys from `origin` to `destination` departing on `date`, with up to
 * `maxConnections` changes. Connecting legs may fall on the following day, so a
 * leg arriving just after midnight can still connect; layovers and total duration
 * are computed on an absolute (cross-date) timeline. Intermediate stops must be
 * hubs; each layover must fall within the allowed window; no station is visited
 * twice. Sorted by departure, then total duration, then fewest legs.
 */
export function findJourneys(
  trains: MaxTrain[],
  origin: string,
  destination: string,
  date: string,
  opts: ConnectionOptions = {},
): Journey[] {
  const maxConn = opts.maxConnections ?? 1;
  const hubSet = new Set(opts.hubs ?? HUB_STATIONS);
  const minC = opts.minConnectionMin ?? MIN_CONNECTION_MIN;
  // Pool `span` calendar days (≥2). A multi-day span also raises the layover
  // ceiling to the span, so a hop can wait days at a hub, not just hours.
  const span = Math.max(2, Math.floor(opts.spanDays ?? 2));
  const baseMaxC = opts.maxConnectionMin ?? MAX_CONNECTION_MIN;
  const maxC = span > 2 ? Math.max(baseMaxC, (span - 1) * 1440) : baseMaxC;

  const memo = journeyMemo(trains);
  const key = `${origin}>${destination}@${date}|${maxConn}|${minC}-${maxC}|${span}|${opts.departAfter ?? ""}|${opts.departBefore ?? ""}|${opts.maxDurationMin ?? ""}|${opts.trainType ?? ""}|${[...hubSet].join(",")}`;
  const cached = memo.get(key);
  if (cached) return cached;

  // Available legs departing within the pooled window (so connections can cross
  // midnight, and multi-day trips can stop over at hubs). From a cached per-date
  // index, then sorted.
  const idx = availableByDate(trains);
  let pool: MaxTrain[] = [];
  for (let i = 0; i < span; i++) pool.push(...(idx.get(addDays(date, i)) ?? []));
  if (opts.trainType) pool = pool.filter((t) => (t.axe ?? "") === opts.trainType);
  pool.sort((a, b) => absoluteMinute(a.date, a.departMin) - absoluteMinute(b.date, b.departMin));

  // The first leg must depart on `date`, within the user's time window.
  const after = opts.departAfter ? parseTimeToMinutes(opts.departAfter) : undefined;
  const before = opts.departBefore ? parseTimeToMinutes(opts.departBefore) : undefined;
  const firstPool = pool.filter(
    (t) =>
      t.date === date &&
      (after === undefined || t.departMin >= after) &&
      (before === undefined || t.departMin <= before),
  );

  const byOrigin = new Map<string, MaxTrain[]>();
  for (const t of pool) {
    const arr = byOrigin.get(t.origin);
    if (arr) arr.push(t);
    else byOrigin.set(t.origin, [t]);
  }

  const results: Journey[] = [];
  const path: MaxTrain[] = [];
  let expansions = 0;

  const dfs = (): void => {
    // Bounds for the multi-day search: stop once we have plenty, or if the search
    // fans out pathologically (a wide span × several changes).
    if (results.length >= MAX_RESULTS || expansions >= MAX_DFS_EXPANSIONS) return;
    expansions++;
    const last = path[path.length - 1];
    if (!last) return;
    if (last.destination === destination) {
      results.push(toJourney([...path]));
      return;
    }
    if (path.length - 1 >= maxConn) return; // used all allowed changes
    if (!hubSet.has(last.destination)) return; // intermediate must be a hub
    const visited = new Set<string>();
    for (const l of path) {
      visited.add(l.origin);
      visited.add(l.destination);
    }
    const lastArr = absoluteMinute(last.date, last.arriveMin);
    for (const nx of byOrigin.get(last.destination) ?? []) {
      if (visited.has(nx.destination)) continue;
      const layover = absoluteMinute(nx.date, nx.departMin) - lastArr;
      if (layover < minC || layover > maxC) continue;
      path.push(nx);
      dfs();
      path.pop();
    }
  };

  for (const l1 of firstPool) {
    if (l1.origin !== origin) continue;
    path.push(l1);
    dfs();
    path.pop();
  }

  let out = dedupe(results);
  if (opts.maxDurationMin != null) {
    out = out.filter((j) => j.totalDurationMin <= opts.maxDurationMin!);
  }
  out.sort(
    (a, b) =>
      a.departMin - b.departMin ||
      a.totalDurationMin - b.totalDurationMin ||
      a.legs.length - b.legs.length,
  );
  memo.set(key, out);
  return out;
}

/** The single best (shortest total) journey for a route, or null. */
export function bestJourney(
  trains: MaxTrain[],
  origin: string,
  destination: string,
  date: string,
  opts: ConnectionOptions = {},
): Journey | null {
  let best: Journey | null = null;
  for (const j of findJourneys(trains, origin, destination, date, opts)) {
    if (!best || j.totalDurationMin < best.totalDurationMin) best = j;
  }
  return best;
}

/**
 * How many calendar days a journey straddles: 1 = same-day, 2 = arrives the next
 * day, etc. Computed from the LAST leg's own date plus its past-midnight rollover
 * (overnight stopovers can put later legs days after the first), relative to the
 * journey's start date.
 */
export function journeySpanDays(j: Journey): number {
  const last = j.legs[j.legs.length - 1];
  if (!last) return 1;
  const endDay = dayIndex(last.date) + Math.floor(last.arriveMin / 1440);
  return endDay - dayIndex(j.date) + 1;
}
