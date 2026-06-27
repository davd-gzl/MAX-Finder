import type { MaxTrain, Journey } from "../types";
import { bestJourney, reachableJourneys, type ConnectionOptions } from "./connections";

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
 * The best (shortest total) free-MAX trip from `origin` to each candidate
 * destination on `date`, ranked by total travel time ascending. Destinations
 * with no reachable journey are dropped.
 */
export function bestTrips(
  trains: MaxTrain[],
  origin: string,
  date: string,
  destinations: string[],
  opts: ConnectionOptions = {},
): BestTrip[] {
  const out: BestTrip[] = [];
  for (const destination of destinations) {
    if (destination === origin) continue;
    const journey = bestJourney(trains, origin, destination, date, opts);
    if (journey) out.push({ destination, journey });
  }
  return out.sort((a, b) => a.journey.totalDurationMin - b.journey.totalDurationMin);
}

/**
 * The best free-MAX trip to every destination reachable from `origin` on ANY day
 * across `dates` — the "ideas, all days" view. Each destination is kept once, on
 * the EARLIEST day it's reachable (so the result is the soonest way to reach each
 * place), and ranked by total travel time, fastest first.
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
      if (!found.has(destination)) found.set(destination, { destination, journey }); // earliest day
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
  const out: ReachTrip[] = [];
  for (const station of candidates) {
    if (station === anchor) continue;
    const origin = dir === "from" ? anchor : station;
    const destination = dir === "from" ? station : anchor;
    const journey = bestJourney(trains, origin, destination, date, opts);
    if (journey) out.push({ station, journey });
  }
  return out.sort((a, b) => a.journey.totalDurationMin - b.journey.totalDurationMin);
}
