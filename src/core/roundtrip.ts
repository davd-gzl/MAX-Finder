import type { MaxTrain, Journey, RoundTrip, StayChoice } from "../types";
import { findJourneys, type ConnectionOptions } from "./connections";
import { absoluteMinute } from "../util/time";

/**
 * Nights at the destination for a fixed stay choice, or `null` for `"flexible"`
 * (whose length is decided from the return calendar, not fixed up front). `"sameday"`
 * is 0 nights (a day trip). Shared by the query→return-date derivation, the discovery
 * getaway options, and the URL round-tripping.
 */
export function stayNights(stay: StayChoice): number | null {
  if (stay === "sameday") return 0;
  if (stay === "flexible") return null;
  // `` `n${N}` `` — a fixed N-night stay, for ANY N (n1, n2, … n10 …).
  const n = Number(stay.slice(1));
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
}

/** The stay choice implied by a concrete night count: 0 → same day, N → a FIXED N-night
 *  stay (`` `n${N}` ``) for ANY N. This never returns `"flexible"` — a fixed stay is
 *  decoupled from Flexible mode, so a long stay stays a fixed stay (Flexible comes only
 *  from the pill). Used to resolve a legacy `rdate` / a carried return date onto the stay
 *  control, and to serialize the nights stepper. */
export function stayFromNights(nights: number): StayChoice {
  if (nights <= 0) return "sameday";
  return `n${Math.floor(nights)}`;
}

function stayMinutes(outbound: Journey, inbound: Journey): number {
  // Absolute arrival of the outbound: its bare arriveMin is only the last leg's
  // own-date minute, so add the true cross-date span to the start-date departure.
  const outboundArrivesAbs = absoluteMinute(outbound.date, outbound.departMin) + outbound.totalDurationMin;
  return absoluteMinute(inbound.date, inbound.departMin) - outboundArrivesAbs;
}

/**
 * Round-trips where both legs have a free-MAX seat. The inbound must depart after
 * the outbound arrives (a positive stay). Sorted by outbound departure, then by
 * shortest combined travel time.
 */
export function findRoundTrips(
  trains: MaxTrain[],
  origin: string,
  destination: string,
  outboundDate: string,
  inboundDate: string,
  opts: ConnectionOptions = {},
): RoundTrip[] {
  const outbound = findJourneys(trains, origin, destination, outboundDate, opts);
  const inbound = findJourneys(trains, destination, origin, inboundDate, opts);
  const trips: RoundTrip[] = [];
  for (const o of outbound) {
    for (const i of inbound) {
      const stay = stayMinutes(o, i);
      if (stay <= 0) continue;
      trips.push({ outbound: o, inbound: i, stayMinutes: stay });
    }
  }
  return trips.sort(
    (a, b) =>
      a.outbound.departMin - b.outbound.departMin ||
      a.outbound.totalDurationMin +
        a.inbound.totalDurationMin -
        (b.outbound.totalDurationMin + b.inbound.totalDurationMin),
  );
}
