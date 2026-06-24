import { describe, it, expect } from "vitest";
import type { RawRecord } from "../src/types";
import { normalizeRecords, normalizeRecord } from "../src/data/dataset";
import { filterTrains } from "../src/core/search";
import { reachableDestinations, reachableOrigins } from "../src/core/destinations";
import { findJourneys } from "../src/core/connections";
import { availabilityCalendar } from "../src/core/calendar";
import { findRoundTrips } from "../src/core/roundtrip";
import sample from "../data/tgvmax.sample.json";

const trains = normalizeRecords(sample as RawRecord[]);

describe("normalizeRecord", () => {
  it("computes duration and handles trains crossing midnight", () => {
    const overnight = normalizeRecord({
      date: "2026-06-25",
      origine: "PARIS (intramuros)",
      destination: "TOULON",
      heure_depart: "23:00",
      heure_arrivee: "00:50",
      train_no: "6190",
      od_happy_card: "OUI",
    });
    expect(overnight).not.toBeNull();
    expect(overnight!.departMin).toBe(23 * 60);
    expect(overnight!.arriveMin).toBe(24 * 60 + 50); // +1 day
    expect(overnight!.durationMin).toBe(110);
    expect(overnight!.arrive).toBe("00:50");
  });

  it("maps od_happy_card to availability and drops invalid rows", () => {
    expect(normalizeRecord({ ...base(), od_happy_card: "OUI" })!.available).toBe(true);
    expect(normalizeRecord({ ...base(), od_happy_card: "NON" })!.available).toBe(false);
    expect(normalizeRecord({ ...base(), heure_depart: "" })).toBeNull();
  });
});

describe("reachableDestinations", () => {
  it("lists free-MAX destinations from Paris on 2026-06-25 and excludes NON-only routes", () => {
    const dests = reachableDestinations(trains, "PARIS (intramuros)", "2026-06-25").map(
      (g) => g.station,
    );
    expect(dests).toContain("LYON (intramuros)");
    expect(dests).toContain("MARSEILLE ST CHARLES");
    expect(dests).toContain("BORDEAUX ST JEAN");
    expect(dests).toContain("STRASBOURG");
    // Direct Paris->Toulouse is NON only that day, so it must NOT appear.
    expect(dests).not.toContain("TOULOUSE MATABIAU");
  });

  it("groups multiple trains per destination", () => {
    const lyon = reachableDestinations(trains, "PARIS (intramuros)", "2026-06-25").find(
      (g) => g.station === "LYON (intramuros)",
    );
    expect(lyon?.count).toBe(3); // 08:00, 14:00, 19:00
  });
});

describe("reachableOrigins (reverse search)", () => {
  it("finds origins that reach Paris on 2026-06-27", () => {
    const origins = reachableOrigins(trains, "PARIS (intramuros)", "2026-06-27").map(
      (g) => g.station,
    );
    expect(origins).toEqual(
      expect.arrayContaining(["LYON (intramuros)", "MARSEILLE ST CHARLES"]),
    );
  });
});

describe("filterTrains", () => {
  it("respects a departure-time window", () => {
    const after10 = filterTrains(trains, {
      origin: "PARIS (intramuros)",
      destination: "LYON (intramuros)",
      date: "2026-06-25",
      departAfter: "10:00",
    });
    expect(after10.map((t) => t.trainNo)).toEqual(["6605", "6609"]); // not the 08:00
  });

  it("respects a max-duration filter", () => {
    const short = filterTrains(trains, {
      origin: "PARIS (intramuros)",
      date: "2026-06-25",
      maxDurationMin: 180,
    });
    // Nice is 6h, must be excluded; Lyon (2h) included.
    expect(short.some((t) => t.destination === "NICE VILLE")).toBe(false);
    expect(short.some((t) => t.destination === "LYON (intramuros)")).toBe(true);
  });
});

describe("findJourneys (connections)", () => {
  it("finds a single-connection journey when no direct train exists", () => {
    const journeys = findJourneys(
      trains,
      "PARIS (intramuros)",
      "TOULOUSE MATABIAU",
      "2026-06-25",
    );
    expect(journeys.length).toBeGreaterThan(0);
    const j = journeys[0]!;
    expect(j.legs.length).toBe(2);
    expect(j.hub).toBe("BORDEAUX ST JEAN");
    expect(j.legs[0]!.trainNo).toBe("8401");
    expect(j.legs[1]!.trainNo).toBe("8551");
    expect(j.connectionMin).toBe(40);
  });

  it("returns direct AND connecting journeys when both exist", () => {
    const journeys = findJourneys(
      trains,
      "PARIS (intramuros)",
      "MARSEILLE ST CHARLES",
      "2026-06-25",
    );
    const direct = journeys.filter((j) => j.legs.length === 1);
    const connecting = journeys.filter((j) => j.legs.length === 2);
    expect(direct.length).toBeGreaterThan(0); // train 6101
    expect(connecting.some((j) => j.hub === "LYON (intramuros)")).toBe(true);
  });

  it("never builds a connection from an unavailable leg", () => {
    const journeys = findJourneys(
      trains,
      "PARIS (intramuros)",
      "MARSEILLE ST CHARLES",
      "2026-06-25",
    );
    for (const j of journeys) {
      for (const leg of j.legs) expect(leg.available).toBe(true);
    }
  });
});

describe("availabilityCalendar", () => {
  it("marks each day available iff a free-MAX train exists", () => {
    const cal = availabilityCalendar(trains, "PARIS (intramuros)", "LYON (intramuros)", [
      "2026-06-25",
      "2026-06-26",
      "2026-06-27",
    ]);
    expect(cal.map((d) => d.available)).toEqual([true, true, false]);
    expect(cal.map((d) => d.count)).toEqual([3, 1, 0]);
  });
});

describe("findRoundTrips", () => {
  it("pairs an outbound and a later inbound, both free-MAX", () => {
    const trips = findRoundTrips(
      trains,
      "PARIS (intramuros)",
      "LYON (intramuros)",
      "2026-06-25",
      "2026-06-27",
    );
    expect(trips.length).toBeGreaterThan(0);
    const t = trips[0]!;
    expect(t.stayMinutes).toBeGreaterThan(0);
    expect(t.outbound.origin).toBe("PARIS (intramuros)");
    expect(t.inbound.destination).toBe("PARIS (intramuros)");
  });
});

function base(): RawRecord {
  return {
    date: "2026-06-25",
    origine: "PARIS (intramuros)",
    destination: "LYON (intramuros)",
    heure_depart: "08:00",
    heure_arrivee: "10:00",
    train_no: "6601",
    od_happy_card: "OUI",
  };
}
