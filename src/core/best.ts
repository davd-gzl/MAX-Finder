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
