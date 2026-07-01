import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Leaflet needs a real browser canvas; stub the map module so the rest of the
// UI can be exercised under jsdom.
vi.mock("../src/ui/map", () => ({
  RouteMap: class {
    onSelect: ((id: string) => void) | null = null;
    show(): void {}
    route(): void {}
    invalidate(): void {}
    focus(): void {}
  },
}));

import type { RawRecord, Station, DataMeta } from "../src/types";
import { normalizeRecords } from "../src/data/dataset";
import { StationRegistry } from "../src/data/stations";
import { initApp } from "../src/app";
import sample from "../data/tgvmax.sample.json";
import stations from "../data/stations.json";

const meta: DataMeta = {
  updatedAt: "",
  source: "sample",
  recordCount: 0,
  isSample: true,
};

function setup(search: string): HTMLElement {
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById("app") as HTMLElement;
  history.replaceState(null, "", `/${search}`);
  const trains = normalizeRecords(sample as RawRecord[]);
  const registry = new StationRegistry(stations as Station[]);
  initApp(root, { trains, meta }, registry);
  return root;
}

beforeEach(() => {
  // Pin the clock to the sample-data epoch so "today" sits at the start of the
  // bookable window: the deep-linked dates (2026-06-25..27) are then in range and
  // the app's date clamp leaves them alone — independent of the real machine clock.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-25T12:00:00Z"));
  // Run rAF synchronously so deferred search rendering completes within the test.
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  }) as typeof requestAnimationFrame;
  // jsdom doesn't implement scrollIntoView; stub it for click-driven navigation.
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
});

afterEach(() => {
  vi.useRealTimers();
});

describe("app (jsdom smoke)", () => {
  it("renders direct destinations for a 'from' deep-link (no changes)", () => {
    const root = setup(`?mode=from&from=${encodeURIComponent("PARIS (intramuros)")}&date=2026-06-25&conn=0`);
    const text = root.textContent ?? "";
    expect(text).toContain("Lyon");
    expect(text).toContain("Marseille");
    expect(root.querySelectorAll(".group-card").length).toBeGreaterThan(0);
    // Toulouse is reachable only via a change -> excluded when no changes are allowed.
    expect(text).not.toContain("Toulouse Matabiau");
  });

  it("surfaces connection-only destinations when changes are allowed", () => {
    const root = setup(`?mode=from&from=${encodeURIComponent("PARIS (intramuros)")}&date=2026-06-25&conn=1`);
    const text = root.textContent ?? "";
    // Toulouse is reachable from Paris via Bordeaux that day.
    expect(text).toContain("Toulouse");
  });

  it("shows a connecting journey + calendar for an exact-trip deep-link", () => {
    const root = setup(
      `?mode=od&from=${encodeURIComponent("PARIS (intramuros)")}&to=${encodeURIComponent("TOULOUSE MATABIAU")}&date=2026-06-25`,
    );
    const text = root.textContent ?? "";
    expect(text).toContain("Toulouse");
    // Only reachable via a connection (Bordeaux) that day.
    expect(root.querySelector(".chip-via")).not.toBeNull();
    expect(text).toContain("Bordeaux");
    // The 30-day route availability calendar is rendered (first .cal-grid; the
    // "come back?" section adds a second, return-availability calendar below it).
    const routeCal = root.querySelector(".cal-grid");
    expect(routeCal).not.toBeNull();
    expect(routeCal!.querySelectorAll(".cal-cell").length).toBe(30);
    // The return calendar exists too (a second grid).
    expect(root.querySelectorAll(".cal-grid").length).toBeGreaterThanOrEqual(2);
  });

  it("drills into a connecting destination and back again", () => {
    const root = setup(`?mode=from&from=${encodeURIComponent("PARIS (intramuros)")}&date=2026-06-25&conn=1`);
    const cards = Array.from(root.querySelectorAll(".group-card"));
    const toulouse = cards.find((c) => (c.textContent ?? "").includes("Toulouse"));
    expect(toulouse).toBeTruthy();
    // The connecting row carries a "via" chip and a favourite star.
    expect(toulouse!.querySelector(".chip-via")).not.toBeNull();
    expect(toulouse!.querySelector(".star")).not.toBeNull();

    (toulouse!.querySelector(".dest-main") as HTMLElement).click();
    // Now on the exact-trip page, with a Back button.
    const back = root.querySelector(".back-btn") as HTMLElement | null;
    expect(back).not.toBeNull();
    expect(root.querySelector(".chip-via")).not.toBeNull(); // via Bordeaux journey

    back!.click();
    // Back to the browse list; no Back button left.
    expect(root.querySelector(".back-btn")).toBeNull();
    expect(root.textContent ?? "").toContain("Toulouse");
  });

  it("shows the specific Paris gare on a journey (from the train's axe)", () => {
    const root = setup(
      `?mode=od&from=${encodeURIComponent("PARIS (intramuros)")}&to=${encodeURIComponent("LYON (intramuros)")}&date=2026-06-25`,
    );
    const legRoute = root.querySelector(".leg-route")?.textContent ?? "";
    // The Paris→Lyon trains are on the SUD EST axe → Paris Gare de Lyon (the one gare
    // the data can pin down). Lyon's gare isn't derivable, so it stays plain "Lyon".
    expect(legRoute).toContain("Paris Gare de Lyon");
    expect(legRoute).not.toContain("Part-Dieu");
  });

  it("builds the search form with all modes", () => {
    const root = setup("");
    expect(root.querySelectorAll(".mode-tab").length).toBeGreaterThanOrEqual(4);
    expect(root.querySelector(".search-form")).not.toBeNull();
  });
});
