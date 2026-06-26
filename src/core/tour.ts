import type { MaxTrain, Journey } from "../types";
import { bestJourney, type ConnectionOptions } from "./connections";

export interface Tour {
  /** Cities in visit order (after the start). */
  order: string[];
  /** One journey per hop; leg i departs on startDate + i * stayDays days. */
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

/**
 * Plan multi-city tours: visit every city in `cities` starting at `startDate`,
 * spending `stayDays` days in each city before the next hop (default 1), where
 * each hop has a free-MAX journey. Tries every visiting order (capped at 5
 * cities) and returns the feasible ones ranked by total travel time.
 */
export function planTours(
  trains: MaxTrain[],
  start: string,
  cities: string[],
  startDate: string,
  opts: ConnectionOptions = {},
  limit = 10,
  stayDays = 1,
): Tour[] {
  const unique = [...new Set(cities.filter((c) => c && c !== start))];
  if (unique.length === 0 || unique.length > 5) return [];
  const gap = Math.max(1, Math.floor(stayDays));

  const memo = new Map<string, Journey | null>();
  const hop = (from: string, to: string, date: string): Journey | null => {
    const key = `${from}|${to}|${date}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    const j = bestJourney(trains, from, to, date, opts);
    memo.set(key, j);
    return j;
  };

  const tours: Tour[] = [];
  for (const perm of permutations(unique)) {
    const seq = [start, ...perm];
    const legs: Journey[] = [];
    let ok = true;
    for (let i = 0; i < perm.length; i++) {
      const from = seq[i];
      const to = seq[i + 1];
      if (!from || !to) {
        ok = false;
        break;
      }
      const j = hop(from, to, addDays(startDate, i * gap));
      if (!j) {
        ok = false;
        break;
      }
      legs.push(j);
    }
    if (!ok) continue;
    tours.push({
      order: perm,
      legs,
      totalDurationMin: legs.reduce((s, j) => s + j.totalDurationMin, 0),
    });
  }
  return tours.sort((a, b) => a.totalDurationMin - b.totalDurationMin).slice(0, limit);
}
