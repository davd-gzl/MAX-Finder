import type { MaxTrain, Journey } from "../types";
import { HUB_STATIONS, MIN_CONNECTION_MIN, MAX_CONNECTION_MIN } from "../config";
import { filterTrains } from "./search";

export interface ConnectionOptions {
  hubs?: string[];
  minConnectionMin?: number;
  maxConnectionMin?: number;
  departAfter?: string; // constrains the first leg only
  departBefore?: string;
  maxDurationMin?: number; // total journey duration
  trainType?: string;
}

function toJourney(legs: MaxTrain[]): Journey {
  const first = legs[0];
  const last = legs[legs.length - 1];
  if (!first || !last) throw new Error("toJourney requires at least one leg");
  const connectionMin =
    legs.length === 2 && legs[1] ? legs[1].departMin - first.arriveMin : undefined;
  return {
    date: first.date,
    origin: first.origin,
    destination: last.destination,
    legs,
    departMin: first.departMin,
    arriveMin: last.arriveMin,
    totalDurationMin: last.arriveMin - first.departMin,
    connectionMin,
    hub: legs.length === 2 ? first.destination : undefined,
  };
}

function dedupe(journeys: Journey[]): Journey[] {
  const seen = new Set<string>();
  const out: Journey[] = [];
  for (const j of journeys) {
    const key = `${j.date}|${j.legs.map((l) => `${l.trainNo}@${l.origin}`).join(">")}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(j);
    }
  }
  return out;
}

/**
 * Find direct + single-connection journeys from `origin` to `destination` on `date`.
 * A connection is kept only if both legs are free-MAX, meet at a hub, and the layover
 * is within the allowed window. Sorted by departure, then total duration.
 */
export function findJourneys(
  trains: MaxTrain[],
  origin: string,
  destination: string,
  date: string,
  opts: ConnectionOptions = {},
): Journey[] {
  const hubs = opts.hubs ?? HUB_STATIONS;
  const minConn = opts.minConnectionMin ?? MIN_CONNECTION_MIN;
  const maxConn = opts.maxConnectionMin ?? MAX_CONNECTION_MIN;

  // First-leg candidates respect the user's departure window.
  const firstLegPool = filterTrains(trains, {
    date,
    departAfter: opts.departAfter,
    departBefore: opts.departBefore,
    trainType: opts.trainType,
  });
  // Second legs only need to be available that day.
  const dayPool = filterTrains(trains, { date, trainType: opts.trainType });

  const journeys: Journey[] = [];

  for (const t of firstLegPool) {
    if (t.origin === origin && t.destination === destination) journeys.push(toJourney([t]));
  }

  for (const hub of hubs) {
    if (hub === origin || hub === destination) continue;
    const legs1 = firstLegPool.filter((t) => t.origin === origin && t.destination === hub);
    if (legs1.length === 0) continue;
    const legs2 = dayPool.filter((t) => t.origin === hub && t.destination === destination);
    if (legs2.length === 0) continue;
    for (const l1 of legs1) {
      for (const l2 of legs2) {
        const layover = l2.departMin - l1.arriveMin;
        if (layover >= minConn && layover <= maxConn) journeys.push(toJourney([l1, l2]));
      }
    }
  }

  let result = dedupe(journeys);
  if (opts.maxDurationMin !== undefined) {
    result = result.filter((j) => j.totalDurationMin <= opts.maxDurationMin!);
  }
  return result.sort(
    (a, b) => a.departMin - b.departMin || a.totalDurationMin - b.totalDurationMin,
  );
}
