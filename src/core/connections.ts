import type { MaxTrain, Journey } from "../types";
import { HUB_STATIONS, MIN_CONNECTION_MIN, MAX_CONNECTION_MIN } from "../config";
import { filterTrains } from "./search";

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
}

/** Build a Journey from an ordered list of legs (1..n). */
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
    layovers.push(cur.departMin - prev.arriveMin);
    hubs.push(prev.destination);
  }
  return {
    date: first.date,
    origin: first.origin,
    destination: last.destination,
    legs,
    departMin: first.departMin,
    arriveMin: last.arriveMin,
    totalDurationMin: last.arriveMin - first.departMin,
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
    const key = `${j.date}|${j.legs.map((l) => `${l.trainNo}@${l.origin}`).join(">")}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(j);
    }
  }
  return out;
}

/**
 * Find journeys from `origin` to `destination` on `date` with up to
 * `maxConnections` changes. Direct trains and every valid shorter journey are
 * included. Intermediate stops must be hubs; each layover must fall within the
 * allowed window; no station is visited twice. Sorted by departure, then total
 * duration, then fewest legs.
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
  const maxC = opts.maxConnectionMin ?? MAX_CONNECTION_MIN;

  const dayPool = filterTrains(trains, { date, trainType: opts.trainType });
  const firstPool = filterTrains(trains, {
    date,
    departAfter: opts.departAfter,
    departBefore: opts.departBefore,
    trainType: opts.trainType,
  });

  const byOrigin = new Map<string, MaxTrain[]>();
  for (const t of dayPool) {
    const arr = byOrigin.get(t.origin);
    if (arr) arr.push(t);
    else byOrigin.set(t.origin, [t]);
  }

  const results: Journey[] = [];
  const path: MaxTrain[] = [];

  const dfs = (): void => {
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
    for (const nx of byOrigin.get(last.destination) ?? []) {
      if (visited.has(nx.destination)) continue;
      const layover = nx.departMin - last.arriveMin;
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
  return out.sort(
    (a, b) =>
      a.departMin - b.departMin ||
      a.totalDurationMin - b.totalDurationMin ||
      a.legs.length - b.legs.length,
  );
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
