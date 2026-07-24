import type { MaxTrain, CalendarDay, Journey } from "../types";
import { findJourneys, reachableJourneys, reachableInto, type ConnectionOptions } from "./connections";

/** Build a per-day calendar from a count function: a day is available when its count > 0. */
export function perDayCount(dates: string[], count: (date: string) => number): CalendarDay[] {
  return dates.map((date) => {
    const c = count(date);
    return { date, available: c > 0, count: c };
  });
}

/**
 * Availability over a set of dates for one O-D route. A day is "available" if at
 * least one free-MAX journey exists that day (direct or via connections, per
 * `opts`), so the calendar matches the journeys shown for the route.
 *
 * `accept` is an optional post-filter (e.g. a "via" constraint) applied to each
 * day's journeys so the calendar counts match exactly what the results list
 * shows for the selected date.
 */
export function availabilityCalendar(
  trains: MaxTrain[],
  origin: string,
  destination: string,
  dates: string[],
  opts: ConnectionOptions = {},
  accept: (j: Journey) => boolean = () => true,
): CalendarDay[] {
  return perDayCount(dates, (date) => findJourneys(trains, origin, destination, date, opts).filter(accept).length);
}

/**
 * Per-day count of distinct destinations reachable over `dates`, INCLUDING
 * connections (so a place reached only via a stopover still counts) — one
 * multi-target graph search per day, matching what the connection-aware lists
 * actually show. With `dir: "from"` counts destinations reachable FROM `anchor`
 * (origin-only browse); with `dir: "to"` counts ORIGINS from which `anchor` is
 * reachable (destination-only browse-by-arrival). `accept` optionally filters.
 */
export function reachableCountCalendar(
  trains: MaxTrain[],
  anchor: string,
  dates: string[],
  opts: ConnectionOptions = {},
  dir: "from" | "to" = "from",
  accept: (other: string) => boolean = () => true,
): CalendarDay[] {
  const reach = dir === "from" ? reachableJourneys : reachableInto;
  return perDayCount(dates, (date) => {
    let count = 0;
    for (const other of reach(trains, anchor, date, opts).keys()) {
      if (accept(other)) count++;
    }
    return count;
  });
}

/** The next `n` ISO dates starting at `start` (inclusive). */
export function dateRange(start: string, n: number): string[] {
  const base = Date.parse(`${start}T00:00:00Z`);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(new Date(base + i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}
