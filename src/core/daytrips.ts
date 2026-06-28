import type { MaxTrain, Journey } from "../types";
import { findJourneys, type ConnectionOptions } from "./connections";
import { stationsOnDate } from "./best";

export interface DayTrip {
  destination: string;
  /** Earliest-arriving free-MAX journey out (maximises time in the city). */
  outbound: Journey;
  /** Latest free-MAX journey back that still gets you home in time. */
  back: Journey;
  /** Minutes available in the city (arrival → return departure). */
  onSiteMin: number;
  /** Total round-trip travel time (out + back). */
  travelMin: number;
}

export interface DayTripOptions extends ConnectionOptions {
  /** Minimum time on site to count as a worthwhile day trip (default 4 h). */
  minOnSiteMin?: number;
  /** Allow a return arriving up to ~02:00 the next morning (else home by midnight). */
  lateReturn?: boolean;
}

const MIDNIGHT = 24 * 60;
const LATE_RETURN_CEIL = 26 * 60; // ~02:00 next day

/**
 * Same-day round trips from `origin` on `date`: for every destination reachable by
 * free MAX, the best there-and-back you can do in the day — leave in the morning,
 * come home the same evening, both free. Each keeps the EARLIEST arrival out and the
 * LATEST feasible return, so "time on site" is maximised. Returns must get you home
 * by midnight, or ~02:00 if `lateReturn`. Sorted by most time in the city.
 */
export function dayTrips(
  trains: MaxTrain[],
  origin: string,
  date: string,
  opts: DayTripOptions = {},
): DayTrip[] {
  const minOnSite = opts.minOnSiteMin ?? 240;
  const arriveCeil = opts.lateReturn ? LATE_RETURN_CEIL : MIDNIGHT;
  const out: DayTrip[] = [];
  // Every journey here departs on `date`, so all leg times share that day's midnight
  // as their origin — depart/arrive minutes are directly comparable (a value ≥ 1440
  // simply means it spilled past midnight).
  for (const dest of stationsOnDate(trains, date)) {
    if (dest === origin) continue;
    let outbound: Journey | null = null;
    for (const j of findJourneys(trains, origin, dest, date, opts)) {
      if (!outbound || j.arriveMin < outbound.arriveMin) outbound = j;
    }
    if (!outbound) continue;
    const arriveMin = outbound.arriveMin;
    let back: Journey | null = null;
    for (const j of findJourneys(trains, dest, origin, date, opts)) {
      if (j.departMin < arriveMin + minOnSite) continue; // not enough time in the city
      if (j.arriveMin > arriveCeil) continue; // gets home too late
      if (!back || j.departMin > back.departMin) back = j; // keep the latest return
    }
    if (!back) continue;
    out.push({
      destination: dest,
      outbound,
      back,
      onSiteMin: back.departMin - arriveMin,
      travelMin: outbound.totalDurationMin + back.totalDurationMin,
    });
  }
  return out.sort((a, b) => b.onSiteMin - a.onSiteMin);
}
