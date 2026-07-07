import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Leaflet needs a real browser canvas; stub the map module so the rest of the
// UI can be exercised under jsdom.
vi.mock("../src/ui/map", () => ({
  RouteMap: class {
    onSelect: ((id: string) => void) | null = null;
    show(): void {}
    route(): void {}
    radius(): void {}
    base(): void {}
    invalidate(): void {}
    focus(): void {}
    setInfo(): void {}
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

  it("flags an overnight train's next-day arrival (+Nd), not a same-morning arrival", () => {
    // Sample train 6190: Paris → Toulon 23:00 → 00:50 the NEXT day.
    const root = setup(`?mode=od&from=${encodeURIComponent("PARIS (intramuros)")}&to=TOULON&date=2026-06-25`);
    expect(root.textContent ?? "").toContain("00:50");
    expect(root.querySelector(".day-offset")).not.toBeNull(); // the "+1 d" marker
  });

  it("survives corrupt / wrong-typed localStorage without crashing at startup", () => {
    localStorage.clear();
    // Valid JSON but the wrong shape — would crash .some()/.findIndex()/.theme without
    // a shape guard (the try/catch only catches parse errors, not type mismatches).
    localStorage.setItem("mj.watched", "42");
    localStorage.setItem("mj.favorites", JSON.stringify({ foo: 1 }));
    localStorage.setItem("mj.trips", '"nope"');
    localStorage.setItem("mj.settings", "null");
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById("app") as HTMLElement;
    history.replaceState(null, "", "/");
    const trains = normalizeRecords(sample as RawRecord[]);
    const registry = new StationRegistry(stations as Station[]);
    expect(() => initApp(root, { trains, meta }, registry)).not.toThrow();
    expect(root.querySelector(".search-form")).not.toBeNull();
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

  it("does not auto-run the search on a page reload; Search runs the restored query", () => {
    // Simulate a browser reload: the Navigation Timing entry reports type "reload".
    const original = performance.getEntriesByType.bind(performance);
    const spy = vi
      .spyOn(performance, "getEntriesByType")
      .mockImplementation((type: string) =>
        type === "navigation" ? ([{ type: "reload" }] as unknown as PerformanceEntryList) : original(type),
      );
    try {
      const root = setup(`?mode=from&from=${encodeURIComponent("PARIS (intramuros)")}&date=2026-06-25&conn=0`);
      // Reload restores the form but holds back the results — no destination cards yet.
      expect(root.querySelectorAll(".group-card").length).toBe(0);
      expect(root.querySelector(".empty")).not.toBeNull();
      expect(root.textContent ?? "").not.toContain("Lyon");
      // The origin is still restored from the URL, so pressing Search runs it as-is.
      const searchBtn = root.querySelector(".search-form button[type=submit]") as HTMLElement;
      searchBtn.click();
      expect(root.querySelectorAll(".group-card").length).toBeGreaterThan(0);
      expect(root.textContent ?? "").toContain("Lyon");
    } finally {
      spy.mockRestore();
    }
  });

  it("still auto-renders a fresh deep-link (not a reload)", () => {
    // A fresh navigation (Navigation Timing type "navigate", the jsdom default) must
    // still show results immediately, so shared/deep links keep working.
    const root = setup(`?mode=from&from=${encodeURIComponent("PARIS (intramuros)")}&date=2026-06-25&conn=0`);
    expect(root.querySelectorAll(".group-card").length).toBeGreaterThan(0);
    expect(root.textContent ?? "").toContain("Lyon");
  });

  it("stages a field change without auto-running the search until Search is clicked", () => {
    const root = setup(`?mode=from&from=${encodeURIComponent("PARIS (intramuros)")}&date=2026-06-25&conn=0`);
    // conn=0 → only direct destinations; Toulouse (reachable via Bordeaux) is absent.
    expect(root.textContent ?? "").not.toContain("Toulouse");

    // Allow one change, then commit the field. Only maxConnections offers a "6" option,
    // so it's uniquely identifiable among the form selects.
    const conn = Array.from(root.querySelectorAll<HTMLSelectElement>(".search-form select.input")).find((s) =>
      Array.from(s.options).some((o) => o.value === "6"),
    );
    expect(conn).toBeTruthy();
    conn!.value = "1";
    conn!.dispatchEvent(new Event("change", { bubbles: true }));
    // The results must NOT recompute on a field change — still the direct-only list.
    expect(root.textContent ?? "").not.toContain("Toulouse");

    // Running the search (the submit button) applies the staged change.
    const searchBtn = root.querySelector(".search-form button[type=submit]") as HTMLElement;
    expect(searchBtn).not.toBeNull();
    searchBtn.click();
    expect(root.textContent ?? "").toContain("Toulouse");
  });

  it("keeps a staged filter when the results refresh in place (sort change)", () => {
    // Regression: an in-place refresh (sort/calendar/day-shift) used to re-sync the
    // whole form from the last-searched query, silently discarding a staged, not-yet-
    // searched edit — the "my filter disappeared" bug.
    const root = setup(`?mode=from&from=${encodeURIComponent("PARIS (intramuros)")}&date=2026-06-25&nonight=1`);
    const nightBox = () => {
      const label = Array.from(root.querySelectorAll("label.field-check")).find((l) =>
        (l.textContent ?? "").trim().startsWith("Night trains"),
      );
      return label?.querySelector<HTMLInputElement>("input[type=checkbox]") ?? null;
    };
    // Stage: tick "Night trains" (do NOT run the search).
    const night = nightBox();
    expect(night).not.toBeNull();
    expect(night!.checked).toBe(false);
    night!.checked = true;
    night!.dispatchEvent(new Event("change", { bubbles: true }));

    // Change the sort — an in-place refresh. The sort <select> is the one with a
    // "Fastest"/"Closest" option (the search form's selects never carry those).
    const sort = Array.from(root.querySelectorAll<HTMLSelectElement>("select")).find((s) =>
      Array.from(s.options).some((o) => /Fastest|Closest/i.test(o.textContent ?? "")),
    );
    expect(sort).toBeTruthy();
    sort!.selectedIndex = Math.min(1, sort!.options.length - 1);
    sort!.dispatchEvent(new Event("change", { bubbles: true }));

    // The staged filter must still be ticked — not reset by the refresh.
    expect(nightBox()!.checked).toBe(true);
  });

  it("Surprise me does not resurrect a tour finish the user just removed", () => {
    // Regression: exact-trip destination carries into Tour as the "finish"; removing
    // it is a staged edit. "Surprise me" used to rebuild from the stale last-searched
    // query and push the removed city right back into the form and URL.
    const root = setup(
      `?mode=od&from=${encodeURIComponent("PARIS (intramuros)")}&to=${encodeURIComponent("LYON (intramuros)")}&date=2026-06-25`,
    );
    // Switch to Tour — Lyon becomes the tour finish (destination) field.
    const tourTab = Array.from(root.querySelectorAll(".mode-tab")).find((t) => /Tour/i.test(t.textContent ?? ""));
    expect(tourTab).toBeTruthy();
    (tourTab as HTMLElement).click();
    const dest = Array.from(root.querySelectorAll<HTMLInputElement>(".search-form input")).find((i) =>
      /Lyon/i.test(i.value),
    );
    expect(dest).toBeTruthy();
    // Remove it (staged), then hit "Surprise me".
    dest!.value = "";
    dest!.dispatchEvent(new Event("change", { bubbles: true }));
    const surprise = root.querySelector(".surprise-btn") as HTMLElement;
    expect(surprise).not.toBeNull();
    surprise.click();
    // The removed finish must stay gone — not in the field, not in the URL.
    expect(dest!.value).toBe("");
    expect(new URLSearchParams(location.search).get("to")).toBeNull();
  });
});
