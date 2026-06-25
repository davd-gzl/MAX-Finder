import type { MaxTrain, CalendarDay, Journey } from "../types";
import { findJourneys, type ConnectionOptions } from "./connections";

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

/** The next `n` ISO dates starting at `start` (inclusive). */
export function dateRange(start: string, n: number): string[] {
  const base = Date.parse(`${start}T00:00:00Z`);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(new Date(base + i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}
