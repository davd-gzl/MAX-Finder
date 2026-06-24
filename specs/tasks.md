# Tasks — MAX JEUNE FOSS

Spec-Driven Development artifact. Ordered, checkable units.

## Phase 0 — Foundation
- [x] Repo scaffold: license, gitignore, package.json, tsconfig, vite config
- [x] SDD docs: constitution, spec, plan, tasks
- [x] Types + config + fixture data + station registry

## Phase 1 — Core logic (pure, unit-tested)
- [x] `dataset.ts`: load + normalize snapshot
- [x] `stations.ts`: registry + accent-insensitive autocomplete
- [x] `search.ts`: O/D/date/time/duration/card/type filtering
- [x] `destinations.ts`: origin → reachable destinations
- [x] `connections.ts`: single-hub journey finder
- [x] `calendar.ts`: 30-day availability
- [x] `roundtrip.ts`: round-trip / weekend pairing
- [x] Tests for all of the above

## Phase 2 — State & i18n
- [x] `store.ts`: state + URL deep-links + localStorage (favorites, watched, settings)
- [x] `i18n`: FR/EN dictionaries + `t()`

## Phase 3 — UI
- [x] App shell, search form (with autocomplete), results list
- [x] Map view (Leaflet) of destinations + routes
- [x] Calendar view; round-trip view
- [x] Favorites / watched routes; toasts; dark mode toggle
- [x] `.ics` export + SNCF Connect handoff
- [x] Accessibility pass (labels, focus, roles, contrast)

## Phase 4 — PWA & offline
- [x] manifest + icons + service worker (cache shell + last snapshot)
- [x] Local Web Notifications for watched routes (best-effort)

## Phase 5 — Data pipeline & deploy
- [x] `scripts/fetch-data.ts` (paginate SNCF API → data JSON + meta)
- [x] `.github/workflows/update-data.yml` (daily cron + commit)
- [x] `.github/workflows/deploy.yml` (build + Pages)

## Phase 6 — Verify & document
- [x] `npm test` green, `npm run build` green
- [x] Multi-lens review (correctness / a11y / security / UX) + fixes
- [x] MORNING_REPORT.md (decisions, how to enable Pages, live-data caveat, follow-ons)
