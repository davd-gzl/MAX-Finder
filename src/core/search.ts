import type { MaxTrain } from "../types";
import { parseTimeToMinutes } from "../util/time";

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

/**
 * A real sleeper train — an "Intercités de Nuit" you actually spend the night on,
 * not just any service that leaves late or rolls a little past midnight. The open
 * dataset tags these with the `IC NUIT` axe.
 */
export function isNightTrain(t: MaxTrain): boolean {
  return (t.axe ?? "").includes("NUIT");
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
