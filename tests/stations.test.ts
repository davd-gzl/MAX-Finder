import { describe, it, expect } from "vitest";
import type { Station } from "../src/types";
import { StationRegistry, normalizeText, prettyLabel } from "../src/data/stations";
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
  it("makes dataset-only stations searchable, with a pretty label and no coords", () => {
    const r = new StationRegistry(stationData as Station[]);
    expect(r.search("arras")).toHaveLength(0); // not in the curated set
    r.addMissing(["ARRAS", "PARIS (intramuros)"]);
    expect(r.get("ARRAS")).toBeDefined();
    expect(r.label("ARRAS")).toBe("Arras");
    expect(r.coords("ARRAS")).toBeUndefined(); // no coordinates -> not plotted on the map
    expect(r.search("arras").map((s) => s.id)).toContain("ARRAS");
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
