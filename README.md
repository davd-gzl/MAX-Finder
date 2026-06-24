# MAX JEUNE FOSS

A free, open-source, **serverless** finder for trains where a **MAX JEUNE** / **MAX SENIOR**
(ex-TGVmax) seat is currently reservable — so you don't have to probe station-by-station in
SNCF Connect.

> An independent, open-source tool — not affiliated with SNCF, not a ticket seller.
> Availability is indicative and refreshed daily from public open data.

## Screenshots

| Where can I go? (origin → destinations + map) | Exact trip (direct + connections + calendar) |
| --- | --- |
| ![Origin search](docs/screenshots/from.png) | ![Trip search](docs/screenshots/trip.png) |

## Why

The hard part — *which trains actually have a free MAX seat* — is published by SNCF as
open data (the [`tgvmax` dataset](https://ressources.data.sncf.com/explore/dataset/tgvmax/information/)).
This app is a nice, fast frontend over that dataset. No backend, no accounts, no cost.

## Features

- **Origin → reachable destinations** with a free MAX seat, and the times.
- **Full O-D search** (origin + destination + date) and **reverse search** (destination → origins).
- **Multi-leg connections**: finds journeys via a hub when no direct MAX train exists.
- **30-day availability calendar** for a route; **round-trip / weekend-getaway** finder.
- **Filters**: time window, max duration, MAX JEUNE vs MAX SENIOR, train type.
- **Map** of reachable destinations (Leaflet).
- **No accounts** — favorites, settings and saved searches live in your browser
  (localStorage + shareable URLs). Optional **local notifications** for watched routes.
- **i18n** (FR / EN), dark mode, installable **PWA**, accessible.

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

## License

[MIT](./LICENSE).
