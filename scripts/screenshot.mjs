// Regenerate the README screenshots from the production build.
//   npm run build && npm run screenshot
// Serves ./dist from an in-process HTTP server and captures with the
// npm-bundled Chromium (no system browser needed).
import http from "node:http";
import { readFileSync, existsSync, statSync, mkdtempSync } from "node:fs";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const DIST = join(process.cwd(), "dist");
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json",
};

const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent((req.url || "/").split("?")[0]);
  pathname = pathname.replace(/^\/MAX-Finder\//, "/").replace(/^\/+/, "");
  let file = join(DIST, pathname);
  if (!file.startsWith(DIST)) return res.writeHead(403).end();
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
  if (!existsSync(file)) return res.writeHead(404).end("not found");
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/MAX-Finder/`;
const P = encodeURIComponent("PARIS (intramuros)");
const T = encodeURIComponent("TOULOUSE MATABIAU");
const shots = [
  { name: "from", url: `${BASE}?mode=from&from=${P}&date=2026-06-25` },
  { name: "trip", url: `${BASE}?mode=od&from=${P}&to=${T}&date=2026-06-25` },
  { name: "best", url: `${BASE}?mode=best&from=${P}&date=2026-06-25&conn=2` },
  { name: "tour", url: `${BASE}?mode=tour&from=${P}&date=2026-06-25&cities=${encodeURIComponent("LYON (intramuros)")}~${encodeURIComponent("MARSEILLE ST CHARLES")}` },
  { name: "mobile", url: `${BASE}?mode=from&from=${P}&date=2026-06-25`, mobile: true },
  { name: "arabic", url: `${BASE}?mode=from&from=${P}&date=2026-06-25`, lang: "ar" },
];

const args = chromium.args.filter((a) => !a.startsWith("--user-data-dir") && !a.startsWith("--proxy"));
const browser = await puppeteer.launch({
  args: [...args, "--no-sandbox", "--disable-setuid-sandbox", "--no-proxy-server"],
  executablePath: await chromium.executablePath(),
  headless: true,
  userDataDir: mkdtempSync(join(tmpdir(), "shot-")),
});

for (const s of shots) {
  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  await page.setViewport(
    s.mobile
      ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { width: 1120, height: 1400, deviceScaleFactor: 2 },
  );
  if (s.lang) {
    await page.evaluateOnNewDocument((lang) => {
      localStorage.setItem("mj.settings", JSON.stringify({ lang, theme: "auto", card: "jeune" }));
    }, s.lang);
  }
  await page.goto(s.url, { waitUntil: "networkidle2", timeout: 30000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  // Crop tightly to the app (#app is centred with a max width), not the full page.
  const el = await page.$("#app");
  await (el ?? page).screenshot({ path: `docs/screenshots/${s.name}.png` });
  console.log("captured", s.name);
  await page.close();
}
await browser.close();
server.close();
console.log("done");
