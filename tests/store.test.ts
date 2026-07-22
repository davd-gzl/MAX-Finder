import { describe, it, expect } from "vitest";
import type { SearchQuery } from "../src/types";
import { queryToParams, queryFromParams } from "../src/state/store";
import { stayFromNights, stayNights } from "../src/core/roundtrip";

describe("stay choice: fixed N nights are decoupled from Flexible (bug: stepper stuck at 4)", () => {
  it("stayFromNights maps ANY N>3 to a FIXED n-night stay, never Flexible", () => {
    expect(stayFromNights(0)).toBe("sameday");
    expect(stayFromNights(1)).toBe("n1");
    expect(stayFromNights(3)).toBe("n3");
    // The old bug: stayFromNights(4) returned "flexible", which the form then read as
    // Flexible mode and disabled the stepper. A fixed 4-night stay must stay fixed.
    expect(stayFromNights(4)).toBe("n4");
    expect(stayFromNights(7)).toBe("n7");
    expect(stayFromNights(10)).toBe("n10");
    for (let n = 4; n <= 10; n++) expect(stayFromNights(n)).not.toBe("flexible");
  });

  it("stayNights inverts a fixed N-night stay for any N", () => {
    expect(stayNights("sameday")).toBe(0);
    expect(stayNights("n4")).toBe(4);
    expect(stayNights("n10")).toBe(10);
    expect(stayNights("flexible")).toBeNull();
  });

  it("serializes a fixed N>3 stay to the URL and parses it back unchanged (not Flexible)", () => {
    for (const stay of ["n4", "n5", "n7", "n10"] as const) {
      const params = queryToParams({ mode: "od", date: "2026-06-25", card: "jeune", maxConnections: 1, stay } as SearchQuery);
      expect(params.get("stay")).toBe(stay.slice(1)); // n4 → "4"
      const back = queryFromParams(params, "2026-06-25");
      expect(back.stay).toBe(stay); // round-trips as the SAME fixed stay, not "flexible"
    }
    // Flexible still serializes as flex.
    const flex = queryToParams({ mode: "od", date: "2026-06-25", card: "jeune", maxConnections: 1, stay: "flexible" } as SearchQuery);
    expect(flex.get("stay")).toBe("flex");
    expect(queryFromParams(flex, "2026-06-25").stay).toBe("flexible");
  });
});

describe("URL deep-link round-trip", () => {
  it("preserves every field through serialize -> parse", () => {
    const q: SearchQuery = {
      mode: "od",
      origin: "PARIS (intramuros)",
      destination: "LYON (intramuros)",
      date: "2026-06-25",
      card: "senior",
      departAfter: "08:00",
      departBefore: "20:00",
      maxDurationMin: 180,
      trainType: "SUD EST",
      maxConnections: 2,
      region: undefined,
      cities: undefined,
    };
    const back = queryFromParams(queryToParams(q), "2000-01-01");
    expect(back).toEqual(q);
  });

  it("guards against a non-numeric maxdur (would otherwise be NaN and wipe results)", () => {
    expect(queryFromParams(new URLSearchParams("mode=od&maxdur=abc"), "2026-06-25").maxDurationMin).toBeUndefined();
    expect(queryFromParams(new URLSearchParams("maxdur=0"), "2026-06-25").maxDurationMin).toBeUndefined();
    expect(queryFromParams(new URLSearchParams("maxdur=120"), "2026-06-25").maxDurationMin).toBe(120);
  });

  it("defaults sensibly when params are absent", () => {
    const q = queryFromParams(new URLSearchParams(""), "2026-06-25");
    expect(q.mode).toBe("from");
    expect(q.date).toBe("2026-06-25");
    expect(q.card).toBe("jeune");
    expect(q.maxConnections).toBe(1);
  });

  it("clamps an out-of-range URL flex to the max instead of dropping it", () => {
    // A shared link asking for more than the stepper allows should mean "the widest
    // window" (7), not silently fall back to no flexibility (0/undefined).
    expect(queryFromParams(new URLSearchParams("flex=8"), "2026-06-25").flexDays).toBe(7);
    expect(queryFromParams(new URLSearchParams("flex=30"), "2026-06-25").flexDays).toBe(7);
    expect(queryFromParams(new URLSearchParams("flex=3"), "2026-06-25").flexDays).toBe(3);
    // 0 / negative / absent means no flexibility.
    expect(queryFromParams(new URLSearchParams("flex=0"), "2026-06-25").flexDays).toBeUndefined();
    expect(queryFromParams(new URLSearchParams("flex=-2"), "2026-06-25").flexDays).toBeUndefined();
    expect(queryFromParams(new URLSearchParams(""), "2026-06-25").flexDays).toBeUndefined();
  });
});
