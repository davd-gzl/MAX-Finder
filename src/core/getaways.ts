import type { MaxTrain, Journey, CalendarDay } from "../types";
import { findJourneys, reachableJourneys, latestReturns, journeyArriveAbs, type ConnectionOptions } from "./connections";
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

/** What a whole-window getaway sweep reports. */
export interface GetawaySweep {
  /** The single best escape per destination, best first. */
  trips: Getaway[];
  /** Per date, how many distinct destinations you can START a round trip to. */
  perDay: CalendarDay[];
  /**
   * Per destination, every start date that works. Lets a caller rank places by how
   * often they're reachable and build a per-city calendar without sweeping twice.
   */
  datesByDest: Map<string, string[]>;
}

function pushDate(map: Map<string, string[]>, key: string, date: string): void {
  const cur = map.get(key);
  if (cur) cur.push(date);
  else map.set(key, [date]);
}

const MIDNIGHT = 24 * 60;
const LATE_RETURN_CEIL = 26 * 60; // ~02:00 next day
// Sleeper round trips ("only night trains"): you ride overnight there AND back, so
// the return arrives the MORNING after it departs — allow arrivals well into the
// next day, and leave a day later than a day trip would.
const NIGHT_RETURN_CEIL = 24 * 60 + 14 * 60; // ~14:00 the day after the return date

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
  // Sleeper round trip: you sleep on the train there AND back, arriving each
  // morning — so returns arrive the day after they leave, and there's no same-day
  // option (nights ≥ 1). A day trip keeps its morning-out / evening-back model.
  const sleeper = Boolean(opts.onlyNight);
  const arriveCeil = sleeper ? NIGHT_RETURN_CEIL : opts.lateReturn ? LATE_RETURN_CEIL : MIDNIGHT;
  // Stay lengths to try, longest first. A sleeper trip always has ≥ 1 night; a day
  // trip can be same-day [0]; a flexible search walks down to the shortest stay.
  const nightChoices = stayChoices(maxNights, Boolean(opts.flexibleNights), sleeper);

  // Earliest-arriving outbound on the start day (more time at the destination),
  // unless one was supplied by the caller.
  let out = outbound ?? null;
  if (!out) {
    for (const j of findJourneys(trains, origin, dest, date, opts)) {
      if (!out || journeyArriveAbs(j) < journeyArriveAbs(out)) out = j;
    }
  }
  if (!out) return null;
  // The best return: latest feasible departure on the return day, home in time.
  // A flexible search prefers the longest stay, so the first match (largest N) wins.
  for (const nights of nightChoices) {
    // A sleeper leaves the evening AFTER your last night (you arrived the morning
    // after departing), so its return date is one day later than a day trip's.
    const returnDate = addDays(date, sleeper ? nights + 1 : nights);
    let back: Journey | null = null;
    for (const j of findJourneys(trains, dest, origin, returnDate, opts)) {
      if (journeyArriveAbs(j) > arriveCeil) continue; // gets home too late
      // Same-day: leave enough time in the city; a stay (or any sleeper) needs no gap.
      if (!sleeper && nights === 0 && j.departMin < journeyArriveAbs(out) + minOnSite) continue;
      if (!back || j.departMin > back.departMin) back = j; // keep the latest return
    }
    if (back) {
      return {
        destination: dest,
        outbound: out,
        back,
        nights,
        onSiteMin: !sleeper && nights === 0 ? back.departMin - journeyArriveAbs(out) : undefined,
        travelMin: out.totalDurationMin + back.totalDurationMin,
      };
    }
  }
  return null;
}

/**
 * Stay lengths to try, longest first. A sleeper trip always has ≥ 1 night (you
 * ride overnight, so same-day is impossible); a day trip allows same-day [0]. A
 * flexible search walks down to the shortest stay so the longest feasible wins.
 */
function stayChoices(maxNights: number, flexible: boolean, sleeper: boolean): number[] {
  // Descending [hi, hi-1, …, lo].
  const range = (hi: number, lo: number): number[] => Array.from({ length: hi - lo + 1 }, (_, i) => hi - i);
  if (sleeper) {
    const top = Math.max(maxNights, 1); // overnight both ways → never same-day
    return flexible ? range(top, 1) : [top];
  }
  if (maxNights === 0) return [0]; // a same-day day trip
  return flexible ? range(maxNights, 1) : [maxNights];
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
 * destinations startable that day. Sorted best-first.
 *
 * Exhaustive rather than fast — a per-station search on every day. The app runs
 * {@link getawayIdeas} instead; this stays as the reference implementation the unit
 * tests hold that faster two-sweep version against.
 */
export function getawaysAcrossWindow(
  trains: MaxTrain[],
  origin: string,
  dates: string[],
  opts: GetawayOptions = {},
  accept: (destination: string) => boolean = () => true,
): GetawaySweep {
  const byDest = new Map<string, Getaway>();
  const datesByDest = new Map<string, string[]>();
  const perDay: CalendarDay[] = [];
  for (const date of dates) {
    let count = 0;
    for (const g of getaways(trains, origin, date, opts)) {
      if (!accept(g.destination)) continue;
      count++;
      pushDate(datesByDest, g.destination, date);
      const cur = byDest.get(g.destination);
      if (!cur || betterGetaway(g, cur)) byDest.set(g.destination, g);
    }
    perDay.push({ date, available: count > 0, count });
  }
  return { trips: [...byDest.values()].sort(sortGetaways), perDay, datesByDest };
}

/**
 * The same round trip to ONE known destination, started on each of `dates`: "I want
 * Paris → Lyon with two nights there — which days work?". Unlike
 * {@link getawayIdeas}, which keeps the single best escape per destination, this
 * keeps one entry per start day (days with no feasible there-and-back drop out) and
 * leaves them in the order given, i.e. chronological.
 */
export function getawaysToAcrossWindow(
  trains: MaxTrain[],
  origin: string,
  destination: string,
  dates: string[],
  opts: GetawayOptions = {},
): Getaway[] {
  const out: Getaway[] = [];
  for (const date of dates) {
    const g = bestGetawayTo(trains, origin, destination, date, opts);
    if (g) out.push(g);
  }
  return out;
}

/**
 * EVERY round trip (out + back, both free MAX) from `origin` to `destination` that
 * STARTS on `date`, best-first — not just the single best. Each distinct outbound is
 * paired with its own best return, so the list varies by departure time (and thus by
 * time on site): the first is the longest/best (what {@link bestGetawayTo} returns),
 * the rest are earlier-home alternatives for when you don't want the longest one.
 * Deduplicated on (outbound depart, return depart).
 */
export function getawaysForDay(
  trains: MaxTrain[],
  origin: string,
  destination: string,
  date: string,
  opts: GetawayOptions = {},
): Getaway[] {
  const seen = new Set<string>();
  const out: Getaway[] = [];
  for (const j of findJourneys(trains, origin, destination, date, opts)) {
    const g = bestGetawayTo(trains, origin, destination, date, opts, j);
    if (!g) continue;
    const key = `${g.outbound.date}/${g.outbound.departMin}>${g.back.date}/${g.back.departMin}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(g);
  }
  return out.sort(sortGetaways);
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
): GetawaySweep {
  const maxNights = Math.max(0, Math.floor(opts.nights ?? 0));
  const minOnSite = opts.minOnSiteMin ?? 240;
  // Sleeper round trips arrive each morning, so the return lands the day after it
  // leaves (later ceiling) and there's no same-day option (nights ≥ 1).
  const sleeper = Boolean(opts.onlyNight);
  const arriveCeil = sleeper ? NIGHT_RETURN_CEIL : opts.lateReturn ? LATE_RETURN_CEIL : MIDNIGHT;
  const nightChoices = stayChoices(maxNights, Boolean(opts.flexibleNights), sleeper);

  const byDest = new Map<string, Getaway>();
  const datesByDest = new Map<string, string[]>();
  const perDay: CalendarDay[] = [];
  for (const date of dates) {
    // Outbound must be the EARLIEST-ARRIVING journey per destination (the Getaway
    // contract, and what bestGetawayTo uses) — not the fastest — so the same-day
    // on-site gate, onSiteMin, shown train and ranking match the "Where to?" view.
    const outboundMap = reachableJourneys(trains, origin, date, { ...opts, earliestArrival: true });
    const startable = new Set<string>(); // round-trippable destinations starting today
    for (const nights of nightChoices) {
      // A sleeper return leaves the evening after your last night — one day later.
      const returns = latestReturns(trains, origin, addDays(date, sleeper ? nights + 1 : nights), arriveCeil, opts);
      if (returns.size === 0) continue;
      for (const [dest, outbound] of outboundMap) {
        if (dest === origin || !accept(dest)) continue;
        const back = returns.get(dest);
        if (!back) continue;
        // Same-day: the return must leave after you've had your time in the city.
        if (!sleeper && nights === 0 && back.departMin < journeyArriveAbs(outbound) + minOnSite) continue;
        startable.add(dest);
        const g: Getaway = {
          destination: dest,
          outbound,
          back,
          nights,
          onSiteMin: !sleeper && nights === 0 ? back.departMin - journeyArriveAbs(outbound) : undefined,
          travelMin: outbound.totalDurationMin + back.totalDurationMin,
        };
        const cur = byDest.get(dest);
        if (!cur || betterGetaway(g, cur)) byDest.set(dest, g);
      }
    }
    for (const dest of startable) pushDate(datesByDest, dest, date);
    perDay.push({ date, available: startable.size > 0, count: startable.size });
  }
  return { trips: [...byDest.values()].sort(sortGetaways), perDay, datesByDest };
}
