/**
 * scripts/verify-render.mjs — deploy gate: prove the built app actually renders.
 *
 * Serves ./dist and loads it in headless Chromium (home + a deep-link). Fails
 * (exit 1) if #app stays effectively empty or any uncaught page error fires, so
 * a build that would show a blank page can never reach production.
 *
 *   npm run build && npm run verify
 */
import http from "node:http";
import { readFileSync, existsSync, statSync, mkdtempSync } from "node:fs";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const DIST = join(process.cwd(), "dist");
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".webmanifest": "application/manifest+json", ".map": "application/json",
};
const MIN_APP_HTML = 500; // a rendered app is many KB; blank is ~the <noscript> only

const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || "/").split("?")[0]).replace(/^\/MAX-Finder\//, "/").replace(/^\/+/, "");
  let file = join(DIST, p);
  if (!file.startsWith(DIST)) return res.writeHead(403).end();
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
  if (!existsSync(file)) return res.writeHead(404).end("not found");
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/MAX-Finder/`;

const args = chromium.args.filter((a) => !a.startsWith("--user-data-dir") && !a.startsWith("--proxy"));
const browser = await puppeteer.launch({
  args: [...args, "--no-sandbox", "--disable-setuid-sandbox", "--no-proxy-server"],
  executablePath: await chromium.executablePath(),
  headless: true,
  userDataDir: mkdtempSync(join(tmpdir(), "verify-")),
});

const P = encodeURIComponent("PARIS (intramuros)");
const T = encodeURIComponent("TOULOUSE MATABIAU");
const DATE = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
const pages = [
  { name: "home", url: BASE },
  { name: "exact-trip", url: `${BASE}?mode=od&from=${P}&to=${T}&date=${DATE}` },
  { name: "tour", url: `${BASE}?mode=tour&from=${P}&cities=${encodeURIComponent("LYON (intramuros)")}&date=${DATE}&dmin=1&dmax=3` },
];

const failures = [];
for (const { name, url } of pages) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Ignore cross-origin (map tile) failures — they're expected and harmless.
  page.on("requestfailed", (r) => {
    const u = r.url();
    if (u.startsWith(BASE) && !u.includes("/data/")) errors.push(`request failed: ${u}`);
  });
  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });
  } catch (e) {
    failures.push(`[${name}] navigation failed: ${e.message}`);
    await page.close();
    continue;
  }
  await new Promise((r) => setTimeout(r, 1200));
  const appLen = await page.evaluate(() => document.getElementById("app")?.innerHTML.length ?? -1);
  if (appLen < MIN_APP_HTML) failures.push(`[${name}] #app rendered only ${appLen} chars (blank?)`);
  if (errors.length) failures.push(`[${name}] page errors: ${errors.join(" | ")}`);
  console.log(`  ${name}: #app=${appLen} chars, errors=${errors.length}`);
  await page.close();
}

await browser.close();
server.close();

if (failures.length) {
  console.error("\nRENDER VERIFICATION FAILED:");
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("\nRender verification passed — the app mounts on every checked page.");
