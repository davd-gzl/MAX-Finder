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
    // The 30-day route availability calendar is rendered in the RESULTS panel. (The Trip
    // tab's form now also carries a reactive availability calendar as its date picker, so
    // these assertions scope to `.results` to target the results strip specifically.)
    const routeCal = root.querySelector(".results .cal-grid");
    expect(routeCal).not.toBeNull();
    expect(routeCal!.querySelectorAll(".cal-cell").length).toBe(30);
    // A one-way exact-trip shows no "come back?" section — only the round trip does.
    expect(root.querySelector(".od-return")).toBeNull();
    expect(root.querySelectorAll(".results .cal-grid").length).toBe(1);
  });

  it("shows the outbound + return availability calendars together for a round-trip deep-link", () => {
    const root = setup(
      `?mode=od&from=${encodeURIComponent("PARIS (intramuros)")}&to=${encodeURIComponent("TOULOUSE MATABIAU")}&date=2026-06-25&rdate=2026-06-27`,
    );
    // Round trip now lives on the Trip tab (no separate Return tab), with the return
    // availability calendar as a second strip right under the outbound one.
    expect(root.querySelector(".mode-tab.active")?.getAttribute("data-trip")).toBe("simple");
    const retStrip = root.querySelector(".od-return-cal");
    expect(retStrip).not.toBeNull();
    expect(retStrip!.querySelector(".cal-grid")).not.toBeNull();
    // Two calendar strips visible at once in the results: outbound + return.
    expect(root.querySelectorAll(".results .cal-grid").length).toBeGreaterThanOrEqual(2);
    // The return TRAIN list sits in its own section below.
    expect(root.querySelector(".od-return")).not.toBeNull();
  });

  it("keeps the stay choice on when the destination is cleared", () => {
    // Regression: a return date was gated on mode === "od", but a blank destination
    // derives mode "from" — the stay intent must still survive (as stay=…) so a reload
    // restores the Trip tab with the "How long?" chip lit.
    const root = setup(
      `?mode=od&from=${encodeURIComponent("PARIS (intramuros)")}&to=${encodeURIComponent("TOULOUSE MATABIAU")}&date=2026-06-25&rdate=2026-06-27`,
    );
    expect(root.querySelector(".mode-tab.active")?.getAttribute("data-trip")).toBe("simple");
    // A legacy rdate two days after the outbound resolves to a 2-night round trip: the
    // "Aller-retour" segment is pressed and the nights stepper reads "2 nights".
    expect(root.querySelectorAll(".trip-toggle .trip-seg")[1]?.getAttribute("aria-pressed")).toBe("true");
    expect(root.querySelector(".nights-val")?.textContent).toBe("2 nights");
    // origin is [0], destination is [1] within the départ/arrivée row.
    const dest = root.querySelectorAll<HTMLInputElement>('.od-fields input[list="station-list"]')[1];
    expect(dest).toBeTruthy();
    dest!.value = "";
    dest!.dispatchEvent(new Event("input", { bubbles: true }));
    dest!.dispatchEvent(new Event("change", { bubbles: true }));
    (root.querySelector(".search-form button[type=submit]") as HTMLElement).click();

    const url = location.search;
    // The choice is now serialized as stay=2 (day=same-day, 1/2/3=nights, flex=flexible).
    expect(new URLSearchParams(url).get("stay")).toBe("2");
    // Reloading it must land back on the Trip tab with the "2" chip lit.
    const reloaded = setup(url);
    expect(reloaded.querySelector(".mode-tab.active")?.getAttribute("data-trip")).toBe("simple");
    expect(reloaded.querySelectorAll(".trip-toggle .trip-seg")[1]?.getAttribute("aria-pressed")).toBe("true");
    expect(reloaded.querySelector(".nights-val")?.textContent).toBe("2 nights");
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
    // Trip, Multi-city, Ideas (round trip is a toggle on Trip now, not a tab).
    expect(root.querySelectorAll(".mode-tab").length).toBeGreaterThanOrEqual(3);
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

  it("offers a One-way / Round-trip toggle with a nights stepper beside the date", () => {
    const root = setup("");
    const wrap = root.querySelector(".trip-shape-wrap");
    expect(wrap).toBeTruthy();
    // It lives inside the date row (requirement 1), not in the Advanced panel.
    expect(wrap!.closest(".date-row")).toBeTruthy();
    expect(wrap!.closest(".advanced")).toBeNull();
    // A 2-option segmented control: Aller simple (one-way) / Aller-retour (round trip).
    const segs = Array.from(wrap!.querySelectorAll<HTMLElement>(".trip-toggle .trip-seg"));
    expect(segs.map((b) => b.textContent)).toEqual(["One-way", "Round trip"]);
    // One-way is the baseline; the nights stepper is hidden until a round trip is chosen.
    expect(segs[0]!.getAttribute("aria-pressed")).toBe("true");
    expect((wrap!.querySelector(".nights-field") as HTMLElement).style.display).toBe("none");
    // Switching to Round trip presses that segment and reveals the stepper (default Same day).
    segs[1]!.click();
    expect(segs[1]!.getAttribute("aria-pressed")).toBe("true");
    expect((wrap!.querySelector(".nights-field") as HTMLElement).style.display).not.toBe("none");
    expect(wrap!.querySelector(".nights-val")?.textContent).toBe("Same day");
    // The −/+ buttons carry accessible labels and the value announces via aria-live.
    const [minus, plus] = Array.from(wrap!.querySelectorAll<HTMLElement>(".nights-step"));
    expect(minus!.getAttribute("aria-label")).toBe("Fewer nights");
    expect(plus!.getAttribute("aria-label")).toBe("More nights");
    expect(wrap!.querySelector(".nights-val")?.getAttribute("aria-live")).toBe("polite");
    // Same day is the default (a day trip), so minus starts disabled (can't go below 0).
    expect((minus as HTMLButtonElement).disabled).toBe(true);
    // Stepping up reads "1 night", "2 nights"; stepping back down to 0 reads "Same day".
    plus!.click();
    expect(wrap!.querySelector(".nights-val")?.textContent).toBe("1 night");
    plus!.click();
    expect(wrap!.querySelector(".nights-val")?.textContent).toBe("2 nights");
    minus!.click();
    minus!.click();
    expect(wrap!.querySelector(".nights-val")?.textContent).toBe("Same day");
    expect((minus as HTMLButtonElement).disabled).toBe(true); // can't go below 0 nights
  });

  it("steps the nights freely past 3 and back down — a fixed stay never flips to Flexible (bug: stuck at 4)", () => {
    const root = setup("");
    const wrap = root.querySelector(".trip-shape-wrap")!;
    root.querySelectorAll<HTMLElement>(".trip-toggle .trip-seg")[1]!.click(); // Round trip
    const [minus, plus] = Array.from(wrap.querySelectorAll<HTMLElement>(".nights-ctl .nights-step"));
    const val = () => wrap.querySelector(".nights-val")!.textContent;
    const flex = wrap.querySelector<HTMLElement>(".nights-flex")!;
    // Step up well past 3 (the old cap where stayFromNights flipped to "flexible").
    for (let i = 0; i < 5; i++) plus!.click(); // 0 (Same day) → 5
    expect(val()).toBe("5 nights");
    // Crucially, the stepper stays USABLE — neither the −/+ buttons nor the mode flip to
    // Flexible (the old bug disabled both at 4 nights via stay="flexible").
    expect((minus as HTMLButtonElement).disabled).toBe(false);
    expect((plus as HTMLButtonElement).disabled).toBe(false);
    expect(flex.getAttribute("aria-pressed")).toBe("false");
    expect(new URLSearchParams(location.search).get("stay")).toBe("5"); // a fixed 5-night stay, not "flex"
    // And it steps back DOWN freely from 5.
    minus!.click();
    expect(val()).toBe("4 nights");
    minus!.click();
    expect(val()).toBe("3 nights");
    expect(new URLSearchParams(location.search).get("stay")).toBe("3");
  });

  it("a round trip with only a destination runs reverse discovery, not a blank screen (bug)", () => {
    // Destination filled, origin empty, a stay chosen → the reverse round-trip finder:
    // "where can you round-trip FROM to reach this station?" — never the old dead prompt.
    const root = setup(`?mode=to&to=${encodeURIComponent("LYON (intramuros)")}&date=2026-06-25&stay=1`);
    const title = root.querySelector("#results-title")?.textContent ?? "";
    expect(title).toMatch(/reach/i); // "Where can you round-trip from to reach Lyon?"
    expect(title).toContain("Lyon");
    // A real screen (calendar / list / valid empty state), and NOT the "add a departure" hint.
    expect(root.querySelector(".results")!.childElementCount).toBeGreaterThan(0);
    expect(root.textContent ?? "").not.toContain("Add a departure to see where you can go and come back.");
  });

  it("toggling to Round trip runs it in place — no second Search tap", () => {
    // Origin + destination + date are already set, so flipping to a round trip is the only
    // decision left: it must render the round trip straight away (minimise clicks).
    const root = setup(
      `?mode=od&from=${encodeURIComponent("PARIS (intramuros)")}&to=${encodeURIComponent("LYON (intramuros)")}&date=2026-06-25`,
    );
    // A plain one-way to start: no return section.
    expect(root.querySelector(".od-return")).toBeNull();
    const round = root.querySelectorAll<HTMLElement>(".trip-toggle .trip-seg")[1];
    round!.click();
    // The 2-leg round trip is now showing (the toggle alone ran it), defaulting to Same day
    // (a day trip), and the choice is in the URL as stay=day.
    expect(root.querySelectorAll(".mc-result").length).toBe(2);
    expect(root.querySelector(".od-return")).not.toBeNull();
    expect(new URLSearchParams(location.search).get("stay")).toBe("day");
    // A same-day round trip returns the same day — the return date equals the outbound.
    expect(new URLSearchParams(location.search).get("rdate")).toBe("2026-06-25");
  });

  it("drives a boolean field through its toggle switch", () => {
    const root = setup("");
    const wrap = Array.from(root.querySelectorAll(".field-switch")).find((f) =>
      (f.textContent ?? "").trim().startsWith("Night trains"),
    ) as HTMLElement;
    expect(wrap).toBeTruthy();
    const box = wrap.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    const toggle = wrap.querySelector<HTMLElement>(".switch")!;
    // Night trains are now INCLUDED by default, so the switch starts ON and the nested
    // "only night trains" sub-field is enabled from the start.
    expect(box.checked).toBe(true);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.classList.contains("is-on")).toBe(true);
    expect(root.querySelector<HTMLInputElement>(".field-sub input[type=checkbox]")!.disabled).toBe(false);
    // Toggling off flips the value and fires change — which greys out (disables) the
    // nested "only night trains" sub-field.
    toggle.click();
    expect(box.checked).toBe(false);
    expect(toggle.classList.contains("is-on")).toBe(false);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(root.querySelector<HTMLInputElement>(".field-sub input[type=checkbox]")!.disabled).toBe(true);
    // Toggling again flips it back on.
    toggle.click();
    expect(box.checked).toBe(true);
    expect(root.querySelector<HTMLInputElement>(".field-sub input[type=checkbox]")!.disabled).toBe(false);
  });

  it("lists cities, not times, on the round-trip browse (where-to) page", () => {
    // `?mode=from&rt=1` = "where can I round-trip to from here?" — on the Trip tab now.
    // The page compares PLACES: one row per city, no per-leg times.
    const root = setup(`?mode=from&from=${encodeURIComponent("PARIS (intramuros)")}&date=2026-06-25&rt=1`);
    expect(root.querySelector(".mode-tab.active")?.getAttribute("data-trip")).toBe("simple");
    // No casual window-preset chips: discovery uses the form's date + the sweep's nights
    // range, scanning from the chosen departure onward (efficiency over "this weekend").
    expect(root.querySelector(".win-chip")).toBeNull();
    expect(root.querySelectorAll(".group-card").length).toBeGreaterThan(0);
    expect(root.querySelector(".daytrip-card")).toBeNull();
  });

  it("opens the two-calendar round-trip view for an exact-route round trip", () => {
    const root = setup(
      `?mode=od&from=${encodeURIComponent("PARIS (intramuros)")}&to=${encodeURIComponent("LYON (intramuros)")}&date=2026-06-25&rt=1`,
    );
    expect(root.querySelector(".mode-tab.active")?.getAttribute("data-trip")).toBe("simple");
    // Outbound + return availability strips together, and the return train list below.
    expect(root.querySelector(".od-return-cal .cal-grid")).not.toBeNull();
    expect(root.querySelectorAll(".results .cal-grid").length).toBeGreaterThanOrEqual(2);
    expect(root.querySelector(".od-return")).not.toBeNull();
    // Both legs render as the multi-city accordion stepper (two ✓-collapsible legs).
    expect(root.querySelectorAll(".mc-result").length).toBe(2);
  });

  it("resolves legacy rt=day to the Same-day chip with a return calendar starting same-day", () => {
    const root = setup(
      `?mode=od&from=${encodeURIComponent("PARIS (intramuros)")}&to=${encodeURIComponent("LYON (intramuros)")}&date=2026-06-25&rt=day`,
    );
    // Legacy rt=day is no longer a distinct mode — it resolves to a round trip with the
    // nights stepper on 0 ("Same day" — a day trip is the 0-night case).
    expect(root.querySelectorAll(".trip-toggle .trip-seg")[1]?.getAttribute("aria-pressed")).toBe("true");
    expect(root.querySelector(".nights-val")?.textContent).toBe("Same day");
    // ONE return calendar, and its FIRST cell is the OUTBOUND day (same-day = 0 nights),
    // not the day after — so tapping it gives a same-day trip with no separate mode.
    const retCells = root.querySelectorAll(".od-return-cal .cal-cell");
    expect(retCells.length).toBeGreaterThan(0);
    expect(retCells[0]!.querySelector(".cal-day")?.textContent).toBe("25");
    // Two accordion legs, and NO glossary blurb — the stay control makes it self-evident.
    expect(root.querySelectorAll(".mc-result").length).toBe(2);
    expect(root.querySelector(".glossary")).toBeNull();
    // The possible-days (outbound) calendar is collapsed by default once a date is chosen:
    // a one-tap "change departure" summary with the calendar panel hidden beside it.
    const leg1 = root.querySelectorAll(".mc-result")[0] as HTMLElement;
    expect(leg1.querySelector(".cal-toggle")).not.toBeNull();
    expect(leg1.querySelector(".cal-panel")?.hasAttribute("hidden")).toBe(true);
  });

  it("collapses the outbound leg to a ✓ summary when a train is picked (accordion)", () => {
    const root = setup(
      `?mode=od&from=${encodeURIComponent("PARIS (intramuros)")}&to=${encodeURIComponent("LYON (intramuros)")}&date=2026-06-25&rt=round`,
    );
    const leg1 = root.querySelectorAll(".mc-result")[0] as HTMLElement;
    const card = leg1.querySelector(".mc-leg-body .journey") as HTMLElement;
    expect(card).toBeTruthy();
    card.click(); // pick the outbound → leg collapses, its number becomes ✓
    expect(leg1.classList.contains("mc-collapsed")).toBe(true);
    expect(leg1.querySelector(".mc-num")?.textContent).toBe("✓");
  });

  it("persists the picked return date to the URL (stay + rdate)", () => {
    const root = setup(
      `?mode=od&from=${encodeURIComponent("PARIS (intramuros)")}&to=${encodeURIComponent("LYON (intramuros)")}&date=2026-06-25&rt=round`,
    );
    // rt=round (no fixed length) resolves to a round trip; the return calendar decides the
    // day, and picking one settles the stepper onto the matching night count.
    expect(root.querySelectorAll(".trip-toggle .trip-seg")[1]?.getAttribute("aria-pressed")).toBe("true");
    const retCell = root.querySelector(".od-return-cal .cal-cell.ok") as HTMLElement | null;
    if (retCell) {
      retCell.click();
      const p = new URLSearchParams(location.search);
      // Picking a return day settles both the concrete date and the matching stay chip.
      expect(p.get("stay")).toBeTruthy();
      expect(p.get("rdate")).toBeTruthy();
    }
  });

  it("collapses the return calendar by default for a fixed stay (collapse-by-click)", () => {
    const root = setup(
      `?mode=od&from=${encodeURIComponent("PARIS (intramuros)")}&to=${encodeURIComponent("LYON (intramuros)")}&date=2026-06-25&rt=day`,
    );
    // Same-day is a FIXED stay: the return is derived, so its calendar collapses behind a
    // one-tap "Retour : … · Changer" summary (mirroring the outbound calendar).
    const retStrip = root.querySelector(".od-return-cal");
    expect(retStrip).not.toBeNull();
    const toggle = retStrip!.querySelector(".cal-toggle") as HTMLElement | null;
    expect(toggle).not.toBeNull();
    expect(retStrip!.querySelector(".cal-panel")?.hasAttribute("hidden")).toBe(true);
    // Tapping the summary reveals the calendar to change the return day.
    toggle!.click();
    expect(retStrip!.querySelector(".cal-panel")?.hasAttribute("hidden")).toBe(false);
  });

  it("keeps the return calendar open in Flexible mode (the return is picked there)", () => {
    const root = setup(
      `?mode=od&from=${encodeURIComponent("PARIS (intramuros)")}&to=${encodeURIComponent("LYON (intramuros)")}&date=2026-06-25&rt=round`,
    );
    // rt=round → Flexible: the return calendar IS the length control, so it stays open with
    // no collapse toggle.
    const retStrip = root.querySelector(".od-return-cal");
    expect(retStrip).not.toBeNull();
    expect(retStrip!.querySelector(".cal-toggle")).toBeNull();
    expect(retStrip!.querySelector(".cal-grid")).not.toBeNull();
    // Bug regression: the RETURN LEG accordion (Leg 2) must itself start OPEN in Flexible —
    // if it were collapsed (like a fixed stay), the return calendar would sit at zero height
    // inside it and be untappable on touch ("can't select the return date in Flexible on
    // mobile"). It is only reachable/tappable when the leg is expanded.
    const returnLeg = retStrip!.closest(".mc-result");
    expect(returnLeg).not.toBeNull();
    expect(returnLeg!.classList.contains("mc-collapsed")).toBe(false);
    // A fixed round trip, by contrast, keeps Leg 2 collapsed until an outbound is picked.
    const fixed = setup(
      `?mode=od&from=${encodeURIComponent("PARIS (intramuros)")}&to=${encodeURIComponent("LYON (intramuros)")}&date=2026-06-25&rdate=2026-06-27`,
    );
    const fixedReturnLeg = fixed.querySelectorAll(".mc-result")[1];
    expect(fixedReturnLeg?.classList.contains("mc-collapsed")).toBe(true);
  });

  it("switches a fixed round trip to Flexible via the nights-control pill", () => {
    const root = setup(
      `?mode=od&from=${encodeURIComponent("PARIS (intramuros)")}&to=${encodeURIComponent("TOULOUSE MATABIAU")}&date=2026-06-25&rdate=2026-06-27`,
    );
    // 2-night fixed stay: the Flexible pill is not pressed and the stepper is active.
    const flex = root.querySelector(".nights-flex") as HTMLElement | null;
    expect(flex).not.toBeNull();
    expect(flex!.getAttribute("aria-pressed")).toBe("false");
    expect((root.querySelector(".nights-ctl") as HTMLElement).classList.contains("is-inert")).toBe(false);
    flex!.click();
    // Now Flexible: the pill is pressed and stay=flex.
    expect(flex!.getAttribute("aria-pressed")).toBe("true");
    expect(new URLSearchParams(location.search).get("stay")).toBe("flex");
  });

  it("locks the calendar OPEN while Flexible so the retour is always tappable (any entry path)", () => {
    // Enter Flexible straight from the query (the reopen-form / URL-restore path that a plain
    // toggle-with-openFormCal did NOT cover): the calendar must be open, not collapsed.
    const root = setup(
      `?mode=od&from=${encodeURIComponent("PARIS (intramuros)")}&to=${encodeURIComponent("LYON (intramuros)")}&date=2026-06-25&stay=flex&rdate=2026-06-28`,
    );
    const block = root.querySelector(".form-cal-block") as HTMLElement;
    const body = root.querySelector(".form-cal-body") as HTMLElement;
    // Flexible restored from the query → the month is already open + locked, no tap needed.
    expect(block.classList.contains("cal-locked")).toBe(true);
    expect(body.hasAttribute("hidden")).toBe(false);
    expect(block.querySelectorAll(".form-cal-body .cal-cell").length).toBeGreaterThan(0);
    // Clicking the header must NOT collapse it while Flexible (else the retour grid vanishes).
    (block.querySelector(".form-cal-toggle") as HTMLElement).click();
    expect(body.hasAttribute("hidden")).toBe(false);
    // Leaving Flexible (toggle the pill off → a fixed stay) unlocks it — collapsible again.
    (root.querySelector(".nights-flex") as HTMLElement).click();
    expect((root.querySelector(".form-cal-block") as HTMLElement).classList.contains("cal-locked")).toBe(false);
  });

  it("shows a populated calendar for a destination-only browse (never an empty grid)", () => {
    // Only the destination filled (browse by arrival). Before the fix this fell through to the
    // neutral, all-unavailable grid; now it counts the origins that can reach the destination.
    const root = setup(`?to=${encodeURIComponent("PARIS (intramuros)")}`);
    const block = root.querySelector(".form-cal-block") as HTMLElement;
    if ((root.querySelector(".form-cal-body") as HTMLElement).hasAttribute("hidden")) {
      (block.querySelector(".form-cal-toggle") as HTMLElement).click();
    }
    const cells = Array.from(block.querySelectorAll<HTMLElement>(".form-cal-body .cal-cell"));
    expect(cells.length).toBeGreaterThan(0);
    // At least one day is genuinely available (an "ok" cell), not the neutral/empty state.
    expect(cells.some((c) => c.classList.contains("ok"))).toBe(true);
    expect(cells.some((c) => c.classList.contains("neutral"))).toBe(false);
  });

  it("keeps the nights stepper IN PLACE (inert, not removed) when Flexible toggles — no reflow", () => {
    const root = setup(
      `?mode=od&from=${encodeURIComponent("PARIS (intramuros)")}&to=${encodeURIComponent("TOULOUSE MATABIAU")}&date=2026-06-25&rdate=2026-06-27`,
    );
    const wrap = root.querySelector(".nights-field") as HTMLElement;
    const ctl = root.querySelector(".nights-ctl") as HTMLElement;
    const label = root.querySelector(".nights-label") as HTMLElement;
    const flex = root.querySelector(".nights-flex") as HTMLElement;
    const steps = Array.from(root.querySelectorAll<HTMLButtonElement>(".nights-step"));
    // Fixed stay: the stepper is present, active, and its buttons are live.
    expect(ctl.style.display).not.toBe("none");
    expect(ctl.classList.contains("is-inert")).toBe(false);
    expect(steps.some((b) => !b.disabled)).toBe(true);
    // The "Durée sur place" label and the stepper are in the DOM before the toggle.
    expect(label.isConnected).toBe(true);
    const stepCountBefore = steps.length;
    flex.click(); // → Flexible
    // The stepper is STILL present (never removed → no layout jump), just inert/dimmed,
    // and its −/+ buttons are disabled. The label hasn't moved (same field, same order).
    expect(ctl.isConnected).toBe(true);
    expect(ctl.style.display).not.toBe("none");
    expect(ctl.classList.contains("is-inert")).toBe(true);
    expect(root.querySelectorAll(".nights-step").length).toBe(stepCountBefore);
    expect(Array.from(root.querySelectorAll<HTMLButtonElement>(".nights-step")).every((b) => b.disabled)).toBe(true);
    // Label + controls keep their order inside .nights-field (label first, then controls).
    expect(wrap.firstElementChild).toBe(label);
    // Back to a fixed stay: the stepper is live again.
    flex.click();
    expect((root.querySelector(".nights-ctl") as HTMLElement).classList.contains("is-inert")).toBe(false);
  });

  it("Flexible turns the Trip-tab calendar into a departure→return range picker", () => {
    const root = setup(
      `?mode=od&from=${encodeURIComponent("PARIS (intramuros)")}&to=${encodeURIComponent("LYON (intramuros)")}&date=2026-06-25&rt=round`,
    );
    // rt=round → Flexible. Open the inline "Quand partir ?" calendar on the form.
    const block = root.querySelector(".form-cal-block") as HTMLElement;
    (block.querySelector(".form-cal-toggle") as HTMLElement).click();
    const dayOf = (c: Element | null): string | undefined => c?.querySelector(".cal-day")?.textContent ?? undefined;
    const cellFor = (day: number): HTMLElement | undefined =>
      Array.from(block.querySelectorAll<HTMLElement>(".form-cal-body .cal-cell")).find((c) => Number(dayOf(c)) === day);
    // First tap = the departure (28). No return yet, so it's the sole selected endpoint
    // and no day carries the range band yet (staged inline, no navigation).
    cellFor(28)!.click();
    expect(cellFor(28)!.classList.contains("sel")).toBe(true);
    expect(Array.from(block.querySelectorAll(".form-cal-body .cal-cell.range")).length).toBe(0);
    // Second tap on a LATER day = the return (30): sets rdate and highlights the in-between.
    cellFor(30)!.click();
    const params = new URLSearchParams(location.search);
    expect(params.get("stay")).toBe("flex");
    expect(params.get("date")).toBe("2026-06-28");
    expect(params.get("rdate")).toBe("2026-06-30");
    // The days strictly between the endpoints carry the range band; 29 is in range.
    expect(cellFor(29)!.classList.contains("range")).toBe(true);
    // Both endpoints read selected.
    expect(cellFor(28)!.classList.contains("sel")).toBe(true);
    expect(cellFor(30)!.classList.contains("sel")).toBe(true);
  });

  it("Flexible with ONLY an origin (browse) lets you pick départ → retour — the return registers", () => {
    // Regression: with only a departure filled the mode is "from" (discovery), which used to
    // drop the flexible return in readQueryFromForm, so the arrival tap did nothing. It must
    // now register the return and carry the départ→retour window (rdate).
    const root = setup(`?from=${encodeURIComponent("PARIS (intramuros)")}&date=2026-06-25&stay=flex`);
    // Only the origin is filled (no destination) → origin-only "from" discovery.
    const destInput = root.querySelectorAll<HTMLInputElement>('.od-fields input[list="station-list"]')[1];
    expect(destInput?.value ?? "").toBe("");
    const block = root.querySelector(".form-cal-block") as HTMLElement;
    // Flexible locks the calendar open, so the cells are already present (no toggle needed).
    const dayOf = (c: Element | null): string | undefined => c?.querySelector(".cal-day")?.textContent ?? undefined;
    const cellFor = (day: number): HTMLElement | undefined =>
      Array.from(block.querySelectorAll<HTMLElement>(".form-cal-body .cal-cell")).find((c) => Number(dayOf(c)) === day);
    cellFor(27)!.click(); // départ
    cellFor(30)!.click(); // retour — must register despite there being no destination
    const params = new URLSearchParams(location.search);
    expect(params.get("stay")).toBe("flex");
    expect(params.get("date")).toBe("2026-06-27");
    expect(params.get("rdate")).toBe("2026-06-30"); // the return was NOT dropped
    // The band paints between the endpoints, so the arrival visibly took effect.
    expect(cellFor(28)!.classList.contains("range")).toBe(true);
    expect(cellFor(30)!.classList.contains("sel")).toBe(true);
  });

  it("restores the Flexible range from the query on sync (stay=flex + rdate)", () => {
    const root = setup(
      `?mode=od&from=${encodeURIComponent("PARIS (intramuros)")}&to=${encodeURIComponent("LYON (intramuros)")}&date=2026-06-25&stay=flex&rdate=2026-06-28`,
    );
    const block = root.querySelector(".form-cal-block") as HTMLElement;
    (block.querySelector(".form-cal-toggle") as HTMLElement).click();
    const dayOf = (c: Element | null): string | undefined => c?.querySelector(".cal-day")?.textContent ?? undefined;
    const cellFor = (day: number): HTMLElement | undefined =>
      Array.from(block.querySelectorAll<HTMLElement>(".form-cal-body .cal-cell")).find((c) => Number(dayOf(c)) === day);
    // The stored range (25 → 28) is repainted: both ends selected, the middle days banded.
    expect(cellFor(25)!.classList.contains("sel")).toBe(true);
    expect(cellFor(28)!.classList.contains("sel")).toBe(true);
    expect(cellFor(26)!.classList.contains("range")).toBe(true);
    expect(cellFor(27)!.classList.contains("range")).toBe(true);
    // The collapsed header spells out both endpoints.
    expect((root.querySelector(".form-cal-picked") as HTMLElement).textContent).toContain("→");
  });

  it("links the calendars: clicking a departure day restarts the return calendar from it", () => {
    const root = setup(
      `?mode=od&from=${encodeURIComponent("PARIS (intramuros)")}&to=${encodeURIComponent("LYON (intramuros)")}&date=2026-06-25&rt=round`,
    );
    // The return calendar starts on the outbound day (25) — same-day is its first cell.
    const dayOf = (c: Element | null): string | undefined => c?.querySelector(".cal-day")?.textContent ?? undefined;
    expect(dayOf(root.querySelector(".od-return-cal .cal-cell"))).toBe("25");
    // Expand the outbound possible-days calendar and pick a LATER green departure.
    const leg1 = root.querySelectorAll(".mc-result")[0] as HTMLElement;
    (leg1.querySelector(".cal-toggle") as HTMLElement).click();
    const later = Array.from(leg1.querySelectorAll<HTMLElement>(".cal-panel .cal-cell.ok")).find(
      (c) => Number(dayOf(c)) > 25,
    );
    if (later) {
      const day = dayOf(later);
      later.click();
      // "Click the first cell, it updates the other": the return calendar now restarts
      // from the new departure day.
      expect(dayOf(root.querySelector(".od-return-cal .cal-cell"))).toBe(day);
    }
  });

  it("walks Back through the round-trip steps: Back re-opens the outbound before exiting", () => {
    const root = setup(
      `?mode=od&from=${encodeURIComponent("PARIS (intramuros)")}&to=${encodeURIComponent("LYON (intramuros)")}&date=2026-06-25&rt=1`,
    );
    const leg1 = root.querySelectorAll(".mc-result")[0] as HTMLElement;
    (leg1.querySelector(".mc-leg-body .journey") as HTMLElement).click(); // pick the outbound → collapses
    expect(leg1.classList.contains("mc-collapsed")).toBe(true);
    // Back (Escape) steps INSIDE the flow first — the outbound re-opens to be changed,
    // rather than the whole trip search being exited.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(leg1.classList.contains("mc-collapsed")).toBe(false);
  });
});
