/**
 * scripts/e2e.mjs — end-to-end behaviour tests for the built app.
 *
 * Where `verify-render.mjs` only proves the app *mounts* without errors,
 * this drives real user journeys against the built `dist` in headless Chromium
 * and asserts on observable behaviour: the right results title, populated (or a
 * valid empty) results panel, mode switching, the "staged edits only apply on
 * Search" model, deep-link routing, history back/forward, and the PWA manifest.
 *
 * It runs fully offline against the committed data snapshot (public/data), so it
 * needs no network. Cross-origin failures (Leaflet map tiles) are ignored — only
 * uncaught page errors and *same-origin* resource failures fail a scenario, the
 * same policy as verify-render.mjs.
 *
 *   npm run build && npm run test:e2e
 *
 * Exit 0 = every scenario passed; exit 1 = at least one failed (prints details).
 */
import http from "node:http";
import { readFileSync, existsSync, statSync, mkdtempSync } from "node:fs";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const DIST = join(process.cwd(), "dist");
if (!existsSync(join(DIST, "index.html"))) {
  console.error("dist/index.html not found — run `npm run build` first.");
  process.exit(1);
}
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".webmanifest": "application/manifest+json", ".map": "application/json",
  ".txt": "text/plain", ".xml": "application/xml", ".ico": "image/x-icon",
};

// Serve dist, mirroring the GitHub-Pages /MAX-Finder/ base-path rewrite.
const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || "/").split("?")[0])
    .replace(/^\/MAX-Finder\//, "/")
    .replace(/^\/+/, "");
  let file = join(DIST, p);
  if (!file.startsWith(DIST)) return res.writeHead(403).end();
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
  if (!existsSync(file)) return res.writeHead(404).end("not found");
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const BASE = `${ORIGIN}/MAX-Finder/`;

const cargs = chromium.args.filter((a) => !a.startsWith("--user-data-dir") && !a.startsWith("--proxy"));
const browser = await puppeteer.launch({
  args: [...cargs, "--no-sandbox", "--disable-setuid-sandbox", "--no-proxy-server"],
  executablePath: await chromium.executablePath(),
  headless: true,
  userDataDir: mkdtempSync(join(tmpdir(), "e2e-")),
});

const DATE = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
const DATE2 = new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10);
const P = "PARIS (intramuros)";
const T = "TOULOUSE MATABIAU";
const L = "LYON (intramuros)";
const enc = encodeURIComponent;

// The round-trip scenario needs a REAL outbound journey on the chosen day: the return
// availability calendar only renders once the outbound produced at least one journey.
// Free-MAX availability is spotty day-to-day in the committed snapshot (some dates have
// no Paris→Lyon at all), so a blind now+5d would land on an empty day and flake. Pick,
// instead, the first snapshot date that actually has a Paris→Lyon MAX outbound — and its
// next day for the return — so the scenario is deterministic against whatever snapshot
// is committed. Falls back to the plain now+5d dates if the data can't be read.
function pickRoundTripDates() {
  try {
    const raw = JSON.parse(readFileSync(join(DIST, "data", "tgvmax.json"), "utf-8"));
    const trains = Array.isArray(raw) ? raw : raw.trains || [];
    const today = new Date().toISOString().slice(0, 10);
    const days = [
      ...new Set(
        trains
          .filter((t) => t.origine === P && t.destination === L && t.od_happy_card === "OUI" && t.date >= today)
          .map((t) => t.date),
      ),
    ].sort();
    if (!days.length) return [DATE, DATE2];
    const out = days[0];
    const next = new Date(`${out}T00:00:00Z`).getTime() + 86_400_000;
    return [out, new Date(next).toISOString().slice(0, 10)];
  } catch {
    return [DATE, DATE2];
  }
}
const [RT_DATE, RT_DATE2] = pickRoundTripDates();

// --- tiny assertion harness -------------------------------------------------
const results = [];
class Fail extends Error {}
function assert(cond, msg) {
  if (!cond) throw new Fail(msg);
}

/**
 * Open a fresh page, capture uncaught errors + same-origin request failures,
 * hand the page to `body`, then fail the scenario if anything threw or a
 * same-origin resource failed. Cross-origin failures (map tiles) are ignored.
 */
async function scenario(name, url, body, opts = {}) {
  const page = await browser.newPage();
  // Default to the desktop UI: stay above the 860px mobile breakpoint, below which
  // the form collapses into a floating search bar and the tabs move behind a menu.
  // Pass opts.viewport to exercise the mobile layout instead.
  await page.setViewport(opts.viewport ?? { width: 1366, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => {
    const u = r.url();
    // Only same-origin, non-data failures are real; tiles/CDNs are expected to fail here.
    if (u.startsWith(ORIGIN) && !u.includes("/data/")) {
      errors.push(`request failed: ${u} (${r.failure()?.errorText || "?"})`);
    }
  });
  let ok = true, detail = "";
  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 45_000 });
    await sleep(900); // let the async dataset load + first render settle
    await body(page);
    if (errors.length) throw new Fail(`page/same-origin errors: ${errors.join(" | ")}`);
  } catch (e) {
    ok = false;
    detail = e instanceof Fail ? e.message : `${e.name}: ${e.message}`;
  } finally {
    await page.close();
  }
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : "\n      " + detail}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Helpers evaluated in-page.
const $count = (page, sel) => page.$$eval(sel, (els) => els.length).catch(() => 0);
const $text = (page, sel) => page.$eval(sel, (el) => el.textContent || "").catch(() => null);
// The v2 UI tabs by trip type (data-trip: simple | return | multi | ideas); the
// search *mode* (from/to/od/tour/best) is derived from the active trip plus which
// station fields are filled, and still travels in the URL as ?mode=.
const activeTrip = (page) =>
  page.$eval(".mode-tab.active", (el) => el.getAttribute("data-trip")).catch(() => null);
const resultsState = (page) =>
  page.$eval(".results", (el) => ({
    children: el.childElementCount,
    firstClass: el.firstElementChild ? el.firstElementChild.className : null,
    hasEmpty: !!el.querySelector(".empty"),
  })).catch(() => ({ children: -1, firstClass: null, hasEmpty: false }));

// ---------------------------------------------------------------------------
console.log(`\nE2E against ${BASE} (offline, committed snapshot)\n`);

// 1. Home shell renders with the expected controls.
await scenario("home: shell renders (3 trip tabs, default 'simple', search form)", BASE, async (page) => {
  assert((await $count(page, ".mode-tab")) === 3, "expected 3 trip tabs (Trip, Multi-city, Ideas)");
  assert((await activeTrip(page)) === "simple", "default active tab should be 'simple'");
  assert((await $count(page, ".search-form")) === 1, "search form missing");
  assert((await $count(page, '.search-form input[list="station-list"]')) >= 1, "no station inputs");
  const appLen = await page.$eval("#app", (el) => el.innerHTML.length);
  assert(appLen > 3000, `#app looks blank (${appLen} chars)`);
});

// 2. Clicking a trip tab switches trip type + reflects the derived mode in the URL.
await scenario("nav: clicking the 'Multi-city' tab switches trip + URL mode", BASE, async (page) => {
  await page.click('.mode-tab[data-trip="multi"]');
  await sleep(400);
  assert((await activeTrip(page)) === "multi", "tab did not become active");
  // Multi-city derives the 'tour' search mode regardless of the station fields.
  assert(new URL(page.url()).searchParams.get("mode") === "tour", "URL mode= not updated to tour");
});

// 3. Exact-trip deep link renders the right title + a populated/valid results panel.
//    A one-way od deep link opens on the 'simple' tab (od → simple; return only when rdate is set).
await scenario(
  "deep-link: exact trip Paris → Toulouse renders titled results",
  `${BASE}?mode=od&from=${enc(P)}&to=${enc(T)}&date=${DATE}`,
  async (page) => {
    assert((await activeTrip(page)) === "simple", "active tab should be 'simple'");
    const title = (await $text(page, "#results-title")) || "";
    assert(/paris/i.test(title) && /toulouse/i.test(title), `title wrong: "${title}"`);
    const rs = await resultsState(page);
    assert(rs.children >= 1, "results panel is empty (no calendar/rows/empty-state)");
  },
);

// 4. Staged-edits model: editing a field must NOT re-run the search until Search is clicked.
//    (Regression guard for PR #12 / #18 / #19.)
await scenario(
  "behaviour: edits stay staged until Search is clicked",
  `${BASE}?mode=od&from=${enc(P)}&to=${enc(T)}&date=${DATE}`,
  async (page) => {
    const before = (await $text(page, "#results-title")) || "";
    assert(/toulouse/i.test(before), `precondition failed, title="${before}"`);
    // Change the destination to Lyon WITHOUT searching.
    await page.evaluate((val) => {
      const inputs = document.querySelectorAll('.search-form .fields input[list="station-list"]');
      const dest = inputs[1];
      dest.value = val;
      dest.dispatchEvent(new Event("input", { bubbles: true }));
      dest.dispatchEvent(new Event("change", { bubbles: true }));
    }, L);
    await sleep(400);
    const staged = (await $text(page, "#results-title")) || "";
    assert(/toulouse/i.test(staged) && !/lyon/i.test(staged),
      `title changed before Search (staged edit leaked): "${staged}"`);
    // Now click Search — the staged change applies.
    await page.click(".search-form .form-actions button.btn-primary");
    await sleep(700);
    const after = (await $text(page, "#results-title")) || "";
    assert(/lyon/i.test(after), `title did not update after Search: "${after}"`);
  },
);

// 5. Multi-city deep link (explicit legs — the v2 'multi' tab flow) renders one
//    titled leg section per hop (results or a valid empty-state, never a crash).
await scenario(
  "deep-link: multi-city Paris → Lyon → Paris renders leg sections",
  `${BASE}?mode=tour&legs=${enc(`${P}>${L}@${DATE}~${L}>${P}@${DATE2}`)}&date=${DATE}`,
  async (page) => {
    assert((await activeTrip(page)) === "multi", "active tab should be 'multi'");
    const title = (await $text(page, "#results-title")) || "";
    assert(/multi/i.test(title), `multi-city title wrong: "${title}"`);
    assert((await $count(page, ".mc-result")) >= 1, "no multi-city leg sections rendered");
    const rs = await resultsState(page);
    assert(rs.children >= 1, "multi-city results panel empty");
  },
);

// 6. Ideas/best deep link ranks destinations (data-backed, expect populated).
await scenario(
  "deep-link: ideas from Paris ranks destinations",
  `${BASE}?mode=best&from=${enc(P)}&date=${DATE}`,
  async (page) => {
    assert((await activeTrip(page)) === "ideas", "active tab should be 'ideas'");
    const rs = await resultsState(page);
    assert(rs.children >= 1, "ideas produced no destinations");
  },
);

// 7. History: deep-link → switch trip → Back returns to the deep-linked trip.
await scenario(
  "history: Back restores the previous trip",
  `${BASE}?mode=od&from=${enc(P)}&to=${enc(T)}&date=${DATE}`,
  async (page) => {
    assert((await activeTrip(page)) === "simple", "precondition: simple");
    await page.click('.mode-tab[data-trip="multi"]');
    await sleep(400);
    assert((await activeTrip(page)) === "multi", "did not switch to multi");
    await page.goBack({ waitUntil: "networkidle2" });
    await sleep(500);
    assert((await activeTrip(page)) === "simple", "Back did not restore 'simple'");
  },
);

// 9. Legacy tour deep-link (?cities=) restores the planner, not the legs editor.
//    Regression: v2 short-circuited every tour into the multi-city legs view, so
//    the city planner (Surprise me / Nearest / auto-ordered tour) was unreachable.
await scenario(
  "deep-link: legacy ?cities= tour restores the planner (not the legs editor)",
  `${BASE}?mode=tour&from=${enc(P)}&cities=${enc(L)}&date=${DATE}&dmin=1&dmax=3`,
  async (page) => {
    assert((await activeTrip(page)) === "multi", "active tab should be 'multi'");
    // The Multi tab is on its 'plan' sub-mode (the tour planner), not the leading
    // 'legs' one — so it's the SECOND button in the switch that must be pressed.
    const planPressed = await page
      .$eval(".multi-switch .multi-tab:nth-of-type(2)", (el) => el.getAttribute("aria-pressed"))
      .catch(() => null);
    assert(planPressed === "true", "the tour-plan sub-mode is not active");
    // The planner ran: no explicit-leg sections, and a real result (a tour card or a
    // valid empty-state), never the legs editor's "fill in a leg" hint.
    assert((await $count(page, ".mc-result")) === 0, "legs editor rendered instead of the planner");
    const rs = await resultsState(page);
    assert(rs.children >= 1, "planner produced no output");
  },
);

// 10. Legacy od + rdate deep-link opens the Trip tab with the round-trip control on —
//     the trip-type control is now a 2-option segmented toggle (Aller simple / Aller-
//     retour) plus a nights stepper shown only for a round trip. RT_DATE2 is RT_DATE + 1
//     day, so a return-the-next-day link resolves to "Aller-retour" pressed with the
//     stepper on "1 night". Both legs still render as a two-step accordion; the outbound
//     possible-days calendar is collapsed by default, the return shown.
await scenario(
  "deep-link: od + rdate opens the Trip tab with the round-trip toggle + 1-night stepper on",
  `${BASE}?mode=od&from=${enc(P)}&to=${enc(L)}&date=${RT_DATE}&rdate=${RT_DATE2}`,
  async (page) => {
    assert((await activeTrip(page)) === "simple", "active tab should be 'simple' (Trip)");
    // Return the next day = 1 night → the "Aller-retour" segment (2nd) reads pressed, the
    // "Aller simple" segment (1st) must NOT, and the nights stepper shows "1 night".
    const roundOn = await page
      .$eval(".trip-toggle .trip-seg:nth-of-type(2)", (el) => el.getAttribute("aria-pressed") === "true")
      .catch(() => false);
    const onewayOff = await page
      .$eval(".trip-toggle .trip-seg:nth-of-type(1)", (el) => el.getAttribute("aria-pressed") !== "true")
      .catch(() => false);
    const stepperText = await page.$eval(".nights-val", (el) => el.textContent?.trim()).catch(() => "");
    assert(roundOn, "'Aller-retour' segment should be pressed for a next-day return");
    assert(onewayOff, "'Aller simple' segment should not be pressed when a return is set");
    // Locale of the headless browser can be en or fr; accept either 1-night label.
    assert(["1 night", "1 nuit"].includes(stepperText), `nights stepper should read one night (got '${stepperText}')`);
    // Two-leg accordion (Aller / Retour), each a collapsible .mc-result section.
    assert((await $count(page, ".mc-result")) === 2, "expected a two-leg accordion (outbound + return)");
    // Both possible-days calendars (outbound + return) are collapse-by-click: for a FIXED
    // 1-night stay each is collapsed behind its own "Départ / Retour : … · Changer" toggle,
    // so at least two calendar grids and two toggles exist in the DOM.
    assert((await $count(page, ".cal-grid")) >= 2, "expected the outbound + return availability calendars");
    assert((await $count(page, ".cal-toggle")) >= 2, "expected both collapsed-calendar toggles");
  },
);

// 11. Mobile layout: below 860px the app is either the full form sheet or the
//     full-bleed map + results drawer behind a floating search bar — never both.
//     A deep link opens on results (it already carries a search); the bar reopens
//     the form and Search collapses it again. Asserts on what is *displayed*, not
//     on presence — every one of these nodes also exists at 1366px (they are only
//     display:none'd), so counting them proves nothing.
await scenario(
  "mobile: the form sheet and the results drawer swap at 390px",
  `${BASE}?mode=od&from=${enc(P)}&to=${enc(T)}&date=${DATE}`,
  async (page) => {
    const shown = (sel) =>
      page.$eval(sel, (el) => el.getBoundingClientRect().height > 0).catch(() => false);
    const mform = () => page.$eval("#app", (el) => el.dataset.mform);
    // A shared link runs its search straight away, so it lands on the results view.
    assert((await mform()) === "results", `deep link should land on results, got "${await mform()}"`);
    assert(await shown(".msearch-bar"), "no floating search bar after a mobile deep link");
    assert(await shown(".results-drawer"), "the results drawer is not displayed");
    assert(!(await shown(".search-form")), "the form sheet should be collapsed on results");
    // The results view is locked to 100dvh: neither axis may scroll the page.
    const over = await page.evaluate(() => ({
      x: document.documentElement.scrollWidth - window.innerWidth,
      y: document.documentElement.scrollHeight - window.innerHeight,
    }));
    assert(over.x <= 2, `page scrolls horizontally at 390px (${over.x}px)`);
    assert(over.y <= 2, `results view scrolls vertically at 390px (${over.y}px)`);
    // The bar reopens the whole form...
    await page.click(".msearch-bar");
    await sleep(900); // the bar→form view transition runs 0.34s
    assert((await mform()) === "form", `the bar should reopen the form, got "${await mform()}"`);
    assert(await shown(".search-form"), "the form sheet did not open from the search bar");
    assert(!(await shown(".msearch-bar")), "the collapsed bar should be hidden while the form is open");
    // ...and searching collapses it back to the drawer.
    await page.click(".search-form .form-actions button.btn-primary");
    await sleep(900);
    assert((await mform()) === "results", `searching should return to results, got "${await mform()}"`);
    assert(await shown(".results-drawer"), "the results drawer is not displayed after searching");
    assert(!(await shown(".search-form")), "the form sheet should be collapsed after searching");
  },
  { viewport: { width: 390, height: 844, isMobile: true, hasTouch: true } },
);

// 12. PWA manifest is served and parseable, icon reference resolves.
await scenario("pwa: manifest is served and valid JSON", BASE, async (page) => {
  const manifestHref = await page.$eval('link[rel="manifest"]', (el) => el.getAttribute("href"));
  assert(manifestHref, "no <link rel=manifest>");
  const res = await page.evaluate(async (href) => {
    const r = await fetch(href);
    return { status: r.status, text: await r.text() };
  }, manifestHref);
  assert(res.status === 200, `manifest HTTP ${res.status}`);
  const m = JSON.parse(res.text);
  assert(Array.isArray(m.icons) && m.icons.length > 0, "manifest has no icons");
});

// ---------------------------------------------------------------------------
await browser.close();
server.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} E2E scenarios passed.`);
if (failed.length) {
  console.error("\nE2E FAILED:");
  for (const f of failed) console.error(`  ✗ ${f.name}\n      ${f.detail}`);
  process.exit(1);
}
console.log("All E2E scenarios passed.");
