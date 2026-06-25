# Specification — MAX Finder

Spec-Driven Development artifact. Describes **what** and **why**, not implementation details.

## Problem

MAX JEUNE / MAX SENIOR subscribers get free TGV INOUI & INTERCITÉS travel but must reserve a
limited quota of "MAX" seats per train. Finding which trains still have a free MAX seat means
tediously probing SNCF Connect station by station. Users want to see, at a glance, every
reservable MAX seat for their situation.

## Users

- A subscriber with a fixed origin asking *"where can I go for free, and when?"*
- A subscriber with a fixed trip (A → B on a date) asking *"is there a free MAX seat?"*
- A flexible traveller asking *"which day this month has a free seat on this route?"* or
  *"a free round-trip for a weekend away?"*

## Scope of v1 (this build)

### Must have
1. Load the daily `tgvmax` snapshot (committed JSON); show its freshness timestamp.
2. **Origin → destinations**: pick an origin (+ date) → list every destination with a free MAX
   seat, with departure/arrival times and train number.
3. **O-D search**: origin + destination + date → matching free-MAX trains.
4. **Reverse search**: destination (+ date) → origins that can reach it for free.
5. **Filters**: MAX JEUNE vs MAX SENIOR; time-of-day window; max travel duration; train type.
6. **Multi-leg connections**: when no direct free-MAX train exists, find a journey via one hub
   (configurable hub list) with a sane connection buffer.
7. **30-day availability calendar** for a chosen O-D route.
8. **Round-trip / weekend finder**: outbound + return both on free MAX within a date window.
9. **Map** of reachable destinations with route lines (Leaflet).
10. **Station autocomplete**: accent-insensitive, alias-aware (e.g. "paris" → all Paris stations).
11. **Client-side personalization**: favorites & watched routes (localStorage); shareable
    deep-link URLs that fully restore a search; FR/EN; dark mode; settings persistence.
12. **PWA**: installable, offline shell, cached last snapshot.
13. **Booking handoff**: deep link to SNCF Connect; `.ics` calendar export for a chosen train.

### Should have
- Local **Web Notifications** for a watched route when the daily snapshot newly opens it.
- "Surprise me" random reachable destination.

### Explicitly out of scope
- **User accounts / login / server-stored data** (constitution §2).
- Real-time (sub-daily) availability or server push notifications.
- Actually selling or holding tickets.
- Fare/price display beyond the free-MAX boolean.

## Data model (from the SNCF `tgvmax` dataset)

Each record ≈ one train, one O-D, one date:
`date`, `origine`, `destination`, `heure_depart`, `heure_arrivee`, `train_no`,
`od_happy_card` (`OUI` = MAX seat available, `NON` = not), and train axis/type when present.
Coverage: next ~30 days, TGV INOUI + INTERCITÉS, MAX JEUNE + MAX SENIOR. Refreshed ~daily.

## Acceptance criteria

- Selecting an origin with a known free-MAX destination in the data lists that destination
  with correct times. (unit-tested against fixtures)
- A connection is returned only when both legs are free-MAX, share the hub, and the layover is
  within `[minConnectionMin, maxConnectionMin]`; arrival of leg 1 precedes departure of leg 2.
  (unit-tested)
- The calendar marks a day "available" iff ≥1 free-MAX train exists for that O-D that day.
- A shared URL reproduces the exact same search and results on another device.
- No network call is required for the app to render results from the committed snapshot.
- Lighthouse a11y ≥ 90; keyboard-only flow can complete a search.
