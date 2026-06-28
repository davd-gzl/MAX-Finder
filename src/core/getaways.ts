import type { MaxTrain, Journey, CalendarDay } from "../types";
import { findJourneys, reachableJourneys, latestReturns, type ConnectionOptions } from "./connections";
import { stationsOnDate } from "./best";
import { addDays } from "../util/time";

export interface Getaway {
  destination: string;
  /** Earliest-arriving free-MAX journey out on the start day (maximises time there). */
  outbound: Journey;
  /** Latest free-MAX journey back on the return day that still gets you home in time. */
  back: Journey;
  /** Nights spent at the destination: 0 = same-day round trip. */
  nights: number;
  /** Minutes available in the city (same-day only; multi-night stays count days, not minutes). */
  onSiteMin?: number;
  /** Total round-trip travel time (out + back). */
  travelMin: number;
}

export interface GetawayOptions extends ConnectionOptions {
  /** Nights at the destination: 0 (default) = same day; N = an N-night stay. */
  nights?: number;
  /** Treat `nights` as a maximum and keep the longest feasible stay (1..nights) per city. */
  flexibleNights?: boolean;
  /** Same-day only: minimum time on site to count as a worthwhile trip (default 4 h). */
  minOnSiteMin?: number;
  /** Allow a return arriving up to ~02:00 the morning after the return day (else by midnight). */
  lateReturn?: boolean;
}

const MIDNIGHT = 24 * 60;
const LATE_RETURN_CEIL = 26 * 60; // ~02:00 next day

/**
 * Round trips from `origin` starting on `date`: for every destination reachable by
 * free MAX, the best there-and-back you can do — leave in the morning, come home
 * the same evening (0 nights) or after an N-night stay, both legs free. Each keeps
 * the EARLIEST arrival out and the LATEST feasible return, so time at the
 * destination is maximised. Returns must get you home by midnight, or ~02:00 with
 * `lateReturn`. With `flexibleNights`, the longest feasible stay (1..nights) wins
 * per city. Sorted by most nights, then most time on site (same-day) / least travel.
 */
export function getaways(
  trains: MaxTrain[],
  origin: string,
  date: string,
  opts: GetawayOptions = {},
): Getaway[] {
  const out: Getaway[] = [];
  for (const dest of stationsOnDate(trains, date)) {
    if (dest === origin) continue;
    const g = bestGetawayTo(trains, origin, dest, date, opts);
    if (g) out.push(g);
  }
  // Most nights first; then most time on site (same-day) or least travel (multi-night).
  return out.sort(sortGetaways);
}

/**
 * The best round trip (out + back, both free MAX) from `origin` to one `dest`
 * starting on `date`: the earliest-arriving outbound (maximises time there) and
 * the latest feasible return that still gets home by the ceiling. Returns null if
 * no there-and-back works. Pass `outbound` to reuse a journey already found (e.g.
 * from a multi-target sweep) and skip re-searching the outbound leg.
 */
export function bestGetawayTo(
  trains: MaxTrain[],
  origin: string,
  dest: string,
  date: string,
  opts: GetawayOptions = {},
  outbound?: Journey,
): Getaway | null {
  const maxNights = Math.max(0, Math.floor(opts.nights ?? 0));
  const minOnSite = opts.minOnSiteMin ?? 240;
  const arriveCeil = opts.lateReturn ? LATE_RETURN_CEIL : MIDNIGHT;
  // Stay lengths to try, longest first. Same-day is always just [0]; a flexible
  // search walks down from the max so the longest feasible getaway wins.
  const nightChoices =
    maxNights === 0
      ? [0]
      : opts.flexibleNights
        ? Array.from({ length: maxNights }, (_, i) => maxNights - i)
        : [maxNights];

  // Earliest-arriving outbound on the start day (more time at the destination),
  // unless one was supplied by the caller.
  let out = outbound ?? null;
  if (!out) {
    for (const j of findJourneys(trains, origin, dest, date, opts)) {
      if (!out || j.arriveMin < out.arriveMin) out = j;
    }
  }
  if (!out) return null;
  // The best return: latest feasible departure on the return day, home in time.
  // A flexible search prefers the longest stay, so the first match (largest N) wins.
  for (const nights of nightChoices) {
    const returnDate = addDays(date, nights);
    let back: Journey | null = null;
    for (const j of findJourneys(trains, dest, origin, returnDate, opts)) {
      if (j.arriveMin > arriveCeil) continue; // gets home too late
      // Same-day: leave enough time in the city; a multi-night stay needs no such gap.
      if (nights === 0 && j.departMin < out.arriveMin + minOnSite) continue;
      if (!back || j.departMin > back.departMin) back = j; // keep the latest return
    }
    if (back) {
      return {
        destination: dest,
        outbound: out,
        back,
        nights,
        onSiteMin: nights === 0 ? back.departMin - out.arriveMin : undefined,
        travelMin: out.totalDurationMin + back.totalDurationMin,
      };
    }
  }
  return null;
}

/** Rank: most nights, then most time on site (same-day) / least travel (stays). */
function sortGetaways(a: Getaway, b: Getaway): number {
  return (
    b.nights - a.nights ||
    (a.nights === 0 ? (b.onSiteMin ?? 0) - (a.onSiteMin ?? 0) : a.travelMin - b.travelMin)
  );
}

/** Is `a` a better round trip to the same place than `b` (more nights, etc.)? */
function betterGetaway(a: Getaway, b: Getaway): boolean {
  return (
    a.nights > b.nights ||
    (a.nights === b.nights &&
      (a.nights === 0 ? (a.onSiteMin ?? 0) > (b.onSiteMin ?? 0) : a.travelMin < b.travelMin))
  );
}

/**
 * Round-trip "ideas" across a whole set of `dates`: run {@link getaways} for each
 * day and keep the single best escape per destination (whichever day offers more
 * nights / time on site / less travel). `accept` optionally filters destinations
 * (e.g. by region). Also returns a per-day count of distinct round-trip
 * destinations startable that day, for the ideas calendar. Sorted best-first.
 */
export function getawaysAcrossWindow(
  trains: MaxTrain[],
  origin: string,
  dates: string[],
  opts: GetawayOptions = {},
  accept: (destination: string) => boolean = () => true,
): { trips: Getaway[]; perDay: CalendarDay[] } {
  const byDest = new Map<string, Getaway>();
  const perDay: CalendarDay[] = [];
  for (const date of dates) {
    let count = 0;
    for (const g of getaways(trains, origin, date, opts)) {
      if (!accept(g.destination)) continue;
      count++;
      const cur = byDest.get(g.destination);
      if (!cur || betterGetaway(g, cur)) byDest.set(g.destination, g);
    }
    perDay.push({ date, available: count > 0, count });
  }
  return { trips: [...byDest.values()].sort(sortGetaways), perDay };
}

/**
 * Round-trip "ideas" for a whole month: the best there-and-back to every
 * destination reachable across `dates`. Built for scale — a per-station search on
 * every day is far too slow, so this pairs TWO multi-target sweeps per day: one
 * forward ({@link reachableJourneys}) for the outbound to each destination, one
 * backward ({@link latestReturns}) for the latest feasible return from each — a
 * pass per day, not a search per destination. `accept` optionally filters
 * destinations. Returns the best escape per destination (sorted best-first) plus,
 * for the calendar, a per-day count of distinct round trips you can START each day.
 */
export function getawayIdeas(
  trains: MaxTrain[],
  origin: string,
  dates: string[],
  opts: GetawayOptions = {},
  accept: (destination: string) => boolean = () => true,
): { trips: Getaway[]; perDay: CalendarDay[] } {
  const maxNights = Math.max(0, Math.floor(opts.nights ?? 0));
  const minOnSite = opts.minOnSiteMin ?? 240;
  const arriveCeil = opts.lateReturn ? LATE_RETURN_CEIL : MIDNIGHT;
  const nightChoices =
    maxNights === 0
      ? [0]
      : opts.flexibleNights
        ? Array.from({ length: maxNights }, (_, i) => maxNights - i)
        : [maxNights];

  const byDest = new Map<string, Getaway>();
  const perDay: CalendarDay[] = [];
  for (const date of dates) {
    const outboundMap = reachableJourneys(trains, origin, date, opts);
    const startable = new Set<string>(); // round-trippable destinations starting today
    for (const nights of nightChoices) {
      const returns = latestReturns(trains, origin, addDays(date, nights), arriveCeil, opts);
      if (returns.size === 0) continue;
      for (const [dest, outbound] of outboundMap) {
        if (dest === origin || !accept(dest)) continue;
        const back = returns.get(dest);
        if (!back) continue;
        // Same-day: the return must leave after you've had your time in the city.
        if (nights === 0 && back.departMin < outbound.arriveMin + minOnSite) continue;
        startable.add(dest);
        const g: Getaway = {
          destination: dest,
          outbound,
          back,
          nights,
          onSiteMin: nights === 0 ? back.departMin - outbound.arriveMin : undefined,
          travelMin: outbound.totalDurationMin + back.totalDurationMin,
        };
        const cur = byDest.get(dest);
        if (!cur || betterGetaway(g, cur)) byDest.set(dest, g);
      }
    }
    perDay.push({ date, available: startable.size > 0, count: startable.size });
  }
  return { trips: [...byDest.values()].sort(sortGetaways), perDay };
}
