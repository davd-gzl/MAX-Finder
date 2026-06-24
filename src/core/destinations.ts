import type { MaxTrain } from "../types";
import { filterTrains, type FilterOptions } from "./search";

export interface StationGroup {
  /** The "other" station (destination for `reachableDestinations`, origin for the reverse). */
  station: string;
  trains: MaxTrain[];
  count: number;
  earliestDepartMin: number;
  minDurationMin: number;
}

function group(trains: MaxTrain[], keyOf: (t: MaxTrain) => string): StationGroup[] {
  const map = new Map<string, MaxTrain[]>();
  for (const t of trains) {
    const k = keyOf(t);
    const arr = map.get(k);
    if (arr) arr.push(t);
    else map.set(k, [t]);
  }
  return [...map.entries()]
    .map(([station, ts]) => ({
      station,
      trains: ts,
      count: ts.length,
      earliestDepartMin: Math.min(...ts.map((t) => t.departMin)),
      minDurationMin: Math.min(...ts.map((t) => t.durationMin)),
    }))
    .sort((a, b) => a.station.localeCompare(b.station));
}

/** Every destination reachable for free from `origin` on `date`. */
export function reachableDestinations(
  trains: MaxTrain[],
  origin: string,
  date: string,
  opts: FilterOptions = {},
): StationGroup[] {
  const matches = filterTrains(trains, { ...opts, origin, date });
  return group(matches, (t) => t.destination);
}

/** Every origin that can reach `destination` for free on `date`. */
export function reachableOrigins(
  trains: MaxTrain[],
  destination: string,
  date: string,
  opts: FilterOptions = {},
): StationGroup[] {
  const matches = filterTrains(trains, { ...opts, destination, date });
  return group(matches, (t) => t.origin);
}
