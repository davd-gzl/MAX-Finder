# Constitution — MAX Finder

Non-negotiable principles that govern every decision in this project. (Spec-Driven Development,
GitHub Spec Kit methodology.)

## 1. Serverless & free forever
No backend, no database, no paid infrastructure. The app must run as static files on free
hosting (GitHub Pages) and keep working indefinitely at zero cost. Any feature that would
require a server is redesigned to be client-side or scheduled (GitHub Actions), or dropped.

## 2. No accounts, privacy by default
No login, no user database, no PII, no tracking. All personalization (favorites, settings,
saved searches, watched routes) lives in the browser (localStorage) or in shareable URLs.
This keeps the app RGPD-free and removes auth as an attack surface.

## 3. Open data, honest framing
The single source of truth is the public SNCF `tgvmax` open dataset. The app is a viewer of
indicative availability — **not** a ticket seller and **not** affiliated with SNCF. Every
screen makes that clear and links out to SNCF Connect for booking.

## 4. Correctness is checkable
Core logic (search, connections, calendar) is written as pure, deterministic functions and
covered by unit tests against fixture data. Nothing about availability is invented: if the
data doesn't say a seat is free, the app doesn't claim it is.

## 5. Resilient to the data source
The site reads a committed daily JSON snapshot so it never hard-depends on the live API being
up or CORS-enabled. A live-API path exists as an enhancement/fallback, never as a requirement.

## 6. Accessible, fast, international
Mobile-first, keyboard-navigable, screen-reader friendly (WCAG AA targets). Small bundle.
French and English from day one (French is the primary audience).

## 7. FOSS and contributor-friendly
MPL-2.0 licensed. Readable code that matches its own conventions. Spec/plan/tasks kept in the repo
so contributors understand intent before code.
