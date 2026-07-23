import type { MaxTrain, CalendarDay, Journey } from "../types";
import { findJourneys, reachableJourneys, reachableInto, type ConnectionOptions } from "./connections";
import { filterTrains, type FilterOptions } from "./search";

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
  return dates.map((date) => {
    const count = findJourneys(trains, origin, destination, date, opts).filter(accept).length;
    return { date, available: count > 0, count };
  });
}

/**
 * Per-day count of distinct direct free-MAX destinations reachable from `origin`
 * over `dates`. Powers the "ideas by day" strip in best mode — a day is available
 * when at least one destination runs. `accept` optionally filters destinations
 * (e.g. by region). Counts direct trains only (cheap, a navigation hint); the
 * full list on click still includes connections.
 */
export function destinationCalendar(
  trains: MaxTrain[],
  origin: string,
  dates: string[],
  opts: FilterOptions = {},
  accept: (destination: string) => boolean = () => true,
): CalendarDay[] {
  const byDate = new Map<string, Set<string>>();
  for (const t of filterTrains(trains, { ...opts, origin })) {
    if (!accept(t.destination)) continue;
    let set = byDate.get(t.date);
    if (!set) {
      set = new Set();
      byDate.set(t.date, set);
    }
    set.add(t.destination);
  }
  return dates.map((date) => {
    const count = byDate.get(date)?.size ?? 0;
    return { date, available: count > 0, count };
  });
}

/**
 * Per-day count of distinct destinations reachable from `origin` over `dates`,
 * INCLUDING connections (so a place reached only via a stopover still counts) —
 * one multi-target graph search per day. Matches what the connection-aware lists
 * actually show, unlike `destinationCalendar` (direct only). `accept` optionally
 * filters destinations (e.g. by region).
 */
export function reachableCountCalendar(
  trains: MaxTrain[],
  origin: string,
  dates: string[],
  opts: ConnectionOptions = {},
  accept: (destination: string) => boolean = () => true,
): CalendarDay[] {
  return dates.map((date) => {
    let count = 0;
    for (const dest of reachableJourneys(trains, origin, date, opts).keys()) {
      if (accept(dest)) count++;
    }
    return { date, available: count > 0, count };
  });
}

/**
 * Per-day count of distinct ORIGINS from which `destination` is reachable over
 * `dates`, INCLUDING connections — the mirror of {@link reachableCountCalendar}
 * for a browse-by-arrival (destination-only) search. A day is available when at
 * least one origin can reach `destination`. `accept` optionally filters origins.
 */
export function reachableIntoCountCalendar(
  trains: MaxTrain[],
  destination: string,
  dates: string[],
  opts: ConnectionOptions = {},
  accept: (origin: string) => boolean = () => true,
): CalendarDay[] {
  return dates.map((date) => {
    let count = 0;
    for (const origin of reachableInto(trains, destination, date, opts).keys()) {
      if (accept(origin)) count++;
    }
    return { date, available: count > 0, count };
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
