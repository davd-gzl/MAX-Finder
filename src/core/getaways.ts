import type { MaxTrain, Journey } from "../types";
import { findJourneys, type ConnectionOptions } from "./connections";
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

  const out: Getaway[] = [];
  for (const dest of stationsOnDate(trains, date)) {
    if (dest === origin) continue;
    // Earliest-arriving outbound on the start day (more time at the destination).
    let outbound: Journey | null = null;
    for (const j of findJourneys(trains, origin, dest, date, opts)) {
      if (!outbound || j.arriveMin < outbound.arriveMin) outbound = j;
    }
    if (!outbound) continue;
    // The best return: latest feasible departure on the return day, home in time.
    // A flexible search prefers the longest stay, so the first match (largest N) wins.
    let chosen: { back: Journey; nights: number } | null = null;
    for (const nights of nightChoices) {
      const returnDate = addDays(date, nights);
      let back: Journey | null = null;
      for (const j of findJourneys(trains, dest, origin, returnDate, opts)) {
        if (j.arriveMin > arriveCeil) continue; // gets home too late
        // Same-day: leave enough time in the city; a multi-night stay needs no such gap.
        if (nights === 0 && j.departMin < outbound.arriveMin + minOnSite) continue;
        if (!back || j.departMin > back.departMin) back = j; // keep the latest return
      }
      if (back) {
        chosen = { back, nights };
        break;
      }
    }
    if (!chosen) continue;
    out.push({
      destination: dest,
      outbound,
      back: chosen.back,
      nights: chosen.nights,
      onSiteMin: chosen.nights === 0 ? chosen.back.departMin - outbound.arriveMin : undefined,
      travelMin: outbound.totalDurationMin + chosen.back.totalDurationMin,
    });
  }
  // Most nights first; then most time on site (same-day) or least travel (multi-night).
  return out.sort(
    (a, b) =>
      b.nights - a.nights ||
      (a.nights === 0 ? (b.onSiteMin ?? 0) - (a.onSiteMin ?? 0) : a.travelMin - b.travelMin),
  );
}
