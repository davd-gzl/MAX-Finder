import { describe, it, expect } from "vitest";
import type { SearchQuery } from "../src/types";
import { queryToParams, queryFromParams } from "../src/state/store";

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
