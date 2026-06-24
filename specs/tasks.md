# Tasks — MAX JEUNE FOSS

Spec-Driven Development artifact. Ordered, checkable units.

## Phase 0 — Foundation
- [x] Repo scaffold: license, gitignore, package.json, tsconfig, vite config
- [x] SDD docs: constitution, spec, plan, tasks
- [ ] Types + config + fixture data + station registry

## Phase 1 — Core logic (pure, unit-tested)
- [ ] `dataset.ts`: load + normalize snapshot
- [ ] `stations.ts`: registry + accent-insensitive autocomplete
- [ ] `search.ts`: O/D/date/time/duration/card/type filtering
- [ ] `destinations.ts`: origin → reachable destinations
- [ ] `connections.ts`: single-hub journey finder
- [ ] `calendar.ts`: 30-day availability
- [ ] `roundtrip.ts`: round-trip / weekend pairing
- [ ] Tests for all of the above

## Phase 2 — State & i18n
- [ ] `store.ts`: state + URL deep-links + localStorage (favorites, watched, settings)
- [ ] `i18n`: FR/EN dictionaries + `t()`

## Phase 3 — UI
- [ ] App shell, search form (with autocomplete), results list
- [ ] Map view (Leaflet) of destinations + routes
- [ ] Calendar view; round-trip view
- [ ] Favorites / watched routes; toasts; dark mode toggle
- [ ] `.ics` export + SNCF Connect handoff
- [ ] Accessibility pass (labels, focus, roles, contrast)

## Phase 4 — PWA & offline
- [ ] manifest + icons + service worker (cache shell + last snapshot)
- [ ] Local Web Notifications for watched routes (best-effort)

## Phase 5 — Data pipeline & deploy
- [ ] `scripts/fetch-data.ts` (paginate SNCF API → data JSON + meta)
- [ ] `.github/workflows/update-data.yml` (daily cron + commit)
- [ ] `.github/workflows/deploy.yml` (build + Pages)

## Phase 6 — Verify & document
- [ ] `npm test` green, `npm run build` green
- [ ] Multi-lens review (correctness / a11y / security / UX) + fixes
- [ ] MORNING_REPORT.md (decisions, how to enable Pages, live-data caveat, follow-ons)
