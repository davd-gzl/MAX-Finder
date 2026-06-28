import type { MaxTrain } from "../types";
import { parseTimeToMinutes } from "../util/time";
import { NIGHT_DEPART_MIN } from "../config";

export interface FilterOptions {
  origin?: string;
  destination?: string;
  date?: string;
  departAfter?: string; // "HH:MM"
  departBefore?: string; // "HH:MM"
  maxDurationMin?: number;
  trainType?: string; // matches MaxTrain.axe
  /** When true (default) only free-MAX trains are kept. */
  availableOnly?: boolean;
  /** Drop night trains (leave late or arrive past midnight) when true. */
  excludeNight?: boolean;
  /** Keep ONLY night trains (sleep aboard) when true. */
  onlyNight?: boolean;
}

/** A train that travels through the night: leaves late or arrives past midnight. */
export function isNightTrain(t: MaxTrain): boolean {
  return t.departMin >= NIGHT_DEPART_MIN || t.arriveMin >= 1440;
}

/** Filter + sort trains (by departure time) for a set of constraints. */
export function filterTrains(trains: MaxTrain[], opts: FilterOptions): MaxTrain[] {
  const availableOnly = opts.availableOnly ?? true;
  const after = opts.departAfter ? parseTimeToMinutes(opts.departAfter) : undefined;
  const before = opts.departBefore ? parseTimeToMinutes(opts.departBefore) : undefined;
  return trains
    .filter((t) => {
      if (availableOnly && !t.available) return false;
      if (opts.date && t.date !== opts.date) return false;
      if (opts.origin && t.origin !== opts.origin) return false;
      if (opts.destination && t.destination !== opts.destination) return false;
      if (after !== undefined && t.departMin < after) return false;
      if (before !== undefined && t.departMin > before) return false;
      if (opts.maxDurationMin !== undefined && t.durationMin > opts.maxDurationMin) return false;
      if (opts.trainType && (t.axe ?? "") !== opts.trainType) return false;
      if (opts.excludeNight && isNightTrain(t)) return false;
      if (opts.onlyNight && !isNightTrain(t)) return false;
      return true;
    })
    .sort((a, b) => a.departMin - b.departMin);
}
