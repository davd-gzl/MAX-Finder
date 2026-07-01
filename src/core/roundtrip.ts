import type { MaxTrain, Journey, RoundTrip } from "../types";
import { findJourneys, type ConnectionOptions } from "./connections";
import { absoluteMinute } from "../util/time";

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
