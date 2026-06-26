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

/** "YYYY-MM-DD" shifted by `n` days. */
export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Absolute minute on a continuous timeline across dates. */
export function absoluteMinute(date: string, minutesFromMidnight: number): number {
  return dayIndex(date) * 1440 + minutesFromMidnight;
}

const RELATIVE_UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
  ["second", 1],
];

/**
 * Localized "x ago" / "in x" for an ISO timestamp, e.g. "il y a 3 h" / "3 hr ago".
 * Picks the largest sensible unit. Returns "" for an empty/unparseable timestamp.
 */
export function relativeTime(iso: string, lang: string, now: Date = new Date()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const diffSec = Math.round((then - now.getTime()) / 1000); // <0 = past
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const abs = Math.abs(diffSec);
  for (const [unit, secs] of RELATIVE_UNITS) {
    if (abs >= secs || unit === "second") return rtf.format(Math.round(diffSec / secs), unit);
  }
  return rtf.format(0, "second");
}
