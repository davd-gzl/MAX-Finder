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

/**
 * Every station reachable from `anchor` over the WHOLE loaded window (any date),
 * grouped with its total count and fastest direct time. `dir` "from" groups by
 * destination (places you can go), "to" groups by origin (places you can come
 * from). This is the browse list so an idea appears whenever a MAX train runs to
 * it on *any* bookable day, not only the one currently selected.
 */
export function reachableGroups(
  trains: MaxTrain[],
  anchor: string,
  dir: "from" | "to",
  opts: FilterOptions = {},
): StationGroup[] {
  const matches =
    dir === "from"
      ? filterTrains(trains, { ...opts, origin: anchor })
      : filterTrains(trains, { ...opts, destination: anchor });
  return group(matches, (t) => (dir === "from" ? t.destination : t.origin));
}

/** Total direct free-MAX trains and the distinct days they run on, per station. */
export interface WindowStat {
  trains: number;
  days: number;
}

/**
 * For an `anchor` station, total direct free-MAX availability over the whole
 * loaded window (all dates), keyed by the other station — destinations when
 * `dir` is "from", origins when "to". Lets the browse list show how many MAX
 * trains run to each place over the bookable horizon, not just on one date.
 */
export function windowStats(
  trains: MaxTrain[],
  anchor: string,
  dir: "from" | "to",
  opts: FilterOptions = {},
): Map<string, WindowStat> {
  const matches =
    dir === "from"
      ? filterTrains(trains, { ...opts, origin: anchor })
      : filterTrains(trains, { ...opts, destination: anchor });
  const acc = new Map<string, { trains: number; days: Set<string> }>();
  for (const t of matches) {
    const key = dir === "from" ? t.destination : t.origin;
    let e = acc.get(key);
    if (!e) {
      e = { trains: 0, days: new Set() };
      acc.set(key, e);
    }
    e.trains++;
    e.days.add(t.date);
  }
  const out = new Map<string, WindowStat>();
  for (const [k, v] of acc) out.set(k, { trains: v.trains, days: v.days.size });
  return out;
}
