# Trip flow redesign — working notes

Living design doc for the round-trip / day-trip rework and the surrounding UX fixes.
Captures the decisions made with David so they survive across sessions. Not final —
updated as the audit lands and choices are confirmed.

## Guiding principles (non-negotiable)

1. **Intuitive and easy above all.** A first-time user should understand each screen
   without thinking. Every design choice is measured against that.
2. **Zero truncated text on mobile — anywhere.** No station name, chip, duration,
   count, or header may be clipped at 390px. Text wraps and fits; it is never cut off.
3. Durable > clever: the app is a power-user tool, but never at the cost of 1 or 2.

## The trip flow: two intents, one surface

The redesign collapses the separate **Day trip** and **Round trip** modes into a single
flow, focused on the **destination and how much time you can spend there**. It serves
two distinct user intents:

- **Duration-first** — *"I have N days (or a day) — where can I go?"* You know the time
  budget and want destinations. → origin-only **discovery**, ranked by time at the
  destination.
- **Commitment-first** — *"I'm going there — when can I come back?"* You know the place
  and the departure and want the return.

`0 days = same day` is simply the shortest case of the same flow (there and back today →
shown as **hours on site**); `1 / 2 / 3+ days` = nights there.

### The two calendars, reframed by role (so neither feels duplicated)

The "duplicated calendar" feeling came from the **outbound** calendar re-asking a date
already set in the form. But the outbound calendar isn't pure duplication — its real
value is **hopping the departure to another day by tapping**, and seeing which days even
have seats. So we keep it, but reframe it:

- **Outbound → a compact "your departure" quick-switch strip.** Tap a green day to
  *move* the trip; availability at a glance. Reads as a switcher, not a second date
  question. Mirrors the form date, doesn't re-ask it.
- **Return → the fuller "when can you come back?" calendar.** The real decision. Each
  return day shows a real return and implies how many days/nights you'd get there.
- **Same-day** → no return calendar (you come back today → hours on site).
- **Origin only** → duration-first discovery: "with this much time, here's where you
  can go", ranked by time at destination. Never a dead-end.

### Efficiency, not casual (David: "I don't like the weekend / next week… it's casual,
### I want efficiency")

- Drop the casual window-preset chips ("This weekend / Next 7 days / This month"). Use the
  **same efficient date + number-of-days controls** as the rest of the flow, so discovery
  and a concrete trip share one mental model. No cute presets; direct controls.
- If any of this still lags on weak devices, the **low-end setting** (Settings → low-end
  mode) must cover it — that's the escape hatch, per the constitution.

### Interaction

- **Departure date is chosen once** (form / the departure strip mirrors it).
- **When trains are selected, the calendar collapses** out of the way — not left sitting
  there as a duplicate after you've chosen.
- Legacy `?rdate=` / `?rt=` deep links keep working.

> Status: David delegated the final shape to me ("give me suggestions and upgrade it the
> way you think"). I'll bring ONE concrete proposal to react to before the big build.

## UX fixes batch (not controversial — implement directly)

From David's testing on a real phone:

1. **Zero-truncation sweep (crucial).** Every `text-overflow: ellipsis` /
   `white-space: nowrap` / fixed-width label in `styles.css` + the render layouts.
   Verify at 390px with long names (Saint-Pierre-des-Corps, Aix-en-Provence TGV…).
2. **Map hidden under the drawer.** `fitBounds` fits markers to the full map height, but
   the bottom-sheet drawer covers ~55% on mobile, so destinations (southern France) sit
   under the drawer. Add drawer-aware bottom padding to `fitBounds`
   (`src/ui/map.ts` `show()` / `route()`).
3. **Truncated destination names in list cards.** The hours-on-site + count chips eat the
   width, squeezing the name to "Arr…", "Le Creus…". Give the name priority; wrap chips.
   (`getawayCityRowEl` / `groupCardEl` in `src/ui/render.ts` + CSS.)
4. **Auto-scroll on below-fold updates.** Tapping a date / week chip filters the list but
   gives no visible feedback on mobile. Auto-scroll the drawer to reveal the updated
   results — and anywhere content updates below the fold (date pick, filter change, leg
   hand-off).
5. **Dead "MAX Finder" back-nav screen.** Returning on mobile lands on the search-bar
   placeholder + an armed prompt with nothing useful. Show something real instead.
6. **State reset on navigation.** Opening another page (saved trips, favorites, a
   drill-in) and coming back resets the main form + search. Preserve it.
7. **Find & remove all duplicated actions** (the audit's main job).

## Already shipped this cycle (on `main` unless noted)

- Round-trip redesign v1 (One-way / Day trip / Round trip) — the version being reworked.
- Low-end master toggle + one-time slow-device nudge; app-update postcard.
- "Surprise me" in the custom-legs editor.
- Browse freeze fix: per-candidate DFS → one-pass sweep (15 s → ~0.1 s).
- Search compute moved to a background worker (main-thread blocking ~3–5× lower).
- Incremental (chunked) rendering of long result lists. *(pushed, not yet in a PR)*

## Audit results (concrete plan)

The audit found everything traces to **3 root causes**:

1. **Duplication** — two save systems (favorite star + Save bookmark); day-trip and
   round-trip are the *same* 2-leg accordion forked by one `isDay` boolean; three
   divergent "open a route" handlers (`onOpenRoute` runs, `fillRoute` prefills,
   `selectStation` highlights); the outbound date collected in the form field **and**
   re-asked as a Leg-1 calendar; the availability calendar rendered in both the form
   popover and the results.
2. **Dead screens + state reset** — the mobile screen is chosen by
   `setMobileForm(!store.urlHasQuery())`, but `urlHasQuery()` is *always* true
   (`queryToParams` always writes `mode`), so Back/reload to an origin-less query forces
   the results view onto `runArmedPrompt`/`showHint`, which set an empty title → the bar
   falls back to the "MAX Finder" placeholder. And `goBack` restores the last *searched*
   query via `syncFormFromQuery`, wiping staged (un-searched) form edits.
3. **Mobile discovery** — `fitBounds` uses a uniform pad with no knowledge of the ~30vh
   drawer (pins hide under the sheet); the 3-item non-wrapping `.dest-meta` row truncates
   names; `refreshInPlace` saves/restores `window.scrollY` but results live in
   `.drawer-scroll`, so a date/chip tap updates silently below the fold.

### Round-trip verdict: MERGE (matches David's direction)

Day trip is literally a 0-night round trip. Collapse the segments to **One-way / Round
trip**. Ask the **departure date once** (form). Build **one return calendar starting at
`query.date`** so its first cell is same-day (reuse the day-trip same-day feasibility
filter); a 0-night cell shows hours-on-site, later cells show nights. Day vs round is then
self-evident from the cell you tap — no separate mode. Keep a **compact outbound
day-switcher** (David: quick date change has value) rather than a full duplicate calendar.
The trip modal becomes a **confirmation/booking** screen: one "Book this leg" primary per
leg, direct trains deep-link straight (no nested modal).

### Prioritized work list

1. `queryIsRenderable(q)` for the mobile screen decision everywhere + real titles → kills
   the "MAX Finder" dead screen. `[M]`
2. Preserve form state across navigation: `navStack` carries `{query, form}`; restore the
   live form in `goBack`. `[M]`
3. Merge day→round: One-way/Round-trip, one return calendar with same-day first cell. `[L]`
4. Ticket flow → confirmation/booking screen, one Book per leg. `[L]`
5. Map: asymmetric pixel padding reserving the drawer height. `[S]`
6. Mobile feedback: `refreshInPlace` scrolls `.drawer-scroll` + auto-scroll to the count. `[S]`
7. Truncated names: `.dest-meta` wraps; full truncation sweep at 390px. `[S]`
8. One save system (retire favorites into saved-trips). `[M]`
9. One `openRoute(o,d,{run})` primitive + one back-button helper + real history for detail pages. `[M]`
10. One home for the availability calendar. `[M]`
11. Minor de-dup: `allDaysLinkEl` helper, Surprise/Nearest, legs-clear label, one book affordance/card. `[M]`

## How this is tracked

- This doc = durable design record (survives container resets).
- Task list = live work items (ephemeral; may reset with the container).
- Audit workflow output = the concrete, code-level fix plan feeding the above.
