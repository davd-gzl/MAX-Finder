# MAX Finder

**Find every SNCF train where a free MAX JEUNE / MAX SENIOR (ex-TGVmax) seat is actually reservable — without probing SNCF Connect station by station.**

### ▶ [**Try it live — davd-gzl.github.io/MAX-Finder**](https://davd-gzl.github.io/MAX-Finder/)

Free · open-source · **serverless**. No backend, no accounts, no cost — it all runs in your browser. Built on SNCF open data (the [`tgvmax`](https://ressources.data.sncf.com/explore/dataset/tgvmax/information/) dataset).

> Independent open-source tool — **not affiliated with SNCF, not a ticket seller**. Availability is indicative and refreshed ~daily; always confirm and book on [SNCF Connect](https://www.sncf-connect.com/).

If you hold a MAX JEUNE or MAX SENIOR pass, high-speed trains are free — *but only when a MAX seat is still open on that train*. Normally you'd guess routes one at a time (Paris → Lyon? Paris → Bordeaux?…) just to find where those seats exist. **MAX Finder flips it around: pick a station and the whole map lights up with everywhere you can go for free.**

---

## See it

| | |
| --- | --- |
| [![Tour — multi-city day-by-day itinerary built from a chip input, each leg with Book, calendar and map buttons](docs/screenshots/tour.png)](docs/screenshots/tour.png) | [![Où partir — every destination reachable with a free MAX seat, ranked by availability, beside a Leaflet map of France](docs/screenshots/from.png)](docs/screenshots/from.png) |
| **Tour** — chain several cities into one free itinerary | **Où partir** — everywhere you can go, ranked by availability |
| [![Idées — the fastest destinations reachable that day](docs/screenshots/best.png)](docs/screenshots/best.png) | [![Trajet précis — exact origin-to-destination route with a 30-day availability calendar highlighting bookable dates](docs/screenshots/trip.png)](docs/screenshots/trip.png) |
| **Idées** — fastest destinations that day | **Trajet précis** — exact route + 30-day calendar |

<p>
  <img src="docs/screenshots/mobile.png" alt="MAX Finder running as an installable PWA on mobile, in a compact single-column layout" height="360">
  <img src="docs/screenshots/arabic.png" alt="MAX Finder in Arabic with a fully mirrored right-to-left interface, proving multilingual support" height="360">
</p>

---

## What you can ask it

- **"Where can I go this weekend?"** → *Où partir*: pick your city, see every free-MAX destination, ranked by how well-served it is.
- **"How do I get *to* this town for free?"** → *D'où venir*: pick a destination, see every origin that reaches it.
- **"When is my exact route free?"** → *Trajet précis*: connections plus a 30-day calendar, with a round-trip / weekend-getaway finder.
- **"I have no plan — surprise me."** → *Idées*: the fastest destinations reachable that day.
- **"Plan me a multi-city trip."** → *Tour*: chain cities into one day-by-day itinerary, each hop on a free MAX seat.

## Features

| | |
| --- | --- |
| **Connections** | Multi-leg up to 6 changes via hubs, optional **Via** stopover, overnight-stopover mode |
| **Round trips & night trains** | Round trips pair the earliest-arriving outbound with the latest feasible return to maximize time there; night mode covers genuine *Intercités de Nuit* only |
| **Filters** | Time window, max duration, MAX JEUNE vs SENIOR, train type, region |
| **Map** | Leaflet map of every station, with correspondences plotted as intermediate points; click to select |
| **Search & share** | Explicit run (`Enter`/`g`), back nav (`Esc`), **Au hasard** random city, ICS calendar export, shareable URLs |
| **Private by default** | No accounts — favorites, settings and searches in `localStorage`; optional local notifications |
| **Everywhere** | 11 languages (FR EN ES DE IT KO ZH JA NL PT AR, incl. RTL), light/dark, installable offline PWA, mobile, accessible |

---

## Why it can be free forever

The hard part — *which trains actually have a free MAX seat* — is published by SNCF as open data. MAX Finder is a pure frontend over it:

- A scheduled **GitHub Action** snapshots the dataset each morning into `public/data/tgvmax.json`, keeping only the trains with a free seat (trimming the raw ~77 MB feed down to ~6 MB).
- Your **browser** downloads that file and does all the searching on your device — it can also query the SNCF API directly as a fallback.
- Everything is static files on **GitHub Pages**. No backend, no database, no server bill, nothing to quietly shut down.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173  (uses the committed data snapshot / fixture)
npm test         # unit tests, no network needed
npm run build    # type-check + static build -> dist/
```

<details>
<summary><strong>Repository layout</strong></summary>

```
public/data/ committed daily snapshot (tgvmax.json + meta.json), served at /data/
data/        station registry + a small fixture for dev/tests
src/core     pure search / connections / calendar logic (unit-tested)
src/data     dataset loading + station lookup (+ DatasetProfile seam)
src/ui       rendering (search form, results, map, calendar)
scripts/     fetch-data.ts — used by the daily Action
.github/     update-data (cron) + deploy (Pages) workflows
docs/        how-it-works.md, algorithms.md (plain-language guides) + screenshots
specs/       constitution.md (guiding principles)
```

</details>

## Docs & roadmap

- **[How it works](docs/how-it-works.md)** — plain-language tour of the app, its data, and why it runs free with no server or account.
- **[Algorithms](docs/algorithms.md)** — how it actually finds trains (free-seat filter, connections, one-pass sweeps, round trips, tours, gare naming) with diagrams.
- **[Vision / roadmap](VISION.md)** — V1 today is SNCF, done well; V2 adds Deutsche Bahn, Renfe and more of Europe into the same search. Principles in [`specs/constitution.md`](./specs/constitution.md).

## For agents / data API

Machine-readable and serverless — [`llms.txt`](public/llms.txt) and [`api.json`](public/api.json) describe the data + query API for AI agents.

- **Availability** — the deployed site serves `/data/tgvmax.json` (records where `od_happy_card: "OUI"` means a free MAX seat is reservable), plus `/data/meta.json` and `/data/stations.json`.
- **Deep-link search** — build a URL with `?mode=&from=&to=&date=&conn=…` (modes: `from`, `to`, `od`, `tour`, `best`). Full parameter list in [`api.json`](public/api.json).

## Data & license

**Data:** [SNCF Open Data — Disponibilité à 30 jours de places MAX JEUNE et MAX SENIOR](https://ressources.data.sncf.com/explore/dataset/tgvmax/information/), licensed under the [Licence Ouverte / Open Licence](https://www.etalab.gouv.fr/licence-ouverte-open-licence). Availability is updated roughly once a day and is **indicative** — always confirm and book on [SNCF Connect](https://www.sncf-connect.com/). This project does not sell tickets and is not affiliated with SNCF.

**Code:** [MIT](./LICENSE).
