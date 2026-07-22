# User flows

The canonical map of what a user can do in MAX Finder and how each flow behaves. Keep
this in sync with the app — see the rule in `AGENTS.md` ("Living documentation"): any
change to a user-facing flow must update this file in the same PR.

## Top level: three tabs + a smart form

A user picks a tab, then fills the form. The tab plus which fields are filled decides the
search (`deriveMode` in `src/app.ts`; dispatch in `renderSearch`).

| Tab | Filled fields | Mode | Flow |
|-----|---------------|------|------|
| **Trip** (`simple`) | From + To | `od` | exact trip (one-way or round trip) |
| **Trip** | only From | `from` | browse / discovery *from* a station |
| **Trip** | only To | `to` | browse *into* a station |
| **Multi-city** (`multi`) | legs or cities | `tour` | a multi-stop tour |
| **Ideas** (`ideas`) | From | `best` | best destinations, ranked |

The **Round trip** toggle sits beside the date (`One-way / Round trip`; `r` toggles it).
`1/2/3` switch tabs. Day trip is not a separate mode — it is a same-day round trip.

## Trip tab

1. **From + To, One-way** → exact one-way trip (`runOdSearch`). A 30-day availability
   calendar for the route + the selected day's train list. Tap a green day to move; tap a
   train to book (direct → deep link; connecting → step-by-step).
2. **From + To, Round trip** → the merged flow (`runTripSearch`). Two-leg accordion:
   - **Leg 1 Outbound** — possible-days calendar collapsed as "Departure: <date> · Change";
     below it the day's outbound trains. Pick one → it collapses to a ✓ summary and…
   - **Leg 2 Return** opens (auto-scrolled in) — a return calendar whose **first cell is the
     same day** (hours on site), later cells are nights at the destination. Pick a return →
   - **Trip modal** = booking recap: one "Book this leg" per leg, or Save the whole trip.
3. **Only From, One-way** → browse (`runBrowse` "from"). Every destination reachable from the
   station, ranked by how well-served it is, with availability. Tap a card → the exact trip.
4. **Only From, Round trip** → discovery (`runGetaways`), "Where can you get away to?".
   Destinations ranked by **time at the destination** (hours on site if same-day is best,
   else nights) + a possible-start-days calendar. Tap a day → narrows to that day
   (auto-scrolls to results). Tap a destination → opens the round trip.
   - Ranking: `sortGetaways` puts most hours-on-site first for same-day trips.
   - A minimum-on-site gate exists in core (`minOnSiteMin`, default 4h); NOT yet exposed as
     an Advanced control. (Open item.)
5. **Only To** → reverse browse (`runBrowse` "to"): where you can come *from* to reach the
   station.

## Multi-city tab (tour)

- **Custom legs** — spell out each hop (from → to @ date). "Surprise me" fills a random
  reachable next stop; can build a whole trip from an empty editor.
- **Tour planner** — add cities to visit (or "Surprise" / "Nearest stop"), set days-per-city;
  it auto-orders a feasible tour. Save as a tour.

## Ideas tab (best)

Best free-MAX destinations from the origin, ranked (fastest / most-served / closest…),
either an all-days overview or one specific day. Tap → open the route.

## Cross-cutting (everywhere)

- **Map** — full-bleed behind a results drawer on mobile, side panel on desktop. Markers per
  destination, hover/selection synced with the list; route line for exact trips; auto-fits
  above the drawer on mobile.
- **Saved & Favorites** — star a route / save a trip, from the header menu. (The two overlap
  — a known cleanup item.)
- **Settings** — theme, MAX Jeune/Senior, comfortable/compact, and Low-end mode (map off +
  reduced motion + compact) with a one-time nudge on weak devices; language.
- **Mobile** — the form is a sheet that collapses to a search bar; results are a bottom-sheet
  drawer with detents. Back navigation preserves form state and never lands on a dead screen.
- **Deep links** — every search is a shareable URL; legacy `?rdate=` / `?rt=` links still work.
- **PWA** — installable; a "new version — reload" postcard on updates.

## Known open items (see docs/trip-redesign.md for the audit plan)

- Expose the minimum-time-on-site gate in Advanced (discovery).
- Collapse the two save systems (favorite star + Save bookmark) into one.
- One `openRoute()` primitive (list cards / favorites / map pins behave consistently).
- One home for the availability calendar (form popover vs results).
- Mobile browser-Back should close detail pages via history.
