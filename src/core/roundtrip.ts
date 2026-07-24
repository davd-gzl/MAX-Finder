import type { StayChoice } from "../types";

/**
 * Nights at the destination for a fixed stay choice, or `null` for `"flexible"`
 * (whose length is decided from the return calendar, not fixed up front). `"sameday"`
 * is 0 nights (a day trip). Shared by the query→return-date derivation, the discovery
 * getaway options, and the URL round-tripping.
 */
export function stayNights(stay: StayChoice): number | null {
  if (stay === "sameday") return 0;
  if (stay === "flexible") return null;
  // `` `n${N}` `` — a fixed N-night stay, for ANY N (n1, n2, … n10 …).
  const n = Number(stay.slice(1));
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
}

/** The stay choice implied by a concrete night count: 0 → same day, N → a FIXED N-night
 *  stay (`` `n${N}` ``) for ANY N. This never returns `"flexible"` — a fixed stay is
 *  decoupled from Flexible mode, so a long stay stays a fixed stay (Flexible comes only
 *  from the pill). Used to resolve a legacy `rdate` / a carried return date onto the stay
 *  control, and to serialize the nights stepper. */
export function stayFromNights(nights: number): StayChoice {
  if (nights <= 0) return "sameday";
  return `n${Math.floor(nights)}`;
}
