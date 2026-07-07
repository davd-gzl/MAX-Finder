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
const P = "PARIS (intramuros)";
const T = "TOULOUSE MATABIAU";
const L = "LYON (intramuros)";
const enc = encodeURIComponent;

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
async function scenario(name, url, body) {
  const page = await browser.newPage();
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
const activeMode = (page) =>
  page.$eval(".mode-tab.active", (el) => el.getAttribute("data-mode")).catch(() => null);
const resultsState = (page) =>
  page.$eval(".results", (el) => ({
    children: el.childElementCount,
    firstClass: el.firstElementChild ? el.firstElementChild.className : null,
    hasEmpty: !!el.querySelector(".empty"),
  })).catch(() => ({ children: -1, firstClass: null, hasEmpty: false }));

// ---------------------------------------------------------------------------
console.log(`\nE2E against ${BASE} (offline, committed snapshot)\n`);

// 1. Home shell renders with the expected controls.
await scenario("home: shell renders (5 tabs, default 'from', search form)", BASE, async (page) => {
  assert((await $count(page, ".mode-tab")) === 5, "expected 5 mode tabs");
  assert((await activeMode(page)) === "from", "default active tab should be 'from'");
  assert((await $count(page, ".search-form")) === 1, "search form missing");
  assert((await $count(page, '.search-form input[list="station-list"]')) >= 1, "no station inputs");
  const appLen = await page.$eval("#app", (el) => el.innerHTML.length);
  assert(appLen > 3000, `#app looks blank (${appLen} chars)`);
});

// 2. Clicking a mode tab switches mode + reflects it in the URL.
await scenario("nav: clicking the 'Exact trip' tab switches mode + URL", BASE, async (page) => {
  await page.click('.mode-tab[data-mode="od"]');
  await sleep(300);
  assert((await activeMode(page)) === "od", "tab did not become active");
  assert(new URL(page.url()).searchParams.get("mode") === "od", "URL mode= not updated");
  // Destination field must be visible in exact-trip mode.
  const destVisible = await page.evaluate(() => {
    const inputs = document.querySelectorAll('.search-form .fields input[list="station-list"]');
    const dest = inputs[1];
    const field = dest && dest.closest(".field, .clearable, div");
    return !!dest && dest.offsetParent !== null;
  });
  assert(destVisible, "destination field should be visible in exact-trip mode");
});

// 3. Exact-trip deep link renders the right title + a populated/valid results panel.
await scenario(
  "deep-link: exact trip Paris → Toulouse renders titled results",
  `${BASE}?mode=od&from=${enc(P)}&to=${enc(T)}&date=${DATE}`,
  async (page) => {
    assert((await activeMode(page)) === "od", "active tab should be 'od'");
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

// 5. Tour deep link renders a titled panel (results or a valid empty-state, never a crash).
await scenario(
  "deep-link: tour from Paris renders",
  `${BASE}?mode=tour&from=${enc(P)}&cities=${enc(L)}&date=${DATE}&dmin=1&dmax=3`,
  async (page) => {
    assert((await activeMode(page)) === "tour", "active tab should be 'tour'");
    const title = (await $text(page, "#results-title")) || "";
    assert(/paris/i.test(title), `tour title wrong: "${title}"`);
    const rs = await resultsState(page);
    assert(rs.children >= 1, "tour results panel empty");
  },
);

// 6. Ideas/best deep link ranks destinations (data-backed, expect populated).
await scenario(
  "deep-link: ideas from Paris ranks destinations",
  `${BASE}?mode=best&from=${enc(P)}&date=${DATE}`,
  async (page) => {
    assert((await activeMode(page)) === "best", "active tab should be 'best'");
    const rs = await resultsState(page);
    assert(rs.children >= 1, "ideas produced no destinations");
  },
);

// 7. History: deep-link → switch mode → Back returns to the deep-linked mode.
await scenario(
  "history: Back restores the previous mode",
  `${BASE}?mode=od&from=${enc(P)}&to=${enc(T)}&date=${DATE}`,
  async (page) => {
    assert((await activeMode(page)) === "od", "precondition: od");
    await page.click('.mode-tab[data-mode="tour"]');
    await sleep(400);
    assert((await activeMode(page)) === "tour", "did not switch to tour");
    await page.goBack({ waitUntil: "networkidle2" });
    await sleep(500);
    assert((await activeMode(page)) === "od", "Back did not restore 'od'");
  },
);

// 8. PWA manifest is served and parseable, icon reference resolves.
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
