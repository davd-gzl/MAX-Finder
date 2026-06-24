---
name: foss-serverless-app
description: >-
  Playbook for rebuilding an existing web tool as a free, open-source, serverless
  static app — autonomously, to a polished, reviewed result. Use when the user wants
  to clone/remake a site as FOSS they can self-host "forever", especially when the
  underlying data comes from a public/open API. Covers spec-driven scoping, a static
  no-backend architecture, a model cascade, a verification loop (build + tests +
  headless screenshot), and an adversarial multi-lens review (correctness, a11y,
  security, AND design).
---

# Build a FOSS, serverless remake — end to end

This is the method used to build `foss-maxjeune` (a MAX JEUNE / SENIOR train-seat
finder on SNCF open data). It generalizes to any "remake X as a FOSS static app" task.

## Core principles (decide these first)

1. **Serverless & free forever.** No backend, no DB, no paid infra. Ship static files
   on free hosting (GitHub Pages). Any feature needing a server is redesigned to be
   client-side or moved to a scheduled GitHub Action — or dropped.
2. **No accounts.** All personalization (favorites, settings, saved searches, watched
   items) lives in `localStorage` + shareable URL query params. This removes auth, the
   biggest source of complexity, security surface, and privacy/RGPD burden.
3. **The data is the moat, and it's often free.** Before building, find out whether the
   "hard part" is a public dataset/API. If so, the app is just a good frontend over it.
4. **Correctness must be machine-checkable.** Pure functions + unit tests are the
   verifier that makes autonomous/unattended work trustworthy. Never claim done until
   `tsc` + tests + build are green.
5. **Honest framing, no marketing.** State what it is plainly; link out to the official
   site for the real transaction. No catchphrases, no "at a glance" fluff.

## Architecture that avoids the usual traps

- **Static site** (Vite + TypeScript + a small map lib). Deploy to Pages at a sub-path;
  set Vite `base` and keep all asset/data URLs base-relative.
- **Data as a committed snapshot.** A scheduled Action snapshots the open dataset into
  `public/data/*.json`; the app `fetch`es that same-origin JSON. This **sidesteps CORS
  entirely** and means the site never hard-depends on the upstream API being up. Ship a
  small realistic **fixture** so the app (and tests) work fully offline.
- **Match the refresh cadence to the source.** If the upstream data only updates ~daily,
  polling more often is wasted — schedule the Action just after the upstream refresh
  (twice for safety), not on an arbitrary timer.
- **Pages deploy gotcha:** bot pushes (GITHUB_TOKEN) don't re-trigger workflows, so give
  the deploy workflow its own `schedule` (and a best-effort `fetch-data` step) rather
  than relying on the data-commit push to redeploy.
- **Served data must live under `public/`** or the bundler won't include it.

## Process

1. **Scope with spec-driven development.** Write `specs/constitution.md` (non-negotiable
   principles), `specs/spec.md` (what/why, acceptance criteria), `specs/plan.md` (how,
   module map), `specs/tasks.md` (ordered checkable units). These keep an autonomous run
   on-rails and make the repo contributor-friendly. (GitHub Spec Kit's flow; emulate the
   artifacts even without the CLI.)
2. **Model cascade — spend the expensive model where it pays.** Strong model (Opus) for
   architecture, the hardest algorithm, and the final review; cheaper models (Sonnet/
   Haiku) for mechanical/peripheral work. The rule: expensive where the decision has high
   leverage and low token volume (the plan, the verdict); cheap on high-volume edits.
3. **Fan out the independent pieces.** Lay the shared contracts/types + fixtures first,
   then run parallel subagents on disjoint files (e.g. data pipeline + CI in one, PWA in
   another) while you build the core yourself for coherence. Give each agent strict file
   ownership so they don't collide.
4. **Verification loop = the stop signal.** After each milestone: `tsc --noEmit`, unit
   tests against the fixture, `vite build`, and a **headless screenshot** (see below).
   Loop-until-green; cap iterations.
5. **Adversarial multi-lens review — including design.** Spawn separate reviewers, each
   with one lens: correctness, accessibility, security, AND a **visual-design** reviewer
   that actually *reads the rendered screenshots* + the CSS and critiques like a senior
   designer. Triage to high-confidence findings, fix, re-verify.
6. **Commit and push after every milestone.** The work env is ephemeral; anything not
   pushed is lost. Small, descriptive commits; never push to a non-feature branch.

## Headless screenshots without a system browser

The sandbox often has no browser and the browser CDN is egress-blocked. Working recipe:

- `npm i -D puppeteer-core @sparticuz/chromium` — the Chromium binary ships *inside* the
  npm package (from the allowed npm registry), so no blocked CDN download.
- Serve `dist/` from an **in-process Node HTTP server on a random port** inside the
  screenshot script (no `vite preview` — its child process outlives `kill` and leaves
  zombies that collide on ports and serve stale builds).
- Launch with `--no-proxy-server` AND a fresh `userDataDir`; Chromium otherwise routes
  `localhost` through the egress proxy (→ 404) and caches it. Map base-path requests
  (`/<base>/...`) to `dist`.
- Expose it as `npm run screenshot`; commit the PNGs and reference them in the README.

## Design quality bar (what "not AI-looking" means here)

- One restrained palette: near-black ink + a **single** accent color used **everywhere**
  (UI, app icon, `theme-color`, manifest, map markers). A leaked second/third accent
  (e.g. amber for "saved") is the classic templated tell — unify it.
- Hairline borders, minimal/no drop shadows, tight radius, real typographic hierarchy,
  tabular numerals for times. A solid ink primary button reads more premium than a
  gradient.
- **Dense by default.** Result lists are single scannable rows (name · count · duration)
  with an inline expander — not bulky cards. Empty states are one muted line, not a big
  dashed box.
- Drop redundant labels (if every shown item is "MAX", don't chip every row with "MAX").
- A11y is part of design: visible focus rings on every interactive element, ≥24px (aim
  44px) touch targets, accessible names that aren't verbose, keep `aria-label`/
  `aria-pressed` in sync on toggle, manage focus to the results heading on re-render.

## Anti-patterns to avoid

- Don't pin a whole run on installing an external CLI/browser over a restricted network —
  have a fallback (emulate artifacts; bundle the browser via npm).
- Don't let a cheap model thrash without a verifier; the test/build/screenshot gate is
  what makes looping safe.
- Don't add marketing copy or gimmick features ("surprise me") unless asked.
- Don't claim a screenshot/build works without actually rendering/running it — verify.
</content>
