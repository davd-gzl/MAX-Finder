# MAX Finder

A free, open-source, **serverless** finder for trains where a **MAX JEUNE** / **MAX SENIOR**
(ex-TGVmax) seat is currently reservable — so you don't have to probe station-by-station in
SNCF Connect.

> An independent, open-source tool — not affiliated with SNCF, not a ticket seller.
> Availability is indicative and refreshed daily from public open data.

## Screenshots

| Où partir (destinations ranked by availability) | Trajet précis (connections + 30-day calendar) |
| --- | --- |
| ![Origin search](docs/screenshots/from.png) | ![Trip search](docs/screenshots/trip.png) |
| Idées (fastest destinations) | Tour (multi-city itinerary, chip input) |
| ![Best trips](docs/screenshots/best.png) | ![Tour planner](docs/screenshots/tour.png) |

## Why

The hard part — *which trains actually have a free MAX seat* — is published by SNCF as
open data (the [`tgvmax` dataset](https://ressources.data.sncf.com/explore/dataset/tgvmax/information/)).
This app is a frontend over that dataset. No backend, no accounts, no cost.

## Features

- **Où partir** — every destination reachable with a free MAX seat from your station,
  each annotated with **how many MAX trains run there over the booking window** and ranked
  by that availability. Click one to open the exact trip and see precisely which dates work.
- **D'où venir** — the reverse: every origin that can reach a destination.
- **Trajet précis** — full origin → destination search with a **30-day availability calendar**
  and a **round-trip / weekend-getaway** finder.
- **Idées** — the fastest destinations reachable from your station that day.
- **Tour** — a multi-city, day-by-day itinerary chaining free MAX seats, with a **chip input**
  for the cities to visit.
- **Multi-leg connections** up to 6 changes via hubs, with an optional **"Via" stopover** and
  an **overnight-stopover** mode for long, multi-day journeys.
- **Filters**: time window, max duration, MAX JEUNE vs MAX SENIOR, train type, region.
- **Map** (Leaflet) of every reachable station — all dataset stations are plotted — with
  correspondences shown as intermediate points; click a point to select it in the list.
- **Live form** (results update as you change a field), **back navigation** (and `Esc`),
  **"Au hasard"** random-city shortcut, **calendar export (ICS)**, and shareable URLs.
- **No accounts** — favorites, settings and searches live in your browser (localStorage).
  Optional **local notifications** for watched routes.
- **11 languages** (FR, EN, ES, DE, IT, KO, ZH, JA, NL, PT, AR — incl. right-to-left),
  light/dark theme, installable **PWA** with offline support, mobile-friendly, accessible.

## Architecture

Pure static site (Vite + TypeScript + Leaflet) deployed to GitHub Pages.
A scheduled **GitHub Action** snapshots the SNCF `tgvmax` dataset into `data/tgvmax.json`
each morning, so the site never depends on a live server. The browser can also query the
SNCF API directly as a fallback. See [`specs/`](./specs) for the full spec-driven design.

```
data/        committed daily snapshot (+ a small fixture for dev/tests)
src/core     pure search / connections / calendar logic (unit-tested)
src/data     dataset loading + station lookup
src/ui       rendering (search form, results, map, calendar)
scripts/     fetch-data.ts — used by the daily Action
.github/     update-data (cron) + deploy (Pages) workflows
specs/        constitution, spec, plan, tasks (Spec-Driven Development)
```

## Develop

```bash
npm install
npm run dev      # http://localhost:5173  (uses the committed data snapshot / fixture)
npm test         # unit tests (no network needed)
npm run build    # static build -> dist/
```

## Data & disclaimer

Data: [SNCF Open Data — Disponibilité à 30 jours de places MAX JEUNE et MAX SENIOR](https://ressources.data.sncf.com/explore/dataset/tgvmax/information/),
licensed under the [Licence Ouverte / Open Licence](https://www.etalab.gouv.fr/licence-ouverte-open-licence).
Availability is updated roughly once a day and is **indicative** — always confirm and book on
[SNCF Connect](https://www.sncf-connect.com/). This project does not sell tickets and is not
affiliated with SNCF.

## For agents / data API

Machine-readable and serverless. [`llms.txt`](public/llms.txt) and
[`api.json`](public/api.json) describe the data + query API for AI agents:

- **Availability** — `data/tgvmax.json` (records where `od_happy_card: "OUI"` means a
  free MAX seat is reservable), plus `data/meta.json` and `data/stations.json`.
- **Deep-link search** — build a URL with `?mode=&from=&to=&date=&conn=…`
  (modes: `from`, `to`, `od`, `tour`, `best`). Tour also takes `cities`, `dmin`/`dmax`,
  `maxkm`/`legkm`, `rg`; `od`/`best` take `flex`; `od` takes `via`. Full list in `api.json`.

## License

[MIT](./LICENSE).
