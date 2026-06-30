import { describe, it, expect } from "vitest";
import type { Station } from "../src/types";
import { StationRegistry, normalizeText, prettyLabel, isAirportStation } from "../src/data/stations";
import stationData from "../data/stations.json";

const registry = new StationRegistry(stationData as Station[]);

describe("normalizeText", () => {
  it("strips accents and lowercases", () => {
    expect(normalizeText("Nîmes")).toBe("nimes");
    expect(normalizeText("  Besançon  ")).toBe("besancon");
  });
});

describe("prettyLabel", () => {
  it("makes a readable label from a raw station id", () => {
    expect(prettyLabel("PARIS (intramuros)")).toBe("Paris");
    expect(prettyLabel("MARSEILLE ST CHARLES")).toBe("Marseille St Charles");
  });
});

describe("isAirportStation", () => {
  it("flags the TGV airport stations", () => {
    expect(isAirportStation("AEROPORT CDG2 TGV")).toBe(true);
    expect(isAirportStation("AEROPORT CHARLES DE GAULLE 2 TGV")).toBe(true);
    expect(isAirportStation("LYON ST EXUPERY TGV")).toBe(true);
    expect(isAirportStation("ROISSY")).toBe(true);
  });
  it("does not flag ordinary city / suburb stations", () => {
    expect(isAirportStation("PARIS (intramuros)")).toBe(false);
    expect(isAirportStation("LYON (intramuros)")).toBe(false);
    expect(isAirportStation("MASSY TGV")).toBe(false);
    expect(isAirportStation("MARNE LA VALLEE CHESSY")).toBe(false);
  });
});

describe("StationRegistry.search", () => {
  it("matches by prefix", () => {
    const ids = registry.search("lyon").map((s) => s.id);
    expect(ids).toContain("LYON (intramuros)");
  });

  it("is accent-insensitive", () => {
    const ids = registry.search("nimes").map((s) => s.id);
    expect(ids).toContain("NIMES");
  });

  it("matches aliases", () => {
    const ids = registry.search("disneyland").map((s) => s.id);
    expect(ids).toContain("MARNE LA VALLEE CHESSY");
  });

  it("respects the result limit", () => {
    expect(registry.search("a", 3).length).toBeLessThanOrEqual(3);
  });
});

describe("StationRegistry.addMissing", () => {
  it("makes dataset-only stations searchable, with a pretty label", () => {
    const r = new StationRegistry(stationData as Station[]);
    expect(r.search("arras")).toHaveLength(0); // not searchable until present in the dataset
    r.addMissing(["ARRAS", "PARIS (intramuros)", "LILLE FLANDRES", "ZZ MADE UP GARE"]);
    expect(r.get("ARRAS")).toBeDefined();
    expect(r.label("ARRAS")).toBe("Arras");
    expect(r.search("arras").map((s) => s.id)).toContain("ARRAS");
    // A station with no matching city reference stays unplotted.
    expect(r.coords("ZZ MADE UP GARE")).toBeUndefined();
    // Stations matching a city reference inherit its coordinates (city-name
    // variants too), so the list and the map stay in sync.
    expect(r.coords("ARRAS")).toEqual([50.291, 2.781]);
    expect(r.coords("LILLE FLANDRES")).toEqual([50.6376, 3.0753]);
    expect(r.city("ARRAS")).toBe("Arras");
  });

  it("resolves a city for guide links, stripping station qualifiers", () => {
    const r = new StationRegistry(stationData as Station[]);
    r.addMissing(["BRUXELLES MIDI", "TGV HAUTE PICARDIE"]);
    expect(r.city("BRUXELLES MIDI")).toBe("Bruxelles"); // via city reference
    expect(r.city("TGV HAUTE PICARDIE")).toBe("Haute-Picardie");
  });

  it("dedupes label collisions, preferring the id present in the dataset", () => {
    const r = new StationRegistry(stationData as Station[]);
    // The curated registry has id "LILLE"; a dataset variant renders the same.
    r.addMissing(["LILLE (intramuros)"]);
    const lilles = r.list().filter((s) => s.label === "Lille");
    expect(lilles).toHaveLength(1);
    expect(lilles[0]!.id).toBe("LILLE (intramuros)"); // the bookable one wins
  });
});

describe("non-bookable stations are hidden", () => {
  it("never surface in search or list, even once present in the dataset", () => {
    const r = new StationRegistry(stationData as Station[]);
    r.addMissing(["BRUXELLES MIDI", "GENEVE", "PARIS (intramuros)"]);
    // International stops the MAX pass can't book: registered (so labels/city
    // links still resolve) but filtered out of every user-facing list.
    expect(r.search("bruxelles")).toHaveLength(0);
    expect(r.search("geneve")).toHaveLength(0);
    expect(r.list().some((s) => s.id === "BRUXELLES MIDI")).toBe(false);
    expect(r.list().some((s) => s.id === "GENEVE")).toBe(false);
    // Bookable stations are unaffected.
    expect(r.search("paris").map((s) => s.id)).toContain("PARIS (intramuros)");
  });
});

describe("StationRegistry lookups", () => {
  it("returns coordinates and labels", () => {
    expect(registry.coords("PARIS (intramuros)")).toEqual([48.8566, 2.3522]);
    expect(registry.label("LYON (intramuros)")).toBe("Lyon");
  });

  it("falls back to a pretty label for unknown ids", () => {
    expect(registry.label("SOME UNKNOWN GARE")).toBe("Some Unknown Gare");
  });
});
