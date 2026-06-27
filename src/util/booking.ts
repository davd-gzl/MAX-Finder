/**
 * Best-effort SNCF Connect deep link that pre-fills the trip search.
 *
 * SNCF Connect doesn't publish a fully deterministic booking URL, but its search
 * page accepts a free-text `userInput` (e.g. "Paris Lyon 29/06/2026 08h30") and
 * pre-fills the journey from it — so this drops the traveller on the right search,
 * ready to pick the MAX fare and book.
 *
 * Thanks to Fyroeo (https://github.com/Fyroeo) for the userInput format.
 */
export function generateBookingUrl(
  origin: string,
  destination: string,
  date: string,
  time?: string,
): string {
  // YYYY-MM-DD → DD/MM/YYYY (leave anything unexpected untouched).
  const [year, month, day] = date.split("-");
  const formattedDate = year && month && day ? `${day}/${month}/${year}` : date;
  const parts = [origin, destination, formattedDate];
  if (time) parts.push(time.replace(":", "h")); // HH:MM → HHhMM
  return `https://www.sncf-connect.com/home/search?userInput=${encodeURIComponent(parts.join(" "))}`;
}
