import type { MaxTrain } from "../types";

export interface StationCount {
  station: string;
  count: number;
}

export interface RouteCount {
  origin: string;
  destination: string;
  count: number;
}

const SEP = "\t"; // station ids contain spaces/parens but never tabs

function tally(
  trains: MaxTrain[],
  date: string,
  key: (t: MaxTrain) => string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of trains) {
    if (!t.available || t.date !== date) continue;
    const k = key(t);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

/** Destinations with the most reservable MAX seats on `date`. */
export function topDestinations(trains: MaxTrain[], date: string, limit = 12): StationCount[] {
  return [...tally(trains, date, (t) => t.destination)]
    .map(([station, count]) => ({ station, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/** Departure stations with the most reservable MAX seats on `date`. */
export function topOrigins(trains: MaxTrain[], date: string, limit = 12): StationCount[] {
  return [...tally(trains, date, (t) => t.origin)]
    .map(([station, count]) => ({ station, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/** Routes (origin -> destination) with the most reservable MAX seats on `date`. */
export function topRoutes(trains: MaxTrain[], date: string, limit = 12): RouteCount[] {
  return [...tally(trains, date, (t) => t.origin + SEP + t.destination)]
    .map(([key, count]) => {
      const [origin = "", destination = ""] = key.split(SEP);
      return { origin, destination, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
