/** Time helpers. All "times" are minutes from local midnight unless noted. */

/** Parse "HH:MM" or "HH:MM:SS" into minutes from midnight. NaN if unparseable. */
export function parseTimeToMinutes(t: string | undefined | null): number {
  if (!t) return NaN;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t).trim());
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Minutes from midnight -> "HH:MM" (wraps a day so 1490 -> "00:50"). */
export function minutesToHHMM(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Human duration, e.g. 135 -> "2 h 15". */
export function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}

/** Days since the Unix epoch for a "YYYY-MM-DD" date (UTC, stable). */
export function dayIndex(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

/** Absolute minute on a continuous timeline across dates. */
export function absoluteMinute(date: string, minutesFromMidnight: number): number {
  return dayIndex(date) * 1440 + minutesFromMidnight;
}
