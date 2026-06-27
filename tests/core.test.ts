import { describe, it, expect } from "vitest";
import type { RawRecord } from "../src/types";
import { normalizeRecords, normalizeRecord } from "../src/data/dataset";
import { filterTrains } from "../src/core/search";
import { reachableDestinations, reachableOrigins } from "../src/core/destinations";
import { findJourneys } from "../src/core/connections";
import { availabilityCalendar } from "../src/core/calendar";
import { findRoundTrips } from "../src/core/roundtrip";
import { bestTrips, bestTripsAcrossWindow, stationsOnDate } from "../src/core/best";
import { planTours, planTourInOrder, planTourGreedy } from "../src/core/tour";
import { haversineKm } from "../src/util/geo";
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

  it("marks non-bookable (international) endpoints as unavailable even when OUI", () => {
    // Paris -> Geneva shows OUI in the feed but isn't reservable with a MAX pass.
    expect(
      normalizeRecord({ ...base(), destination: "GENEVE", od_happy_card: "OUI" })!.available,
    ).toBe(false);
    expect(
      normalizeRecord({ ...base(), origine: "BRUXELLES MIDI", destination: "LILLE", od_happy_card: "OUI" })!
        .available,
    ).toBe(false);
    // A purely domestic OUI route stays bookable.
    expect(normalizeRecord({ ...base(), destination: "LYON (intramuros)", od_happy_card: "OUI" })!.available).toBe(true);
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

  it("applies the accept predicate so counts match a via-filtered list", () => {
    const dates = ["2026-06-25", "2026-06-26", "2026-06-27"];
    // Rejecting every journey zeroes the calendar — proves the filter is applied.
    const none = availabilityCalendar(
      trains,
      "PARIS (intramuros)",
      "LYON (intramuros)",
      dates,
      {},
      () => false,
    );
    expect(none.map((d) => d.count)).toEqual([0, 0, 0]);
    expect(none.every((d) => !d.available)).toBe(true);

    // Accept-all matches the unfiltered counts.
    const all = availabilityCalendar(trains, "PARIS (intramuros)", "LYON (intramuros)", dates, {}, () => true);
    expect(all.map((d) => d.count)).toEqual([3, 1, 0]);
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

describe("bestTrips", () => {
  it("ranks reachable destinations by shortest total time, including connection-only ones", () => {
    const trips = bestTrips(
      trains,
      "PARIS (intramuros)",
      "2026-06-25",
      stationsOnDate(trains, "2026-06-25"),
      { maxConnections: 1 },
    );
    expect(trips.length).toBeGreaterThan(0);
    expect(trips[0]!.destination).toBe("LILLE"); // 1h02 — the shortest hop
    for (let i = 1; i < trips.length; i++) {
      expect(trips[i]!.journey.totalDurationMin).toBeGreaterThanOrEqual(
        trips[i - 1]!.journey.totalDurationMin,
      );
    }
    const toulouse = trips.find((tr) => tr.destination === "TOULOUSE MATABIAU");
    expect(toulouse).toBeDefined();
    expect(toulouse!.journey.legs.length).toBe(2); // only reachable via a change
  });
});

describe("bestTripsAcrossWindow (ideas, all days)", () => {
  it("unions destinations across the window, keeping each on its earliest day", () => {
    const dates = ["2026-06-25", "2026-06-26", "2026-06-27"];
    const all = bestTripsAcrossWindow(trains, "PARIS (intramuros)", dates, { maxConnections: 1 });
    // Direct destinations from Paris across the window, once each, fastest-first.
    expect(all.length).toBeGreaterThan(0);
    const labels = all.map((t) => t.destination);
    expect(new Set(labels).size).toBe(labels.length); // no destination twice
    for (let i = 1; i < all.length; i++) {
      expect(all[i]!.journey.totalDurationMin).toBeGreaterThanOrEqual(all[i - 1]!.journey.totalDurationMin);
    }
    // A destination that only runs on a later sample day is still listed, dated to
    // the earliest day it actually runs.
    const lyon = all.find((t) => t.destination === "LYON (intramuros)");
    expect(lyon).toBeDefined();
    expect(dates).toContain(lyon!.journey.date);
  });
});

describe("findJourneys multi-hop (2 changes)", () => {
  const twoHop = normalizeRecords([
    { date: "2026-07-01", origine: "NANTES", destination: "PARIS (intramuros)", heure_depart: "08:00", heure_arrivee: "10:00", train_no: "1", od_happy_card: "OUI" },
    { date: "2026-07-01", origine: "PARIS (intramuros)", destination: "LYON (intramuros)", heure_depart: "10:30", heure_arrivee: "12:30", train_no: "2", od_happy_card: "OUI" },
    { date: "2026-07-01", origine: "LYON (intramuros)", destination: "MARSEILLE ST CHARLES", heure_depart: "13:00", heure_arrivee: "14:40", train_no: "3", od_happy_card: "OUI" },
  ] as RawRecord[]);

  it("needs two changes: nothing at maxConnections<=1, a 3-leg journey at 2", () => {
    expect(
      findJourneys(twoHop, "NANTES", "MARSEILLE ST CHARLES", "2026-07-01", { maxConnections: 1 }),
    ).toHaveLength(0);
    const two = findJourneys(twoHop, "NANTES", "MARSEILLE ST CHARLES", "2026-07-01", {
      maxConnections: 2,
    });
    expect(two).toHaveLength(1);
    const j = two[0]!;
    expect(j.legs.map((l) => l.trainNo)).toEqual(["1", "2", "3"]);
    expect(j.hubs).toEqual(["PARIS (intramuros)", "LYON (intramuros)"]);
    expect(j.layovers).toEqual([30, 30]);
  });
});

describe("findJourneys across midnight", () => {
  const overnight = normalizeRecords([
    { date: "2026-08-01", origine: "NANTES", destination: "LYON (intramuros)", heure_depart: "23:00", heure_arrivee: "00:30", train_no: "T1", od_happy_card: "OUI" },
    { date: "2026-08-02", origine: "LYON (intramuros)", destination: "MARSEILLE ST CHARLES", heure_depart: "01:00", heure_arrivee: "02:00", train_no: "T2", od_happy_card: "OUI" },
  ] as RawRecord[]);

  it("pairs a leg arriving after midnight with an early next-day leg", () => {
    const js = findJourneys(overnight, "NANTES", "MARSEILLE ST CHARLES", "2026-08-01", {
      maxConnections: 1,
    });
    expect(js).toHaveLength(1);
    expect(js[0]!.legs.map((l) => l.trainNo)).toEqual(["T1", "T2"]);
    expect(js[0]!.layovers).toEqual([30]); // 00:30 -> 01:00 next day
    expect(js[0]!.totalDurationMin).toBe(180); // 23:00 -> 02:00 (+1 day)
  });
});

describe("findJourneys multi-day span", () => {
  // Paris→Lyon runs day 1; Lyon→Marseille only runs three days later. Reaching
  // Marseille means a multi-day stopover at the Lyon hub.
  const spaced = normalizeRecords([
    { date: "2026-07-01", origine: "PARIS (intramuros)", destination: "LYON (intramuros)", heure_depart: "08:00", heure_arrivee: "10:00", train_no: "A", od_happy_card: "OUI" },
    { date: "2026-07-04", origine: "LYON (intramuros)", destination: "MARSEILLE ST CHARLES", heure_depart: "09:00", heure_arrivee: "11:00", train_no: "B", od_happy_card: "OUI" },
  ] as RawRecord[]);
  const opts = { maxConnections: 1, hubs: ["LYON (intramuros)"] };

  it("finds nothing across the default 2-day pool", () => {
    expect(findJourneys(spaced, "PARIS (intramuros)", "MARSEILLE ST CHARLES", "2026-07-01", opts)).toHaveLength(0);
  });

  it("chains a multi-day stopover when the span is wide enough", () => {
    const js = findJourneys(spaced, "PARIS (intramuros)", "MARSEILLE ST CHARLES", "2026-07-01", {
      ...opts,
      spanDays: 5,
    });
    expect(js).toHaveLength(1);
    expect(js[0]!.legs.map((l) => l.trainNo)).toEqual(["A", "B"]);
    expect(js[0]!.legs[1]!.date).toBe("2026-07-04"); // continues after the stopover
  });
});

describe("planTours", () => {
  const data = normalizeRecords([
    { date: "2026-07-01", origine: "PARIS (intramuros)", destination: "LYON (intramuros)", heure_depart: "08:00", heure_arrivee: "10:00", train_no: "10", od_happy_card: "OUI" },
    { date: "2026-07-02", origine: "LYON (intramuros)", destination: "MARSEILLE ST CHARLES", heure_depart: "09:00", heure_arrivee: "10:40", train_no: "11", od_happy_card: "OUI" },
  ] as RawRecord[]);

  it("orders the cities so each day's hop has a free-MAX train", () => {
    const tours = planTours(
      data,
      "PARIS (intramuros)",
      ["MARSEILLE ST CHARLES", "LYON (intramuros)"],
      "2026-07-01",
      { maxConnections: 0 },
    );
    expect(tours).toHaveLength(1);
    expect(tours[0]!.order).toEqual(["LYON (intramuros)", "MARSEILLE ST CHARLES"]);
    expect(tours[0]!.legs).toHaveLength(2);
  });

  it("allows a flexible departure: the first hop may leave a few days later", () => {
    // The Paris→Lyon train only runs on 07-03, but the user asked to start 07-01.
    const late = normalizeRecords([
      { date: "2026-07-03", origine: "PARIS (intramuros)", destination: "LYON (intramuros)", heure_depart: "08:00", heure_arrivee: "10:00", train_no: "10", od_happy_card: "OUI" },
      { date: "2026-07-04", origine: "LYON (intramuros)", destination: "MARSEILLE ST CHARLES", heure_depart: "09:00", heure_arrivee: "10:40", train_no: "11", od_happy_card: "OUI" },
    ] as RawRecord[]);
    const cities = ["LYON (intramuros)", "MARSEILLE ST CHARLES"];
    const opts = { maxConnections: 0 };
    // No flex: nothing leaves 07-01, so the tour is infeasible.
    expect(planTours(late, "PARIS (intramuros)", cities, "2026-07-01", opts, 10, 1, 1)).toHaveLength(0);
    // startFlex=3: the departure may slip to 07-03 -> the tour plans.
    const flexed = planTours(late, "PARIS (intramuros)", cities, "2026-07-01", opts, 10, 1, 1, undefined, undefined, undefined, undefined, undefined, 3);
    expect(flexed).toHaveLength(1);
    expect(flexed[0]!.legs[0]!.date).toBe("2026-07-03");
  });

  it("searches the min/max day window for each hop (multi-day plan)", () => {
    // Second hop only runs 2 days after arriving in Lyon.
    const spaced = normalizeRecords([
      { date: "2026-07-01", origine: "PARIS (intramuros)", destination: "LYON (intramuros)", heure_depart: "08:00", heure_arrivee: "10:00", train_no: "10", od_happy_card: "OUI" },
      { date: "2026-07-03", origine: "LYON (intramuros)", destination: "MARSEILLE ST CHARLES", heure_depart: "09:00", heure_arrivee: "10:40", train_no: "11", od_happy_card: "OUI" },
    ] as RawRecord[]);
    const cities = ["LYON (intramuros)", "MARSEILLE ST CHARLES"];
    const opts = { maxConnections: 0 };
    // min=max=1: the second hop would need 2026-07-02 — no train, infeasible.
    expect(planTours(spaced, "PARIS (intramuros)", cities, "2026-07-01", opts, 10, 1, 1)).toHaveLength(0);
    // min=2,max=2: exactly 2026-07-03 — feasible.
    expect(planTours(spaced, "PARIS (intramuros)", cities, "2026-07-01", opts, 10, 2, 2)).toHaveLength(1);
    // min=1,max=3: the window [07-02..07-04] includes 07-03 — feasible.
    const tours = planTours(spaced, "PARIS (intramuros)", cities, "2026-07-01", opts, 10, 1, 3);
    expect(tours).toHaveLength(1);
    expect(tours[0]!.legs[1]!.date).toBe("2026-07-03");
  });
});

describe("planTourInOrder", () => {
  const chain = normalizeRecords([
    { date: "2026-07-01", origine: "PARIS (intramuros)", destination: "LYON (intramuros)", heure_depart: "08:00", heure_arrivee: "10:00", train_no: "10", od_happy_card: "OUI" },
    { date: "2026-07-02", origine: "LYON (intramuros)", destination: "MARSEILLE ST CHARLES", heure_depart: "09:00", heure_arrivee: "10:40", train_no: "11", od_happy_card: "OUI" },
    { date: "2026-07-03", origine: "MARSEILLE ST CHARLES", destination: "NICE VILLE", heure_depart: "09:00", heure_arrivee: "11:30", train_no: "12", od_happy_card: "OUI" },
  ] as RawRecord[]);
  const opts = { maxConnections: 0 };

  it("keeps the given visit order (no reshuffling) and chains every hop", () => {
    const tour = planTourInOrder(
      chain,
      "PARIS (intramuros)",
      ["LYON (intramuros)", "MARSEILLE ST CHARLES", "NICE VILLE"],
      "2026-07-01",
      opts,
      1,
      1,
    );
    expect(tour).not.toBeNull();
    expect(tour!.order).toEqual(["LYON (intramuros)", "MARSEILLE ST CHARLES", "NICE VILLE"]);
    expect(tour!.legs).toHaveLength(3);
    // A bad order (reversed) has no feasible first hop -> null, proving no reordering.
    expect(
      planTourInOrder(chain, "PARIS (intramuros)", ["NICE VILLE", "LYON (intramuros)"], "2026-07-01", opts, 1, 1),
    ).toBeNull();
  });

  it("drops the start and duplicate cities (never loops back)", () => {
    const tour = planTourInOrder(
      chain,
      "PARIS (intramuros)",
      ["LYON (intramuros)", "LYON (intramuros)", "PARIS (intramuros)", "MARSEILLE ST CHARLES"],
      "2026-07-01",
      opts,
      1,
      1,
    );
    expect(tour!.order).toEqual(["LYON (intramuros)", "MARSEILLE ST CHARLES"]);
  });

  it("plans tours larger than the 5-city permutation cap", () => {
    const seq = ["A", "B", "C", "D", "E", "F", "G"];
    const rows = seq.map((to, i) => ({
      date: `2026-07-0${i + 1}`,
      origine: i === 0 ? "START" : seq[i - 1]!,
      destination: to,
      heure_depart: "08:00",
      heure_arrivee: "10:00",
      train_no: String(i),
      od_happy_card: "OUI",
    }));
    const data = normalizeRecords(rows as RawRecord[]);
    expect(planTours(data, "START", seq, "2026-07-01", { maxConnections: 0 }, 10, 1, 1)).toHaveLength(0); // >5: permuter bails
    const tour = planTourInOrder(data, "START", seq, "2026-07-01", { maxConnections: 0 }, 1, 1);
    expect(tour).not.toBeNull();
    expect(tour!.legs).toHaveLength(7);
  });
});

describe("tour with a fixed end (from → nomad → destination)", () => {
  // PARIS -> LYON -> MARSEILLE, and MARSEILLE -> PARIS (so a loop is feasible).
  const data = normalizeRecords([
    { date: "2026-07-01", origine: "PARIS (intramuros)", destination: "LYON (intramuros)", heure_depart: "08:00", heure_arrivee: "10:00", train_no: "10", od_happy_card: "OUI" },
    { date: "2026-07-02", origine: "LYON (intramuros)", destination: "MARSEILLE ST CHARLES", heure_depart: "09:00", heure_arrivee: "10:40", train_no: "11", od_happy_card: "OUI" },
    { date: "2026-07-03", origine: "MARSEILLE ST CHARLES", destination: "PARIS (intramuros)", heure_depart: "09:00", heure_arrivee: "12:10", train_no: "12", od_happy_card: "OUI" },
  ] as RawRecord[]);
  const opts = { maxConnections: 0 };

  it("ends at the chosen destination after the nomad stops", () => {
    const tours = planTours(data, "PARIS (intramuros)", ["LYON (intramuros)"], "2026-07-01", opts, 10, 1, 1, undefined, undefined, undefined, "MARSEILLE ST CHARLES");
    expect(tours).toHaveLength(1);
    expect(tours[0]!.order).toEqual(["LYON (intramuros)", "MARSEILLE ST CHARLES"]);
    expect(tours[0]!.legs).toHaveLength(2);
  });

  it("loops back to the start when end === start", () => {
    const tour = planTourInOrder(data, "PARIS (intramuros)", ["LYON (intramuros)", "MARSEILLE ST CHARLES"], "2026-07-01", opts, 1, 1, undefined, undefined, undefined, "PARIS (intramuros)");
    expect(tour).not.toBeNull();
    expect(tour!.order).toEqual(["LYON (intramuros)", "MARSEILLE ST CHARLES", "PARIS (intramuros)"]);
    expect(tour!.legs[tour!.legs.length - 1]!.destination).toBe("PARIS (intramuros)");
  });

  it("greedy honours a fixed end too", () => {
    const tour = planTourGreedy(data, "PARIS (intramuros)", ["LYON (intramuros)"], "2026-07-01", opts, 1, 1, undefined, undefined, undefined, "MARSEILLE ST CHARLES");
    expect(tour!.order[tour!.order.length - 1]).toBe("MARSEILLE ST CHARLES");
  });

  it("rejects a tour that can't finish by the end date", () => {
    const cities = ["LYON (intramuros)"];
    const end = "MARSEILLE ST CHARLES"; // arrives 2026-07-02
    // Generous end date: feasible.
    expect(planTours(data, "PARIS (intramuros)", cities, "2026-07-01", opts, 10, 1, 1, undefined, undefined, undefined, end, "2026-07-05")).toHaveLength(1);
    // End date before the earliest possible arrival: infeasible.
    expect(planTours(data, "PARIS (intramuros)", cities, "2026-07-01", opts, 10, 1, 1, undefined, undefined, undefined, end, "2026-07-01")).toHaveLength(0);
    expect(planTourInOrder(data, "PARIS (intramuros)", cities, "2026-07-01", opts, 1, 1, undefined, undefined, undefined, end, "2026-07-01")).toBeNull();
  });
});

describe("planTourGreedy", () => {
  const chain = normalizeRecords([
    { date: "2026-07-01", origine: "PARIS (intramuros)", destination: "LYON (intramuros)", heure_depart: "08:00", heure_arrivee: "10:00", train_no: "10", od_happy_card: "OUI" },
    { date: "2026-07-02", origine: "LYON (intramuros)", destination: "MARSEILLE ST CHARLES", heure_depart: "09:00", heure_arrivee: "10:40", train_no: "11", od_happy_card: "OUI" },
    { date: "2026-07-03", origine: "MARSEILLE ST CHARLES", destination: "NICE VILLE", heure_depart: "09:00", heure_arrivee: "11:30", train_no: "12", od_happy_card: "OUI" },
  ] as RawRecord[]);
  const opts = { maxConnections: 0 };

  it("reorders an infeasible typed order into a feasible visiting order", () => {
    // Typed back-to-front: in-order planning fails, greedy finds the real chain.
    const cities = ["NICE VILLE", "MARSEILLE ST CHARLES", "LYON (intramuros)"];
    expect(planTourInOrder(chain, "PARIS (intramuros)", cities, "2026-07-01", opts, 1, 1)).toBeNull();
    const tour = planTourGreedy(chain, "PARIS (intramuros)", cities, "2026-07-01", opts, 1, 1);
    expect(tour).not.toBeNull();
    expect(tour!.order).toEqual(["LYON (intramuros)", "MARSEILLE ST CHARLES", "NICE VILLE"]);
    expect(tour!.legs).toHaveLength(3);
  });

  it("handles more than 5 cities", () => {
    const seq = ["A", "B", "C", "D", "E", "F", "G"];
    const rows = seq.map((to, i) => ({
      date: `2026-07-0${i + 1}`,
      origine: i === 0 ? "START" : seq[i - 1]!,
      destination: to,
      heure_depart: "08:00",
      heure_arrivee: "10:00",
      train_no: String(i),
      od_happy_card: "OUI",
    }));
    const data = normalizeRecords(rows as RawRecord[]);
    const tour = planTourGreedy(data, "START", [...seq].reverse(), "2026-07-01", opts, 1, 1);
    expect(tour).not.toBeNull();
    expect(tour!.order).toEqual(seq);
    expect(tour!.legs).toHaveLength(7);
  });

  it("returns null when a city can never be reached in sequence", () => {
    const tour = planTourGreedy(chain, "PARIS (intramuros)", ["LYON (intramuros)", "BORDEAUX ST JEAN"], "2026-07-01", opts, 1, 1);
    expect(tour).toBeNull();
  });

  it("respects a total-distance (km) budget", () => {
    const cities = ["LYON (intramuros)", "MARSEILLE ST CHARLES", "NICE VILLE"];
    // Distance stub: each successive hop is 200 km (600 km total for 3 hops).
    const dist = (a: string, b: string): number => (a === b ? 0 : 200);
    // Generous budget: full 3-city tour fits.
    expect(planTourGreedy(chain, "PARIS (intramuros)", cities, "2026-07-01", opts, 1, 1, dist, 1000)!.legs).toHaveLength(3);
    // Tight budget (250 km): only the first hop fits, the rest bust the budget.
    expect(planTourGreedy(chain, "PARIS (intramuros)", cities, "2026-07-01", opts, 1, 1, dist, 250)).toBeNull();
    // planTours (<=5, permuting) also drops over-budget tours.
    expect(planTours(chain, "PARIS (intramuros)", cities, "2026-07-01", opts, 10, 1, 1, dist, 250)).toHaveLength(0);
    expect(planTours(chain, "PARIS (intramuros)", cities, "2026-07-01", opts, 10, 1, 1, dist, 1000)).toHaveLength(1);
  });

  it("respects a per-train (per-hop) distance cap", () => {
    const cities = ["LYON (intramuros)", "MARSEILLE ST CHARLES", "NICE VILLE"];
    const dist = (a: string, b: string): number => (a === b ? 0 : 200); // each hop 200 km
    // legCap below 200: every hop is too long -> no tour.
    expect(planTourGreedy(chain, "PARIS (intramuros)", cities, "2026-07-01", opts, 1, 1, dist, undefined, 150)).toBeNull();
    expect(planTours(chain, "PARIS (intramuros)", cities, "2026-07-01", opts, 10, 1, 1, dist, undefined, 150)).toHaveLength(0);
    // legCap of 250: each hop fits (total unconstrained) -> full tour.
    expect(planTourGreedy(chain, "PARIS (intramuros)", cities, "2026-07-01", opts, 1, 1, dist, undefined, 250)!.legs).toHaveLength(3);
    expect(planTours(chain, "PARIS (intramuros)", cities, "2026-07-01", opts, 10, 1, 1, dist, undefined, 250)).toHaveLength(1);
  });

  it("respects a per-train time cap (maxDurationMin on each hop)", () => {
    // Hop durations: Paris→Lyon 120 min, Lyon→Marseille 100 min, Marseille→Nice 150 min.
    const cities = ["LYON (intramuros)", "MARSEILLE ST CHARLES", "NICE VILLE"];
    // Cap at 130 min rules out the 150-min Nice hop, so the tour can't be completed.
    const tight = { maxConnections: 0, maxDurationMin: 130 };
    expect(planTourGreedy(chain, "PARIS (intramuros)", cities, "2026-07-01", tight, 1, 1)).toBeNull();
    expect(planTours(chain, "PARIS (intramuros)", cities, "2026-07-01", tight, 10, 1, 1)).toHaveLength(0);
    // A 200-min cap clears every hop -> the full chain plans.
    const loose = { maxConnections: 0, maxDurationMin: 200 };
    expect(planTourGreedy(chain, "PARIS (intramuros)", cities, "2026-07-01", loose, 1, 1)!.legs).toHaveLength(3);
    expect(planTours(chain, "PARIS (intramuros)", cities, "2026-07-01", loose, 10, 1, 1)).toHaveLength(1);
  });
});

describe("haversineKm", () => {
  it("matches known great-circle distances within ~1%", () => {
    // Paris (Gare de Lyon) -> Lyon (Part-Dieu): ~392 km straight line.
    const d = haversineKm([48.8443, 2.3743], [45.7605, 4.8595]);
    expect(d).toBeGreaterThan(388);
    expect(d).toBeLessThan(396);
    expect(haversineKm([48.8443, 2.3743], [48.8443, 2.3743])).toBe(0);
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
