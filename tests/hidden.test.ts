import { describe, it, expect } from "vitest";
import type { RawRecord } from "../src/types";
import { normalizeRecords } from "../src/data/dataset";
import { findHiddenTrains } from "../src/core/hidden";

const D = "2026-06-25";

function rec(p: Partial<RawRecord>): RawRecord {
  return {
    date: D,
    origine: "PARIS (intramuros)",
    destination: "FRASNE",
    heure_depart: "06:00",
    heure_arrivee: "09:00",
    train_no: "9765",
    od_happy_card: "OUI",
    axe: "SUD EST",
    ...p,
  };
}

describe("findHiddenTrains", () => {
  it("surfaces a stop reachable only by riding past it (Paris→Frasne calls at Dijon)", () => {
    // Paris→Frasne is bookable; Paris→Dijon is not sold at all. The same train
    // 9765 also runs Dijon→Frasne (proof it calls at Dijon, and when it leaves).
    const trains = normalizeRecords([
      rec({}), // PARIS → FRASNE 9765, dep 06:00, arr 09:00
      rec({ origine: "DIJON VILLE", heure_depart: "07:40" }), // DIJON → FRASNE 9765, arr 09:00
    ]);
    const hidden = findHiddenTrains(trains, "PARIS (intramuros)", "DIJON VILLE", D);
    expect(hidden).toHaveLength(1);
    const h = hidden[0]!;
    expect(h.origin).toBe("PARIS (intramuros)");
    expect(h.destination).toBe("DIJON VILLE");
    expect(h.beyond).toBe("FRASNE");
    expect(h.book.trainNo).toBe("9765");
    expect(h.alight).toBe("07:40"); // the train departs Dijon at 07:40 → when you get off
    expect(h.durationMin).toBe(100); // 06:00 → 07:40
  });

  it("keeps the départ the same — never lets you board before your origin", () => {
    // A Lyon→Frasne train that calls at Dijon is NOT a hidden Paris→Dijon option:
    // your ticket can't start you in Lyon and put you on at Paris.
    const trains = normalizeRecords([
      rec({ origine: "LYON (intramuros)", heure_depart: "06:00" }),
      rec({ origine: "DIJON VILLE", heure_depart: "07:40" }),
    ]);
    expect(findHiddenTrains(trains, "PARIS (intramuros)", "DIJON VILLE", D)).toHaveLength(0);
  });

  it("ignores a train when the exact route is itself bookable (not hidden, just book it)", () => {
    const trains = normalizeRecords([
      rec({}),
      rec({ destination: "DIJON VILLE", heure_arrivee: "07:40" }), // PARIS → DIJON 9765 OUI
      rec({ origine: "DIJON VILLE", heure_depart: "07:40" }),
    ]);
    expect(findHiddenTrains(trains, "PARIS (intramuros)", "DIJON VILLE", D)).toHaveLength(0);
  });

  it("rejects a train-number collision (same number, different physical train)", () => {
    // A DIJON→FRASNE 9765 that arrives at a different time than the PARIS→FRASNE
    // 9765 can't be the same train — the arrival at the shared terminus differs.
    const trains = normalizeRecords([
      rec({}), // arrives FRASNE 09:00
      rec({ origine: "DIJON VILLE", heure_depart: "07:40", heure_arrivee: "10:30" }), // arrives 10:30
    ]);
    expect(findHiddenTrains(trains, "PARIS (intramuros)", "DIJON VILLE", D)).toHaveLength(0);
  });

  it("requires the destination to be downstream (train leaves it after the origin)", () => {
    // A tail that departs Dijon *before* the train left Paris can't be the onward leg.
    const trains = normalizeRecords([
      rec({ heure_depart: "08:00" }), // PARIS → FRASNE leaves 08:00
      rec({ origine: "DIJON VILLE", heure_depart: "07:40" }), // leaves Dijon 07:40 — impossible
    ]);
    expect(findHiddenTrains(trains, "PARIS (intramuros)", "DIJON VILLE", D)).toHaveLength(0);
  });

  it("keeps the nearest overshoot when a train sells several stops past yours", () => {
    // Train calls Paris, Dijon, Dole, Frasne. Both Paris→Dole and Paris→Frasne are
    // bookable; the hidden option to Dijon should ticket to Dole (the nearest stop
    // past Dijon), not all the way to Frasne.
    const trains = normalizeRecords([
      rec({ destination: "DOLE VILLE", heure_arrivee: "08:20" }), // PARIS → DOLE 9765
      rec({ destination: "FRASNE", heure_arrivee: "09:00" }), // PARIS → FRASNE 9765
      rec({ origine: "DIJON VILLE", destination: "DOLE VILLE", heure_depart: "07:40", heure_arrivee: "08:20" }),
      rec({ origine: "DIJON VILLE", destination: "FRASNE", heure_depart: "07:40", heure_arrivee: "09:00" }),
    ]);
    const hidden = findHiddenTrains(trains, "PARIS (intramuros)", "DIJON VILLE", D);
    expect(hidden).toHaveLength(1);
    expect(hidden[0]!.beyond).toBe("DOLE VILLE");
    expect(hidden[0]!.alight).toBe("07:40");
  });

  it("honours the depart-time window and train-type filters on the booked leg", () => {
    const trains = normalizeRecords([
      rec({ heure_depart: "06:00" }),
      rec({ origine: "DIJON VILLE", heure_depart: "07:40" }),
    ]);
    // Depart window that excludes the 06:00 train → nothing.
    expect(
      findHiddenTrains(trains, "PARIS (intramuros)", "DIJON VILLE", D, { departAfter: "07:00" }),
    ).toHaveLength(0);
    // Wrong train type → nothing.
    expect(
      findHiddenTrains(trains, "PARIS (intramuros)", "DIJON VILLE", D, { trainType: "ATLANTIQUE" }),
    ).toHaveLength(0);
  });
});
