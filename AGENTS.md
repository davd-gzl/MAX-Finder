# Agent guidelines

## Commit and pull request conventions

- Do **not** add Claude/AI attribution to commits or pull requests. Specifically, omit:
  - `Co-Authored-By: Claude ...` trailers
  - `Claude-Session: ...` trailers
  - "🤖 Generated with Claude Code" / "Assisted by Claude" lines in PR bodies
- Write commit messages and PR descriptions as plain, human-authored text with no AI-assistant footer.

## Merge conventions

- Merge pull requests with **squash and merge** (keep `main` history one commit per PR).
- Preserve human co-authorship: when a change originates from someone else's work, keep their
  `Co-authored-by: Name <email>` trailer in the squashed commit so they're credited.

## Product constitution (durable principles — do not violate)

These are the standing rules for every change. When a decision is unclear, pick the option
that best satisfies these, in order:

1. **Intuitive and easy above all.** A first-time user must understand each screen without
   thinking. Simplicity and obviousness beat cleverness and feature density.
2. **Zero truncated text on mobile — anywhere.** No station name, chip, duration, count, or
   heading may be clipped at ≤390px. Text wraps and fits; it is never cut off with an
   ellipsis or overflow. Verify at 390px with long names (e.g. Saint-Pierre-des-Corps,
   Aix-en-Provence TGV).
3. **Efficiency over casual framing.** This is a power-user tool. Prefer direct, efficient
   controls over cute/casual copy and presets (avoid "this weekend / next week"-style
   framing). Minimise clicks; never ask the same thing twice.
4. **Performance is a feature, and it must degrade gracefully.** Keep heavy work off the
   main thread and prefer algorithmic fixes over hiding cost. Low-end devices/users must
   always have a working escape hatch (Settings → low-end mode: reduced motion, map off,
   compact) that meaningfully removes lag. If something lags, the low-end setting must cover
   it.
5. **No feature may break 1–3** to satisfy 4 (or vice versa).

## Living documentation (keep these current)

- **`docs/user-flows.md`** is the canonical map of every user flow. Whenever a change alters
  a user-facing flow — a new/removed mode or tab, a changed screen, a different navigation or
  booking path — UPDATE `docs/user-flows.md` in the SAME change. Read it before touching flow
  code so the doc and the app never drift.
- **`docs/trip-redesign.md`** is the design record + audit plan for in-flight UX work; update
  it as decisions land.

## Glossary & essential knowledge

- **Trip flow (unified):** one flow focused on the **destination and time spent there**.
  `0 days` = there and back the same day → **hours on site**; `1/2/3+ days` = **nights** at
  the destination. This replaces the older separate "Day trip" / "Round trip" modes.
- **Two user intents the flow serves:**
  - *Duration-first* — "I have N days / a day, where can I go?" → origin-only **discovery**,
    ranked by time at the destination.
  - *Commitment-first* — "I'm going there, when can I come back?" → outbound date + return
    calendar.
- **Calendar roles (so neither feels duplicated):** the **outbound** calendar is a compact
  "your departure" quick-switcher (tap a green day to move the trip; availability at a
  glance) — it mirrors the form date, it does not re-ask it. The **return** calendar is the
  "when can you come back?" decision. Same-day needs no return calendar. Collapse the
  calendar once trains are selected.
- **Discovery** = the origin-only state; it must never be a dead-end or a blank screen.
- **i18n:** `fr.ts` is canonical; `type Dict = typeof fr`; all 11 locales
  (fr, en, es, de, it, ko, zh, ja, nl, pt, ar) are typed `: Dict`, so every new key must be
  added to all 11 or `tsc` fails. Keep placeholder syntax consistent.
- **Build gates:** strict TS (`noUnusedLocals` / `noUnusedParameters`), `npx tsc --noEmit`,
  `npm test` (vitest), `npm run build`, `npm run test:e2e`. All must pass before a commit.
- **Architecture notes:** hand-rolled DOM via `el()` (no framework); search compute runs on
  a background worker that warms shared connection caches (`src/search/*`, `queryOpts.ts`);
  browse reachability is one multi-target sweep, never per-candidate; long result lists
  render incrementally. The durable design record for in-flight UX work is
  `docs/trip-redesign.md`.
- **Durability:** the runtime is an ephemeral container that re-clones from git and can reset
  between turns. Only pushed commits survive. Commit and push work promptly; keep standing
  decisions in this file and in `docs/trip-redesign.md`, not only in the ephemeral task list.
