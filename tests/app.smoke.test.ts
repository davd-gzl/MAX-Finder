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
    highlight(): void {}
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
    // The 30-day route availability calendar is rendered.
    const routeCal = root.querySelector(".cal-grid");
    expect(routeCal).not.toBeNull();
    expect(routeCal!.querySelectorAll(".cal-cell").length).toBe(30);
    // A one-way exact-trip shows no "come back?" section — only the round trip does.
    expect(root.querySelector(".od-return")).toBeNull();
    expect(root.querySelectorAll(".cal-grid").length).toBe(1);
  });

  it("adds a return-availability calendar for a round-trip exact-trip deep-link", () => {
    const root = setup(
      `?mode=od&from=${encodeURIComponent("PARIS (intramuros)")}&to=${encodeURIComponent("TOULOUSE MATABIAU")}&date=2026-06-25&rdate=2026-06-27`,
    );
    // The "come back?" section adds a second, return-availability calendar.
    const retSection = root.querySelector(".od-return");
    expect(retSection).not.toBeNull();
    expect(retSection!.querySelector(".cal-grid")).not.toBeNull();
    expect(root.querySelectorAll(".cal-grid").length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the Return tab when the destination is cleared", () => {
    // Regression: the return date was gated on mode === "od", but a blank destination
    // derives mode "from" — so a Return-tab search dropped rdate from the URL and a
    // reload silently fell back to the Simple tab, losing the picked return.
    const root = setup(
      `?mode=od&from=${encodeURIComponent("PARIS (intramuros)")}&to=${encodeURIComponent("TOULOUSE MATABIAU")}&date=2026-06-25&rdate=2026-06-27`,
    );
    expect(root.querySelector(".mode-tab.active")?.getAttribute("data-trip")).toBe("return");
    const dest = root.querySelectorAll<HTMLInputElement>('.search-form .fields input[list="station-list"]')[1];
    expect(dest).toBeTruthy();
    dest!.value = "";
    dest!.dispatchEvent(new Event("input", { bubbles: true }));
    dest!.dispatchEvent(new Event("change", { bubbles: true }));
    (root.querySelector(".search-form button[type=submit]") as HTMLElement).click();

    const url = location.search;
    expect(new URLSearchParams(url).get("rdate")).toBe("2026-06-27");
    // What the URL actually restores: reloading it must land back on the Return tab.
    const reloaded = setup(url);
    expect(reloaded.querySelector(".mode-tab.active")?.getAttribute("data-trip")).toBe("return");
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
      // Booleans render as a toggle switch; the checkbox behind it is still the
      // value, so the staged-edit assertions below read it directly.
      const wrap = Array.from(root.querySelectorAll(".field-switch")).find((l) =>
        (l.textContent ?? "").trim().startsWith("Night trains"),
      );
      return wrap?.querySelector<HTMLInputElement>("input[type=checkbox]") ?? null;
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

  it("Multi-city builds explicit leg rows and can add another leg", () => {
    const root = setup("");
    const multiTab = root.querySelector('[data-trip="multi"]');
    expect(multiTab).toBeTruthy();
    (multiTab as HTMLElement).click();
    // Starts with two leg rows; "Add another leg" appends a third.
    expect(root.querySelectorAll(".mc-leg").length).toBe(2);
    (root.querySelector(".mc-add") as HTMLElement).click();
    expect(root.querySelectorAll(".mc-leg").length).toBe(3);
  });

  it("renders a multi-city deep-link as one result section per leg", () => {
    const root = setup(
      `?mode=tour&legs=${encodeURIComponent(
        "PARIS (intramuros)>LYON (intramuros)@2026-06-25~LYON (intramuros)>TOULON@2026-06-27",
      )}`,
    );
    expect(root.querySelectorAll(".mc-result").length).toBe(2);
  });

  it("ignores a malformed leg date in a deep-link instead of crashing the render", () => {
    // Regression: `formatDate(new Date("garbageT00:00:00"))` threw RangeError, blanking
    // the results. The bad-date leg is now dropped; the valid one still renders.
    const root = setup(
      `?mode=tour&legs=${encodeURIComponent(
        "PARIS (intramuros)>LYON (intramuros)@garbage~LYON (intramuros)>TOULON@2026-06-27",
      )}`,
    );
    expect(root.querySelectorAll(".mc-result").length).toBe(1);
  });

  it("Multi-city defaults to custom legs and toggles to the tour planner", () => {
    const root = setup("");
    (root.querySelector('[data-trip="multi"]') as HTMLElement).click();
    // The sub-mode toggle offers both surfaces, custom legs leading.
    const subTabs = Array.from(root.querySelectorAll<HTMLElement>(".multi-switch .multi-tab"));
    expect(subTabs.length).toBe(2);
    expect(subTabs[0]!.getAttribute("aria-pressed")).toBe("true");
    const citiesField = root.querySelector(".cities-wrap")?.closest(".field") as HTMLElement;
    const legsBlock = root.querySelector(".mc-block") as HTMLElement;
    // Legs is the default: the hop editor is shown, the cities chip input hidden.
    expect(legsBlock.style.display).not.toBe("none");
    expect(citiesField.style.display).toBe("none");
    // Switch to the planner: the cities input appears and the editor is hidden.
    subTabs[1]!.click();
    expect(citiesField.style.display).not.toBe("none");
    expect(legsBlock.style.display).toBe("none");
  });

  it("renders a legacy cities tour link as a planned tour (not the legs editor)", () => {
    // The exact deep-link shape shared before v2. Regression: it silently fell through
    // to the empty multi-city state because the planner had become unreachable.
    const root = setup(
      `?mode=tour&from=${encodeURIComponent("PARIS (intramuros)")}&cities=${encodeURIComponent(
        "LYON (intramuros)",
      )}&date=2026-06-25&dmin=1&dmax=3`,
    );
    expect(root.querySelector(".tour")).not.toBeNull();
    expect(root.querySelector(".mc-result")).toBeNull();
    // The Multi tab is restored on its "plan" sub-mode — the SECOND button in the
    // switch, since custom legs now lead it.
    const planTab = root.querySelectorAll<HTMLElement>(".multi-switch .multi-tab")[1];
    expect(planTab?.getAttribute("aria-pressed")).toBe("true");
  });

  it("opens the date picker to keyboard focus and navigates the grid with arrows", () => {
    const root = setup("");
    const trigger = root.querySelector<HTMLElement>(".dp-trigger");
    expect(trigger).not.toBeNull();
    trigger!.click();
    const pop = document.body.querySelector<HTMLElement>(".datepop:not([hidden])");
    expect(pop).not.toBeNull();
    // The dialog is named + modal, and focus has moved onto a day cell inside it.
    expect(pop!.getAttribute("aria-modal")).toBe("true");
    expect(pop!.getAttribute("aria-label")).toBeTruthy();
    const active = document.activeElement as HTMLElement;
    expect(active.classList.contains("dp-cell")).toBe(true);
    // ArrowRight moves focus to the next day cell.
    const cells = Array.from(pop!.querySelectorAll<HTMLElement>("button.dp-cell"));
    const start = cells.indexOf(active);
    pop!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(cells.indexOf(document.activeElement as HTMLElement)).toBe(start + 1);
    // Escape closes the popover and restores focus to the trigger.
    pop!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.body.querySelector(".datepop:not([hidden])")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("does not leak date-picker popovers when the language changes", () => {
    const root = setup("");
    const count = () => document.body.querySelectorAll(".datepop").length;
    const before = count();
    expect(before).toBeGreaterThan(0); // the departure picker's popover is in <body>
    // Changing the language rebuilds the whole shell + form. Old popovers must be
    // torn down, not orphaned in <body> with their live document/window listeners.
    const langSel = root.querySelector<HTMLSelectElement>(".site-header select.ctl");
    expect(langSel).not.toBeNull();
    langSel!.value = "en";
    langSel!.dispatchEvent(new Event("change", { bubbles: true }));
    langSel!.value = "fr";
    langSel!.dispatchEvent(new Event("change", { bubbles: true }));
    // Two rebuilds later, the popover count is stable (not 3×) — no accumulation.
    expect(count()).toBe(before);
  });

  it("Surprise me does not resurrect a tour finish the user just cleared", () => {
    // Regression (the guard deleted in v2): a destination left in a hidden field used
    // to leak back into the tour as its finish. readQueryFromForm now reads only the
    // active surface's fields, so a cleared finish stays cleared through Surprise me.
    const root = setup(
      `?mode=tour&from=${encodeURIComponent("PARIS (intramuros)")}&to=${encodeURIComponent(
        "LYON (intramuros)",
      )}&date=2026-06-25`,
    );
    // The plan surface is active with Lyon as the fixed finish (serialized as to=).
    expect(new URLSearchParams(location.search).get("to")).toBeTruthy();
    // Clear the finish (the 2nd clearable field on the plan surface: origin, then finish).
    const dest = root.querySelectorAll<HTMLInputElement>(".fields input.has-clear")[1];
    expect(dest).toBeTruthy();
    dest!.value = "";
    dest!.dispatchEvent(new Event("input", { bubbles: true }));
    dest!.dispatchEvent(new Event("change", { bubbles: true }));
    // Surprise me (adds a random city). The cleared finish must NOT come back.
    (root.querySelector(".surprise-btn") as HTMLElement).click();
    expect(new URLSearchParams(location.search).get("to")).toBeNull();
  });

  it("hosts round-trip getaways on the Return tab's duration surface, not on Simple", () => {
    const root = setup("");
    // Simple is a one-way search now — the round-trip group is built but not shown.
    expect((root.querySelector(".daytrip-group") as HTMLElement).style.display).toBe("none");
    (root.querySelector('[data-trip="return"]') as HTMLElement).click();
    const subTabs = Array.from(root.querySelectorAll<HTMLElement>(".return-switch .multi-tab"));
    expect(subTabs.length).toBe(2);
    // "By duration" reveals the stay options and drops the now-redundant checkbox
    // (the sub-mode itself is the opt-in).
    subTabs[1]!.click();
    expect((root.querySelector(".daytrip-group") as HTMLElement).style.display).not.toBe("none");
    expect((root.querySelector(".daytrip-toggle") as HTMLElement).style.display).toBe("none");
  });

  it("drives a boolean field through its toggle switch", () => {
    const root = setup("");
    const wrap = Array.from(root.querySelectorAll(".field-switch")).find((f) =>
      (f.textContent ?? "").trim().startsWith("Night trains"),
    ) as HTMLElement;
    expect(wrap).toBeTruthy();
    const box = wrap.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    const toggle = wrap.querySelector<HTMLElement>(".switch")!;
    // The default search excludes night trains, so the switch starts off.
    expect(box.checked).toBe(false);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.classList.contains("is-on")).toBe(false);
    // Toggling on flips the value and fires change — which is what un-greys the
    // nested "only night trains" sub-field.
    toggle.click();
    expect(box.checked).toBe(true);
    expect(toggle.classList.contains("is-on")).toBe(true);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(root.querySelector<HTMLInputElement>(".field-sub input[type=checkbox]")!.disabled).toBe(false);
    // Toggling again flips it back off.
    toggle.click();
    expect(box.checked).toBe(false);
    expect(root.querySelector<HTMLInputElement>(".field-sub input[type=checkbox]")!.disabled).toBe(true);
  });

  it("lists cities, not times, on the duration search's first page", () => {
    // `?mode=from&rt=1` used to open the Simple tab; the getaway surface moved to the
    // Return tab. Page 1 compares PLACES — one row per city, no per-leg times.
    const root = setup(`?mode=from&from=${encodeURIComponent("PARIS (intramuros)")}&date=2026-06-25&rt=1`);
    expect(root.querySelector(".mode-tab.active")?.getAttribute("data-trip")).toBe("return");
    expect(root.querySelectorAll(".group-card").length).toBeGreaterThan(0);
    expect(root.querySelector(".daytrip-card")).toBeNull();
  });

  it("opens a city's own page with a calendar and its dated solutions", () => {
    const root = setup(
      `?mode=od&from=${encodeURIComponent("PARIS (intramuros)")}&to=${encodeURIComponent("LYON (intramuros)")}&date=2026-06-25&rt=1`,
    );
    expect(root.querySelector(".mode-tab.active")?.getAttribute("data-trip")).toBe("return");
    const solutions = root.querySelectorAll(".daytrip-card").length;
    if (solutions === 0) {
      // No round trip in the sample window: the empty state, never the exact-trip view.
      expect(root.querySelector(".empty")).not.toBeNull();
      return;
    }
    // A calendar of workable start days leads the page, and it agrees with the list:
    // one available cell per solution below it.
    const grid = root.querySelector(".cal-grid");
    expect(grid).not.toBeNull();
    expect(grid!.querySelectorAll(".cal-cell.ok").length).toBe(solutions);
  });
});
