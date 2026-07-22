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
  switch (stay) {
    case "sameday":
      return 0;
    case "n1":
      return 1;
    case "n2":
      return 2;
    case "n3":
      return 3;
    case "flexible":
      return null;
  }
}

/** The stay choice implied by a concrete night count: 0 → same day, 1/2/3 → that many
 *  nights, anything longer → flexible (no fixed chip covers it). Used to resolve a
 *  legacy `rdate` / a carried return date back onto the stay control. */
export function stayFromNights(nights: number): StayChoice {
  if (nights <= 0) return "sameday";
  if (nights === 1) return "n1";
  if (nights === 2) return "n2";
  if (nights === 3) return "n3";
  return "flexible";
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
