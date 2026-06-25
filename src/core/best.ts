import type { MaxTrain, Journey } from "../types";
import { bestJourney, type ConnectionOptions } from "./connections";

export interface BestTrip {
  destination: string;
  journey: Journey;
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
