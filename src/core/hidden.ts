import type { MaxTrain } from "../types";
import { parseTimeToMinutes } from "../util/time";
import { isNightTrain } from "./search";

/**
 * A "hidden train" — hidden-city ticketing applied to a MAX seat.
 *
 * When there is no free MAX seat marketed for your exact route (say PARIS →
 * DIJON), but the very same physical train continues past your stop to a station
 * that DOES have a free seat (PARIS → FRASNE, which calls at Dijon on the way),
 * you can book the longer PARIS → FRASNE ticket and simply step off at Dijon.
 *
 * The one firm rule the traveller asked for: **the départ must be the same**. You
 * can only ride *past* your destination, never board *before* your origin — a
 * ticket only lets you join the train at its ticketed origin. So a hidden train
 * always keeps `book.origin === origin`; it only over-shoots the destination.
 */
export interface HiddenTrain {
  /** Where you board — always your search origin (the départ never changes). */
  origin: string;
  /** Where you step off — your real search destination. */
  destination: string;
  /** The over-shot ticketed destination you actually book to (a stop past yours). */
  beyond: string;
  /** The free-MAX record you book: origin → beyond. */
  book: MaxTrain;
  /** "HH:MM" the train calls at your destination (when you get off). */
  alight: string;
  /** Minutes from midnight the train calls at your destination. */
  alightMin: number;
  /** Effective travel time you ride: origin departure → destination call, in minutes. */
  durationMin: number;
}

export interface HiddenOptions {
  departAfter?: string; // "HH:MM"
  departBefore?: string; // "HH:MM"
  trainType?: string; // matches MaxTrain.axe
  /** Drop night trains (leave late / arrive past midnight) when true. */
  excludeNight?: boolean;
}

/**
 * Every hidden train from `origin` to `destination` on `date`, sorted by departure.
 *
 * How we know a PARIS → FRASNE train calls at Dijon without any route/stop data:
 * in the tgvmax feed every marketed sub-relation of one physical train shares the
 * same `trainNo` (and date, and arrival at the shared terminus). So a train that
 * runs PARIS → FRASNE and *also* appears as DIJON → FRASNE with the same train
 * number, same date, and same arrival is provably one train calling PARIS … DIJON
 * … FRASNE. The DIJON → FRASNE record's departure time is when that train leaves
 * Dijon — i.e. when you'd step off.
 *
 * Only the booked leg (origin → beyond) must have a free MAX seat; the onward
 * DIJON → FRASNE record is used purely as proof of the stop, so its own
 * availability is irrelevant.
 */
export function findHiddenTrains(
  trains: MaxTrain[],
  origin: string,
  destination: string,
  date: string,
  opts: HiddenOptions = {},
): HiddenTrain[] {
  if (!origin || !destination || origin === destination) return [];
  const after = opts.departAfter ? parseTimeToMinutes(opts.departAfter) : undefined;
  const before = opts.departBefore ? parseTimeToMinutes(opts.departBefore) : undefined;

  // Records leaving your destination that day, indexed by train number. These are
  // the "tail" segments (destination → beyond) that prove a train calls at your
  // destination. Availability is irrelevant here — a tail is only evidence of a
  // stop, not something you book — so every record counts.
  const tailsByTrain = new Map<string, MaxTrain[]>();
  // Train numbers that already sell a free MAX seat straight to your destination:
  // those aren't "hidden" (you'd just book the normal ticket), so they're excluded.
  const directTrainNos = new Set<string>();
  for (const t of trains) {
    if (t.date !== date) continue;
    if (t.origin === destination) {
      const arr = tailsByTrain.get(t.trainNo);
      if (arr) arr.push(t);
      else tailsByTrain.set(t.trainNo, [t]);
    }
    if (t.available && t.origin === origin && t.destination === destination) {
      directTrainNos.add(t.trainNo);
    }
  }
  if (tailsByTrain.size === 0) return [];

  // Keep the least-overshoot hidden option per booked train (the nearest station
  // past your destination), so one physical train yields one row, not one per
  // onward stop it happens to sell.
  const best = new Map<string, HiddenTrain>();
  for (const head of trains) {
    if (head.date !== date || !head.available) continue;
    if (head.origin !== origin) continue; // the départ must be the same
    if (head.destination === destination || head.destination === origin) continue;
    if (directTrainNos.has(head.trainNo)) continue;
    if (opts.trainType && (head.axe ?? "") !== opts.trainType) continue;
    if (opts.excludeNight && isNightTrain(head)) continue;
    if (after !== undefined && head.departMin < after) continue;
    if (before !== undefined && head.departMin > before) continue;

    for (const tail of tailsByTrain.get(head.trainNo) ?? []) {
      // Same onward terminus, same arrival there → provably the same physical train
      // calling origin … destination … beyond. The train must leave your
      // destination after it left your origin (destination is downstream).
      if (tail.destination !== head.destination) continue;
      if (tail.arrive !== head.arrive) continue;
      if (tail.departMin <= head.departMin) continue;

      const durationMin = tail.departMin - head.departMin;
      const prev = best.get(head.trainNo);
      // Nearest overshoot wins: the booked leg arriving soonest at its terminus is
      // the shortest ride past your stop (cheapest ticket, least risk).
      const candidate: HiddenTrain = {
        origin,
        destination,
        beyond: head.destination,
        book: head,
        alight: tail.depart,
        alightMin: tail.departMin,
        durationMin,
      };
      if (!prev || head.arriveMin < prev.book.arriveMin) best.set(head.trainNo, candidate);
    }
  }

  return [...best.values()].sort((a, b) => a.book.departMin - b.book.departMin);
}
