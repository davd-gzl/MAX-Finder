import type { MaxTrain, Journey } from "../types";
import { reachableJourneys, reachableInto, type ConnectionOptions } from "./connections";

export interface BestTrip {
  destination: string;
  journey: Journey;
  /** Days in the window this destination is reachable (set by the all-days view). */
  days?: number;
}

/** Distinct stations that appear (as origin or destination) on a given date. */
export function stationsOnDate(trains: MaxTrain[], date: string): string[] {
  const set = new Set<string>();
  for (const t of trains) {
    if (t.date !== date) continue;
    set.add(t.origin);
    set.add(t.destination);
  }
  return [...set];
}

/**
 * The best free-MAX trip to every destination reachable from `origin` on ANY day
 * across `dates` — the "ideas, all days" view. Each destination is kept once, with
 * the SHORTEST journey found on any day (so the headline duration matches the best
 * real trip — the same one opening the route shows — not whatever the earliest day
 * happened to offer, which can be a far slower overnight detour). Ranked by total
 * travel time, fastest first.
 *
 * Connection-aware: one multi-target graph search per day finds the same connecting
 * destinations the single-day list does (not just direct ones), at roughly the cost
 * of one journey lookup per day rather than per destination.
 */
export function bestTripsAcrossWindow(
  trains: MaxTrain[],
  origin: string,
  dates: string[],
  opts: ConnectionOptions = {},
): BestTrip[] {
  const found = new Map<string, BestTrip>();
  const dayCount = new Map<string, number>();
  for (const date of dates) {
    for (const [destination, journey] of reachableJourneys(trains, origin, date, opts)) {
      if (destination === origin) continue;
      dayCount.set(destination, (dayCount.get(destination) ?? 0) + 1); // reachable that day
      const cur = found.get(destination);
      // Keep the fastest journey across the whole window, not the earliest day's.
      if (!cur || journey.totalDurationMin < cur.journey.totalDurationMin) {
        found.set(destination, { destination, journey });
      }
    }
  }
  for (const trip of found.values()) trip.days = dayCount.get(trip.destination);
  return [...found.values()].sort((a, b) => a.journey.totalDurationMin - b.journey.totalDurationMin);
}

export interface ReachTrip {
  station: string;
  journey: Journey;
}

/**
 * Connection-aware reachability for the browse modes. For `dir === "from"` it
 * finds the best journey from `anchor` to each candidate; for `"to"` it finds
 * the best journey from each candidate into `anchor`. Unreachable candidates are
 * dropped; results are ranked by total travel time.
 */
export function reachableBest(
  trains: MaxTrain[],
  anchor: string,
  date: string,
  candidates: string[],
  opts: ConnectionOptions,
  dir: "from" | "to",
): ReachTrip[] {
  // ONE multi-target sweep from (or into) the anchor — the fastest journey to every
  // reachable station in a single pass — instead of a per-candidate graph search. On a
  // busy hub that is the difference between tens of milliseconds and tens of seconds.
  const reached =
    dir === "from" ? reachableJourneys(trains, anchor, date, opts) : reachableInto(trains, anchor, date, opts);
  const allow = new Set(candidates);
  const out: ReachTrip[] = [];
  for (const [station, journey] of reached) {
    if (station === anchor || !allow.has(station)) continue;
    out.push({ station, journey });
  }
  return out.sort((a, b) => a.journey.totalDurationMin - b.journey.totalDurationMin);
}
