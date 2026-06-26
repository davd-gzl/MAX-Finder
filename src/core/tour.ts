import type { MaxTrain, Journey } from "../types";
import { bestJourney, type ConnectionOptions } from "./connections";

export interface Tour {
  /** Cities in visit order (after the start). */
  order: string[];
  /** One journey per hop, scheduled within the per-stay day window. */
  legs: Journey[];
  totalDurationMin: number;
}

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

function permutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr.slice()];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const head = arr[i];
    if (head === undefined) continue;
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutations(rest)) out.push([head, ...p]);
  }
  return out;
}

/** Date the traveller actually arrives at the destination of a journey. */
function arrivalDate(j: Journey): string {
  const last = j.legs[j.legs.length - 1];
  if (!last) return j.date;
  // arriveMin >= 1440 means the leg crossed midnight (normalised that way).
  return last.arriveMin >= 1440 ? addDays(last.date, 1) : last.date;
}

type FirstFeasible = (from: string, to: string, fromDate: string, toDate: string) => Journey | null;

/** A memoised "earliest free-MAX journey within a date window" finder. */
function makeFirstFeasible(trains: MaxTrain[], opts: ConnectionOptions): FirstFeasible {
  const memo = new Map<string, Journey | null>();
  const hop = (from: string, to: string, date: string): Journey | null => {
    const key = `${from}|${to}|${date}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    const j = bestJourney(trains, from, to, date, opts);
    memo.set(key, j);
    return j;
  };
  return (from, to, fromDate, toDate) => {
    for (let d = fromDate; d <= toDate; d = addDays(d, 1)) {
      const j = hop(from, to, d);
      if (j) return j;
    }
    return null;
  };
}

/**
 * One feasible itinerary for an exact visit order `seq` (seq[0] is the start),
 * scheduling each hop within the per-stay day window. Returns the legs, or null
 * if any hop has no free-MAX journey in its window.
 */
function planSequence(
  firstFeasible: FirstFeasible,
  seq: string[],
  startDate: string,
  lo: number,
  hi: number,
): Journey[] | null {
  const legs: Journey[] = [];
  let depFrom = startDate; // the first hop leaves on the chosen start date
  let depTo = startDate;
  for (let i = 0; i < seq.length - 1; i++) {
    const from = seq[i];
    const to = seq[i + 1];
    if (!from || !to) return null;
    const j = firstFeasible(from, to, depFrom, depTo);
    if (!j) return null;
    legs.push(j);
    const arr = arrivalDate(j);
    depFrom = addDays(arr, lo);
    depTo = addDays(arr, hi);
  }
  return legs;
}

/**
 * Plan multi-city tours: visit every city in `cities` starting at `startDate`,
 * staying between `minDays` and `maxDays` days in each city before the next hop.
 * For each hop the planner *searches* that day window for the earliest free-MAX
 * journey (so a tour is feasible as long as some train runs within the range,
 * not only on one exact day). The first leg departs on `startDate`. Tries every
 * visiting order (capped at 5 cities) and ranks feasible tours by travel time.
 */
export function planTours(
  trains: MaxTrain[],
  start: string,
  cities: string[],
  startDate: string,
  opts: ConnectionOptions = {},
  limit = 10,
  minDays = 1,
  maxDays = minDays,
): Tour[] {
  const unique = [...new Set(cities.filter((c) => c && c !== start))];
  if (unique.length === 0 || unique.length > 5) return [];
  const lo = Math.max(1, Math.floor(minDays));
  const hi = Math.max(lo, Math.floor(maxDays));
  const firstFeasible = makeFirstFeasible(trains, opts);

  const tours: Tour[] = [];
  for (const perm of permutations(unique)) {
    const legs = planSequence(firstFeasible, [start, ...perm], startDate, lo, hi);
    if (!legs) continue;
    tours.push({
      order: perm,
      legs,
      totalDurationMin: legs.reduce((s, j) => s + j.totalDurationMin, 0),
    });
  }
  return tours.sort((a, b) => a.totalDurationMin - b.totalDurationMin).slice(0, limit);
}

/**
 * Plan a tour that visits `cities` in the GIVEN order (no re-ordering). Use this
 * when the order is meaningful or the tour is too large to permute — a greedily
 * grown trip ("nearest stop", or an unbounded Surprise run). Duplicates and the
 * start itself are dropped; returns null if any hop is infeasible in its window.
 */
export function planTourInOrder(
  trains: MaxTrain[],
  start: string,
  cities: string[],
  startDate: string,
  opts: ConnectionOptions = {},
  minDays = 1,
  maxDays = minDays,
): Tour | null {
  const order: string[] = [];
  const seen = new Set([start]);
  for (const c of cities) {
    if (c && !seen.has(c)) {
      seen.add(c);
      order.push(c);
    }
  }
  if (order.length === 0) return null;
  const lo = Math.max(1, Math.floor(minDays));
  const hi = Math.max(lo, Math.floor(maxDays));
  const legs = planSequence(makeFirstFeasible(trains, opts), [start, ...order], startDate, lo, hi);
  if (!legs) return null;
  return { order, legs, totalDurationMin: legs.reduce((s, j) => s + j.totalDurationMin, 0) };
}
