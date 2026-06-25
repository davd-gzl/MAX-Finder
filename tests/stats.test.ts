import { describe, it, expect } from "vitest";
import type { MaxTrain } from "../src/types";
import { topDestinations, topOrigins, topRoutes } from "../src/core/stats";

function train(origin: string, destination: string, available: boolean, date = "2026-06-25"): MaxTrain {
  return {
    date,
    origin,
    destination,
    depart: "10:00",
    arrive: "12:00",
    departMin: 600,
    arriveMin: 720,
    durationMin: 120,
    trainNo: "1",
    available,
  };
}

const TRAINS: MaxTrain[] = [
  train("PARIS (intramuros)", "LYON (intramuros)", true),
  train("PARIS (intramuros)", "LYON (intramuros)", true),
  train("PARIS (intramuros)", "MARSEILLE ST CHARLES", true),
  train("LYON (intramuros)", "MARSEILLE ST CHARLES", true),
  train("PARIS (intramuros)", "LYON (intramuros)", false), // not reservable -> ignored
  train("PARIS (intramuros)", "LYON (intramuros)", true, "2026-06-26"), // other date -> ignored
];

describe("stats", () => {
  it("ranks destinations by reservable MAX trains on the date", () => {
    const top = topDestinations(TRAINS, "2026-06-25");
    expect(top[0]).toEqual({ station: "LYON (intramuros)", count: 2 });
    expect(top.find((d) => d.station === "MARSEILLE ST CHARLES")?.count).toBe(2);
  });

  it("ranks departure stations", () => {
    const top = topOrigins(TRAINS, "2026-06-25");
    expect(top[0]).toEqual({ station: "PARIS (intramuros)", count: 3 });
  });

  it("ranks routes and keeps multi-word station ids intact", () => {
    const top = topRoutes(TRAINS, "2026-06-25");
    expect(top[0]).toEqual({
      origin: "PARIS (intramuros)",
      destination: "LYON (intramuros)",
      count: 2,
    });
  });
});
