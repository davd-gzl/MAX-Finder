// Run the same heavy search compute the render will, purely to populate the shared
// connection caches. This is what the background worker executes off the main thread;
// its resulting cache dump is shipped back and merged so the (synchronous) render runs
// as cache hits. Only performance depends on this matching the render — a miss just
// means the main thread recomputes, exactly as it did before the worker existed.

import type { SearchQuery, MaxTrain } from "../types";
import { dateRange, availabilityCalendar } from "../core/calendar";
import { bestTripsAcrossWindow, reachableBest, stationsOnDate } from "../core/best";
import { reachableDestinations, reachableOrigins } from "../core/destinations";
import { getawayIdeas, stayCalendar } from "../core/getaways";
import { filterOptsFor, odConnOptsFor, getawayOptsFor } from "../core/queryOpts";
import { addDays } from "../util/time";

const BOOKING_WINDOW_DAYS = 30;

/** The ±flex window around the chosen date the browse lists sweep (see runBrowse). */
function browseWindow(query: SearchQuery, today: string): string[] {
  const flex = query.flexDays ?? 0;
  const last = addDays(today, BOOKING_WINDOW_DAYS - 1);
  const out: string[] = [];
  for (let i = -flex; i <= flex; i++) {
    const d = addDays(query.date, i);
    if (i === 0 || (d >= today && d <= last)) out.push(d);
  }
  return out;
}

export function warmForQuery(trains: MaxTrain[], query: SearchQuery, today: string): void {
  const window = dateRange(today, BOOKING_WINDOW_DAYS);
  const fopts = filterOptsFor(query);
  try {
    if (query.mode === "od" && query.origin && query.destination) {
      const { connOpts } = odConnOptsFor(query, query.origin, query.destination);
      if (query.stay) {
        // Leg 1 (outbound possible-days) + the return-direction availability, and the
        // same-day (0-night) feasibility the return calendar's first cell needs.
        stayCalendar(trains, query.origin, query.destination, window, connOpts, "nights");
        availabilityCalendar(trains, query.destination, query.origin, window, connOpts);
        stayCalendar(trains, query.origin, query.destination, [query.date], connOpts, "hours");
      } else {
        availabilityCalendar(trains, query.origin, query.destination, window, connOpts);
      }
    } else if (query.mode === "from" && query.origin) {
      if (query.stay) {
        getawayIdeas(trains, query.origin, window, getawayOptsFor(query));
      } else {
        const dates = browseWindow(query, today);
        const viaOpts = { ...fopts, maxConnections: query.maxConnections };
        for (const d of dates) {
          reachableDestinations(trains, query.origin, d, fopts);
          if (query.maxConnections > 0) reachableBest(trains, query.origin, d, stationsOnDate(trains, d), viaOpts, "from");
        }
      }
    } else if (query.mode === "to" && query.destination) {
      const dates = browseWindow(query, today);
      const viaOpts = { ...fopts, maxConnections: query.maxConnections };
      for (const d of dates) {
        reachableOrigins(trains, query.destination, d, fopts);
        if (query.maxConnections > 0) reachableBest(trains, query.destination, d, stationsOnDate(trains, d), viaOpts, "to");
      }
    } else if (query.mode === "best" && query.origin) {
      bestTripsAcrossWindow(trains, query.origin, window, { ...fopts, maxConnections: query.maxConnections });
    }
    // "tour" (planTours) is left to the main thread: it is less common and its plan
    // search is not one of the shared connection primitives these caches cover.
  } catch {
    /* warming is best-effort — any failure just means the render computes on-thread */
  }
}
