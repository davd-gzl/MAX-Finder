import type { Journey } from "../types";

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
    `DTSTART:${stamp(j.date, j.departMin)}`,
    `DTEND:${stamp(j.date, j.arriveMin)}`,
    `SUMMARY:${escapeIcs(summary)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
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
