# Implementation Plan — MAX Finder

Spec-Driven Development artifact. The **how**.

## Stack
- **Vite + TypeScript** (strict) — static build, no framework needed, small bundle.
- **Leaflet** — map.
- **Vitest + jsdom** — unit tests for pure logic and DOM-light UI helpers.
- **GitHub Actions** — daily data snapshot + Pages deploy.
- No runtime backend. Deployed to GitHub Pages at base path `/MAX-Finder/`.

## Module layout
| Area | Files | Responsibility |
|---|---|---|
| Types | `src/types.ts` | `MaxTrain`, `Station`, `SearchQuery`, `Journey`, `Leg`, enums |
| Config | `src/config.ts` | API URL, hub stations, connection buffers, defaults |
| Data | `src/data/dataset.ts` | load snapshot JSON (+ optional live API), normalize records |
| Data | `src/data/stations.ts` | station registry, coords, accent-insensitive autocomplete |
| Core | `src/core/search.ts` | filter trains by O/D/date/time/duration/card/type |
| Core | `src/core/destinations.ts` | origin → reachable destinations (direct) |
| Core | `src/core/connections.ts` | multi-leg journeys via hubs |
| Core | `src/core/calendar.ts` | 30-day availability for an O-D |
| Core | `src/core/roundtrip.ts` | round-trip / weekend pairing |
| State | `src/state/store.ts` | app state, URL (de)serialization, localStorage persistence |
| i18n | `src/i18n/*` | FR/EN dictionaries + `t()` |
| UI | `src/ui/*` | search form, results list, map, calendar view, favorites, toasts |
| PWA | `public/manifest.webmanifest`, `src/pwa/sw.ts` | install + offline shell |
| Script | `scripts/fetch-data.ts` | paginate SNCF API → write `data/tgvmax.json` + `meta.json` |
| CI | `.github/workflows/*` | `update-data.yml` (cron), `deploy.yml` (Pages) |

## Key algorithms
- **Normalization**: parse `HH:MM`/`HH:MM:SS` to minutes; treat arrival < departure as +1 day;
  keep only `od_happy_card === "OUI"` for availability queries (retain all for stats).
- **Connections**: index free-MAX legs by `(origine)` and `(destination)`; for query A→B on day
  D, for each hub H with A→H and H→B both free-MAX, pair legs where
  `dep(H→B) - arr(A→H) ∈ [minConn, maxConn]`. Rank by total time, then fewest minutes waiting.
  v1 = one hub (single connection); structure allows extension to two.
- **Calendar**: group snapshot by date for the O-D; a date is available iff any free-MAX train.

## Constraints handled
- **No live network in CI dev container** → app reads committed `data/tgvmax.json`; a realistic
  `data/tgvmax.sample.json` fixture drives dev + tests; the Action provides real data in prod.
- **CORS uncertainty** on the live API → snapshot-in-repo is the primary path; live fetch is a
  best-effort enhancement guarded by try/catch with graceful fallback.
- **GitHub Pages sub-path** → Vite `base` set for build; all asset/data URLs are base-relative.

## Verification strategy
- Unit tests for every `src/core/*` function against fixtures (deterministic, offline).
- `tsc --noEmit` typecheck + `vite build` must pass.
- Manual/checklist: keyboard flow, dark mode, URL round-trip, PWA install, a11y pass.
- Live-data path is verified in the browser / by the Action (cannot run in this container).
