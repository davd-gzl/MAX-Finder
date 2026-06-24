import type { MaxTrain, CalendarDay } from "../types";

/**
 * Availability over a set of dates for one O-D route. If `dates` is omitted,
 * only dates that actually have free-MAX trains are returned (sorted).
 */
export function availabilityCalendar(
  trains: MaxTrain[],
  origin: string,
  destination: string,
  dates?: string[],
): CalendarDay[] {
  const byDate = new Map<string, number>();
  for (const t of trains) {
    if (t.available && t.origin === origin && t.destination === destination) {
      byDate.set(t.date, (byDate.get(t.date) ?? 0) + 1);
    }
  }
  const keys = dates ?? [...byDate.keys()].sort();
  return keys.map((date) => {
    const count = byDate.get(date) ?? 0;
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
