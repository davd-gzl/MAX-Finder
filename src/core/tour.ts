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
  distance?: Distance,
  maxLegKm?: number,
  startFlex = 0,
  earliestStart?: string,
): Journey[] | null {
  const legs: Journey[] = [];
  // The first hop may leave within ±startFlex days of the chosen date ("flexible
  // departure"), but never before `earliestStart` (the booking floor — you can't
  // travel in the past): the planner takes the earliest feasible start in the window.
  let depFrom = startFlex > 0 ? addDays(startDate, -startFlex) : startDate;
  let depTo = startFlex > 0 ? addDays(startDate, startFlex) : startDate;
  if (earliestStart && depFrom < earliestStart) depFrom = earliestStart;
  for (let i = 0; i < seq.length - 1; i++) {
    const from = seq[i];
    const to = seq[i + 1];
    if (!from || !to) return null;
    // Per-train distance cap: reject a hop longer than maxLegKm (straight line).
    if (maxLegKm && maxLegKm > 0 && distance) {
      const d = distance(from, to);
      if (Number.isFinite(d) && d > maxLegKm) return null;
    }
    const j = firstFeasible(from, to, depFrom, depTo);
    if (!j) return null;
    legs.push(j);
    const arr = arrivalDate(j);
    depFrom = addDays(arr, lo);
    depTo = addDays(arr, hi);
  }
  return legs;
}

export type Distance = (a: string, b: string) => number;

/** Total straight-line km of a tour's legs (unplotted legs count as 0). */
function tourKm(legs: Journey[], distance?: Distance): number {
  if (!distance) return 0;
  return legs.reduce((s, j) => {
    const d = distance(j.origin, j.destination);
    return s + (Number.isFinite(d) ? d : 0);
  }, 0);
}

/** True if the tour fits the optional total-distance budget. */
function withinKm(legs: Journey[], distance?: Distance, maxKm?: number): boolean {
  return !maxKm || maxKm <= 0 || tourKm(legs, distance) <= maxKm;
}

/** True if the tour reaches its final stop on or before `endDate` (when set). */
function endsBy(legs: Journey[], endDate?: string): boolean {
  if (!endDate) return true;
  const last = legs[legs.length - 1];
  return !last || arrivalDate(last) <= endDate;
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
  distance?: Distance,
  maxKm?: number,
  maxLegKm?: number,
  end?: string,
  endDate?: string,
  startFlex = 0,
  earliestStart?: string,
): Tour[] {
  // Intermediates exclude the start and a fixed end (the "nomad" stops in between).
  const unique = [...new Set(cities.filter((c) => c && c !== start && c !== end))];
  if (unique.length === 0 || unique.length > 5) return [];
  const lo = Math.max(1, Math.floor(minDays));
  const hi = Math.max(lo, Math.floor(maxDays));
  const firstFeasible = makeFirstFeasible(trains, opts);
  const tail = end ? [end] : []; // finish at `end` (may equal start → a loop)

  const tours: Tour[] = [];
  for (const perm of permutations(unique)) {
    const legs = planSequence(firstFeasible, [start, ...perm, ...tail], startDate, lo, hi, distance, maxLegKm, startFlex, earliestStart);
    if (!legs) continue;
    if (!withinKm(legs, distance, maxKm)) continue; // over the total-distance budget
    if (!endsBy(legs, endDate)) continue; // doesn't finish by the target date
    tours.push({
      order: [...perm, ...tail],
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
  distance?: Distance,
  maxKm?: number,
  maxLegKm?: number,
  end?: string,
  endDate?: string,
  startFlex = 0,
  earliestStart?: string,
): Tour | null {
  const order: string[] = [];
  const seen = new Set([start]);
  if (end) seen.add(end); // the end is appended last, never visited mid-tour
  for (const c of cities) {
    if (c && !seen.has(c)) {
      seen.add(c);
      order.push(c);
    }
  }
  if (order.length === 0) return null;
  const lo = Math.max(1, Math.floor(minDays));
  const hi = Math.max(lo, Math.floor(maxDays));
  const full = end ? [...order, end] : order; // finish at `end` (may equal start)
  const legs = planSequence(makeFirstFeasible(trains, opts), [start, ...full], startDate, lo, hi, distance, maxLegKm, startFlex, earliestStart);
  if (!legs) return null;
  if (!withinKm(legs, distance, maxKm)) return null; // over the total-distance budget
  if (!endsBy(legs, endDate)) return null; // doesn't finish by the target date
  return { order: full, legs, totalDurationMin: legs.reduce((s, j) => s + j.totalDurationMin, 0) };
}

/**
 * Plan a tour over an arbitrary set of `cities` (no size limit) by greedy
 * nearest-neighbour: from each stop, hop to the closest still-unvisited city that
 * has a feasible free-MAX journey in its day window. `distance(a, b)` ranks the
 * reachable candidates (straight-line km); ties (or missing coords) fall back to
 * the earliest, then shortest, journey. `maxKm` (with `distance`) caps the tour's
 * total straight-line distance — a hop that would bust the budget is skipped.
 * Returns null only if some city can never be reached in sequence (or within the
 * budget) — used for big tours where permuting every order (O(n!)) is infeasible.
 * The visiting order is chosen here, so the typed order needn't be feasible.
 */
export function planTourGreedy(
  trains: MaxTrain[],
  start: string,
  cities: string[],
  startDate: string,
  opts: ConnectionOptions = {},
  minDays = 1,
  maxDays = minDays,
  distance?: Distance,
  maxKm?: number,
  maxLegKm?: number,
  end?: string,
  endDate?: string,
  startFlex = 0,
  earliestStart?: string,
): Tour | null {
  const remaining = [...new Set(cities.filter((c) => c && c !== start && c !== end))];
  if (remaining.length === 0) return null;
  const lo = Math.max(1, Math.floor(minDays));
  const hi = Math.max(lo, Math.floor(maxDays));
  const firstFeasible = makeFirstFeasible(trains, opts);
  const budget = maxKm && maxKm > 0 ? maxKm : Infinity;
  const legCap = maxLegKm && maxLegKm > 0 ? maxLegKm : Infinity;

  const order: string[] = [];
  const legs: Journey[] = [];
  let current = start;
  // Flexible departure: the first hop may leave within ±startFlex days of the chosen
  // date, never before earliestStart (the booking floor).
  let depFrom = startFlex > 0 ? addDays(startDate, -startFlex) : startDate;
  let depTo = startFlex > 0 ? addDays(startDate, startFlex) : startDate;
  if (earliestStart && depFrom < earliestStart) depFrom = earliestStart;
  let spentKm = 0;

  while (remaining.length > 0) {
    let pick = -1;
    let pickJourney: Journey | null = null;
    let pickDist = Infinity;
    let pickHopKm = 0;
    for (let i = 0; i < remaining.length; i++) {
      const city = remaining[i];
      if (!city) continue;
      const j = firstFeasible(current, city, depFrom, depTo);
      if (!j) continue;
      if (endDate && arrivalDate(j) > endDate) continue; // would overrun the target date
      const d = distance ? distance(current, city) : 0;
      if (Number.isFinite(d) && d > legCap) continue; // single hop too long (per-train cap)
      const hopKm = Number.isFinite(d) ? d : 0; // unplotted hop: don't charge the budget
      if (spentKm + hopKm > budget) continue; // would bust the total-distance budget
      const better =
        pickJourney === null ||
        d < pickDist ||
        // Tie on distance (or no coords): prefer the earlier arrival, then the
        // shorter ride, so the remaining window stays as open as possible.
        (d === pickDist &&
          (arrivalDate(j) < arrivalDate(pickJourney) ||
            (arrivalDate(j) === arrivalDate(pickJourney) &&
              j.totalDurationMin < pickJourney.totalDurationMin)));
      if (better) {
        pick = i;
        pickJourney = j;
        pickDist = Number.isFinite(d) ? d : Infinity;
        pickHopKm = hopKm;
      }
    }
    if (pick < 0 || !pickJourney) return null; // unreachable (or over budget) in sequence
    const city = remaining[pick]!;
    order.push(city);
    legs.push(pickJourney);
    remaining.splice(pick, 1);
    current = city;
    spentKm += pickHopKm;
    const arr = arrivalDate(pickJourney);
    depFrom = addDays(arr, lo);
    depTo = addDays(arr, hi);
  }
  // Finish at the fixed end (may equal start → a loop), after every nomad stop.
  if (end) {
    const d = distance ? distance(current, end) : 0;
    const hopKm = Number.isFinite(d) ? d : 0;
    if ((Number.isFinite(d) && d > legCap) || spentKm + hopKm > budget) return null;
    const j = firstFeasible(current, end, depFrom, depTo);
    if (!j) return null;
    order.push(end);
    legs.push(j);
  }
  if (!endsBy(legs, endDate)) return null; // doesn't finish by the target date
  return { order, legs, totalDurationMin: legs.reduce((s, j) => s + j.totalDurationMin, 0) };
}
