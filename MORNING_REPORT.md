# Morning report — MAX JEUNE FOSS

Bonjour ☕ — here's what got built overnight, what's verified, the one manual step
left for you, and the honest list of limitations + follow-ons.

## What it is

A free, **serverless, account-free** web app that shows every train with a reservable
**MAX JEUNE / MAX SENIOR** (ex-TGVmax) seat, from SNCF open data — a FOSS reimagining of
trainquille.fr, with extra features. Everything runs as static files on GitHub Pages; a
daily GitHub Action refreshes the data. No backend, no cost, runs indefinitely.

## Status: ✅ working, tested, pushed

- Branch `claude/great-lamport-f2n77n`, 5 commits.
- `tsc` clean · `npm run build` OK · **26 unit/integration tests passing** (core logic,
  station search, URL round-trip, and a jsdom smoke test that drives the whole UI).
- Production bundle verified serving under the Pages base path (index, data, manifest,
  service worker all 200).

## Features shipped

**Search & discovery**
- *Where to?* — pick an origin → every reachable destination with a free MAX seat + times.
- *Who comes here?* — reverse: destination → all origins that reach it.
- *Exact trip* — origin + destination + date → direct **and connecting** journeys.
- **Multi-leg connections** via a hub when no direct MAX train exists (the headline extra).
- **30-day availability calendar** per route; **round-trip / weekend** finder.
- Filters: departure-time window, max duration, MAX JEUNE/SENIOR, train axis. "Surprise me".

**Everything else**
- Interactive **Leaflet map** of reachable destinations.
- **No accounts** — favorites, watched routes, settings & full **shareable deep-link URLs**
  live in the browser (localStorage + querystring).
- **FR/EN** i18n, light/dark/auto theme, **installable PWA** with offline shell, accessible
  (keyboard, ARIA, focus management, contrast).
- **.ics** calendar export + SNCF Connect handoff for booking.
- Local **Web Notifications** for watched routes when the daily snapshot opens one.

## 👉 The one thing you need to do

**Enable GitHub Pages:** repo **Settings → Pages → Build and deployment → Source = "GitHub
Actions"**. Then trigger a deploy (push, or run the *Deploy to GitHub Pages* workflow via
"Run workflow"). Site will be at **https://davd-gzl.github.io/foss-maxjeune/**.

To load **real** data instead of the bundled sample, run the *Update SNCF tgvmax data*
workflow once (Actions tab → Run workflow); afterwards it runs daily at 06:00 UTC, and the
deploy refreshes the snapshot at 06:30 UTC. (Pages deploys from whatever branch the workflow
runs on — no need to merge to `main` first, though you may want to.)

## Architecture (why it's robust)

Static **Vite + TypeScript + Leaflet**. The app reads a committed JSON snapshot
(`public/data/tgvmax.json`) rather than calling the SNCF API live — so it **doesn't depend on
the API being up or CORS-enabled**, which sidesteps the one risk we flagged earlier. The
daily Action (`scripts/fetch-data.ts`) pulls the full dataset from the SNCF Opendatasoft
export API and commits a fresh snapshot. Core logic is pure functions under `src/core/*`,
fully unit-tested offline. See `specs/` for the constitution, spec, plan and tasks.

> Note: this build container has no outbound access to the SNCF API (proxy-blocked), so live
> data couldn't be fetched *here* — but the GitHub Action runner and end-user browsers can.
> Until you run the data workflow, the app ships with a small realistic **sample** dataset
> (footer shows "données d'exemple").

## How it was built (the model cascade you asked about)

Opus drove architecture, the connections algorithm, and the final adversarial review;
cheaper Sonnet agents built the independent peripheral pieces (data pipeline + CI, PWA layer)
in parallel; a 3-lens adversarial review (correctness / a11y / security, run on Opus +
Sonnet) found real issues that were then fixed and locked with tests. Verification was the
gate throughout: nothing was called done until `tsc` + tests + build were green.

## Known limitations & suggested follow-ons

- **Cross-midnight connections under-report.** Direct trains and same-day connections are
  correct; a connection whose *first* leg arrives after midnight isn't paired (the journey
  model is single-date). Never produces *wrong* results, just misses a rare case. Fixing it
  means moving `Journey` to an absolute-minute timeline — a clean follow-up.
- **MAX JEUNE vs MAX SENIOR** currently share the dataset's availability flag; if SNCF
  exposes a per-card field, extend `normalizeRecord` to split them.
- **SNCF Connect deep-link**: the booking button opens SNCF Connect's homepage (no stable
  public prefilled-search URL was confirmed). Could be improved if one exists.
- **Station coordinates** cover ~45 major stations (for the map); unknown stations still list
  but aren't plotted. The Action could enrich from the SNCF `gares` dataset.
- **Tier-2 extras not yet built**: isochrone map view, historical-availability trends
  (accumulate daily snapshots), and RSS-feed alerts. All fit the serverless model.
- **Service worker** cache is `v1`; bump the version string on future releases to avoid
  serving a stale shell offline.

## Run it locally

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # 26 tests
npm run build   # -> dist/
```
