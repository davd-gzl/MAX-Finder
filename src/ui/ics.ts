import type { Journey } from "../types";
import { SITE_URL } from "../config";

function stamp(date: string, minutesFromMidnight: number): string {
  // minutesFromMidnight may exceed 1440 (arrival after midnight) -> roll the date.
  const base = Date.parse(`${date}T00:00:00Z`);
  const d = new Date(base + minutesFromMidnight * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}00`
  );
}

function escapeIcs(s: string): string {
  // Escape ICS special chars and neutralize CR/LF so dataset strings can't
  // inject extra property lines (RFC 5545 line folding / injection).
  return s.replace(/([,;\\])/g, "\\$1").replace(/\r\n|\r|\n/g, "\\n");
}

function safeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9-]/g, "");
}

/** Current UTC instant as an iCalendar DATE-TIME (e.g. 20260625T101500Z). */
function utcStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Build a minimal VEVENT (floating local time) for a journey. */
export function journeyToIcs(j: Journey, summary: string, description = ""): string {
  const uid = `${j.date}-${j.legs.map((l) => safeId(l.trainNo)).join("-")}@maxjeune-foss`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MAX Finder//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${utcStamp()}`,
    `DTSTART:${stamp(j.date, j.departMin)}`,
    // Absolute arrival from the start date (departMin + total span) so a connecting
    // journey whose last leg lands the next day gets the right end date, not the last
    // leg's own-date minute stamped back onto the start date.
    `DTEND:${stamp(j.date, j.departMin + j.totalDurationMin)}`,
    `SUMMARY:${escapeIcs(summary)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    `URL:${SITE_URL}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

export function downloadText(filename: string, content: string, mime = "text/calendar"): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
