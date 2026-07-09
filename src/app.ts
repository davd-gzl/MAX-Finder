import type { Dataset } from "./data/dataset";
import { StationRegistry } from "./data/stations";
import type { SearchQuery, SearchMode, MaxTrain, Journey, SortKey } from "./types";
import {
  reachableDestinations,
  reachableOrigins,
  reachableGroups,
  windowStats,
} from "./core/destinations";
import { filterTrains, isNightTrain } from "./core/search";
import { bestTrips, bestTripsAcrossWindow, stationsOnDate, reachableBest, type ReachTrip } from "./core/best";
import { getawaysAcrossWindow, getawayIdeas } from "./core/getaways";
import { planTours, planTourInOrder, planTourGreedy, arrivalDate, type Tour } from "./core/tour";
import { findJourneys, bestJourney, reachableJourneys, journeySpanDays, MAX_RESULTS } from "./core/connections";
import type { ConnectionOptions } from "./core/connections";
import { availabilityCalendar, reachableCountCalendar, destinationCalendar, dateRange } from "./core/calendar";
import { addDays, dayIndex } from "./util/time";
import { haversineKm } from "./util/geo";
import { el, clear, optionEl, isTouch } from "./ui/dom";
import { buildShell, applyTheme, closeHeaderMenu } from "./ui/shell";
import type { RouteMap, MarkerInfo } from "./ui/map";
import * as render from "./ui/render";
import type { RenderCtx } from "./ui/render";
import { journeyToIcs, downloadText } from "./ui/ics";
import {
  showInfoModal,
  showBookingModal,
  showTripModal,
  showMultiTripModal,
  showTourModal,
} from "./ui/modals";
import { generateBookingUrl } from "./util/booking";
import { t, setLang, getLang, isLang } from "./i18n";
import * as store from "./state/store";
import {
  MAX_JEUNE_URL,
  MAX_SENIOR_URL,
  GITHUB_URL,
  GITHUB_ISSUES_URL,
  OVERNIGHT_MAX_CONNECTION_MIN,
  HUB_STATIONS,
} from "./config";
import { notify } from "./pwa/register";

interface Deps {
  trains: MaxTrain[];
  meta: Dataset["meta"];
  registry: StationRegistry;
}

interface Refs {
  modeTabs: HTMLElement;
  ideasBtn: HTMLElement;
  modeDesc: HTMLElement;
  origin: HTMLInputElement;
  destination: HTMLInputElement;
  date: HTMLInputElement;
  dateField: HTMLElement;
  departDate: DateFieldCtl;
  legsBlock: HTMLElement;
  surpriseBtn: HTMLElement;
  endDate: HTMLInputElement;
  endDateField: HTMLElement;
  card: HTMLSelectElement;
  departAfter: HTMLInputElement;
  departBefore: HTMLInputElement;
  arriveBefore: HTMLInputElement;
  maxDuration: HTMLInputElement;
  maxSpanDays: HTMLInputElement;
  maxSpanDaysField: HTMLElement;
  radius: HTMLInputElement;
  radiusField: HTMLElement;
  trainType: HTMLSelectElement;
  maxConnections: HTMLSelectElement;
  connGroupField: HTMLElement;
  overnight: HTMLInputElement;
  night: HTMLInputElement;
  onlyNight: HTMLInputElement;
  onlyNightField: HTMLElement;
  roundTrip: HTMLInputElement;
  nights: HTMLSelectElement;
  stayHours: HTMLInputElement;
  stayHoursField: HTMLElement;
  lateReturn: HTMLInputElement;
  roundTripField: HTMLElement;
  roundTripOpts: HTMLElement;
  via: HTMLInputElement;
  originField: HTMLElement;
  destinationField: HTMLElement;
  viaField: HTMLElement;
  maxDurationField: HTMLElement;
  trainTypeField: HTMLElement;
  region: HTMLSelectElement;
  regionField: HTMLElement;
  cities: HTMLInputElement;
  citiesField: HTMLElement;
  tourCount: HTMLInputElement;
  tourCountField: HTMLElement;
  cityChips: HTMLElement;
  minDays: HTMLInputElement;
  maxDays: HTMLInputElement;
  stayField: HTMLElement;
  maxKm: HTMLInputElement;
  maxLegKm: HTMLInputElement;
  maxKmField: HTMLElement;
  maxLegDuration: HTMLInputElement;
  maxLegDurationField: HTMLElement;
  minLegDuration: HTMLInputElement;
  minLegDurationField: HTMLElement;
  title: HTMLElement;
  results: HTMLElement;
  mapEl: HTMLElement;
  favList: HTMLElement;
  tripList: HTMLElement;
}

let deps: Deps;
let query: SearchQuery;
let settings: store.Settings;
let rootRef: HTMLElement;
let refs: Refs;
let mapPromise: Promise<RouteMap> | null = null;
let mapInstance: RouteMap | null = null;
let labelToId: Map<string, string>;
// Today (YYYY-MM-DD). MAX seats are only bookable ~30 days out, so the calendar
// and the date picker stay anchored to a today..today+30 window.
let today = "";
const BOOKING_WINDOW_DAYS = 30;
const APP_TITLE = document.title;
// Cap on connection-only ("via") destinations appended to a browse list.
const MAX_VIA_RESULTS = 30;
// Query history for the in-app Back button (drilling into a route pushes here).
let navStack: SearchQuery[] = [];
// "Ideas" (best) mode: when no specific day is picked, show every destination
// reachable across the whole window. A calendar-day click narrows to that day.
let bestAllDays = true;

type TripType = "simple" | "return" | "multi" | "ideas";
let tripType: TripType = "simple";
const TRIP_TABS: readonly TripType[] = ["simple", "return", "multi", "ideas"];

function tripTypeForQuery(q: SearchQuery): TripType {
  if (q.mode === "tour") return "multi";
  if (q.mode === "best") return "ideas";
  if (q.mode === "od" && q.returnDate) return "return";
  return "simple";
}

function deriveMode(): SearchMode {
  if (tripType === "multi") return "tour";
  if (tripType === "ideas") return "best";
  const o = resolveStation(refs.origin.value);
  const d = resolveStation(refs.destination.value);
  if (o && d) return "od";
  if (d && !o) return "to";
  return "from";
}

// Ordered list of station ids for the tour "cities to visit" chip input.
let tourCities: string[] = [];

// PWA install prompt (Chromium "beforeinstallprompt"). Held until the user clicks.
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
let installPrompt: InstallPromptEvent | null = null;
let surpriseMsgEl: HTMLElement | null = null;
let cityClearBtnEl: HTMLElement | null = null;
let nearestBtnEl: HTMLElement | null = null;
// Proposed/edited return date for the od "Do you want to come back?" section.
// Reset on each fresh od search so a new outbound re-proposes (outbound + 2 days).
let odReturnDate: string | null = null;

/** Set (or clear with "") the inline status next to the "surprise" button. */
function setSurpriseMsg(text: string): void {
  if (surpriseMsgEl) surpriseMsgEl.textContent = text;
}

/** Remove every tour "city to visit" at once (staged — the search waits for the button). */
function clearTourCities(): void {
  if (tourCities.length === 0) return;
  tourCities = [];
  renderCityChips();
}

/** Straight-line km between two stations; Infinity if either lacks coordinates. */
function stationDistanceKm(a: string, b: string): number {
  const ca = deps.registry.coords(a);
  const cb = deps.registry.coords(b);
  return ca && cb ? haversineKm(ca, cb) : Infinity;
}

interface NearbyTrip {
  id: string;
  km: number;
  journey: Journey;
}

interface NearbyBothTrip {
  from: { id: string; km: number };
  to: { id: string; km: number };
  journey: Journey;
}

// How many nearby stations to consider when both endpoints must be substituted
// (the search is quadratic in this, so keep it small).
const BOTH_ENDS_CAP = 8;

/**
 * Paid-connection alternatives within `radiusKm` of the route endpoints, for when
 * the exact origin→destination has no free MAX seat:
 *  - `fromOrigin`: stations near the origin that DO have a free MAX journey to the
 *    destination (pay a short hop origin → that station, then ride free).
 *  - `toDest`: stations near the destination reachable by free MAX from the origin
 *    (ride free to that station, then pay a short hop on to the destination).
 * Each list is nearest-first and capped so the section stays scannable.
 */
function nearbyAlternatives(
  origin: string,
  destination: string,
  date: string,
  radiusKm: number,
  opts: ConnectionOptions,
): { fromOrigin: NearbyTrip[]; toDest: NearbyTrip[]; bothEnds: NearbyBothTrip[] } {
  const CAP = 8;
  const pool = deps.registry.list();
  const skip = new Set([origin, destination]);
  const near = (center: string): { id: string; km: number }[] =>
    pool
      .map((s) => ({ id: s.id, km: stationDistanceKm(center, s.id) }))
      .filter((x) => !skip.has(x.id) && Number.isFinite(x.km) && x.km > 0 && x.km <= radiusKm)
      .sort((a, b) => a.km - b.km);
  const nearOrigin = near(origin);
  const nearDest = near(destination);
  const collect = (cands: { id: string; km: number }[], findFree: (id: string) => Journey | null): NearbyTrip[] => {
    const out: NearbyTrip[] = [];
    for (const { id, km } of cands) {
      const journey = findFree(id);
      if (journey) out.push({ id, km, journey });
      if (out.length >= CAP) break;
    }
    return out;
  };
  const fromOrigin = collect(nearOrigin, (id) => bestJourney(deps.trains, id, destination, date, opts));
  const toDest = collect(nearDest, (id) => bestJourney(deps.trains, origin, id, date, opts));
  // Only when neither single substitution works is a double substitution (both
  // ends nearby) the *only* option — compute it then, and keep it small (quadratic).
  const bothEnds: NearbyBothTrip[] = [];
  if (fromOrigin.length === 0 && toDest.length === 0) {
    for (const from of nearOrigin.slice(0, BOTH_ENDS_CAP)) {
      for (const to of nearDest.slice(0, BOTH_ENDS_CAP)) {
        if (from.id === to.id) continue;
        const journey = bestJourney(deps.trains, from.id, to.id, date, opts);
        if (journey) {
          bothEnds.push({ from, to, journey });
          break; // one option per departure station keeps the list scannable
        }
      }
      if (bothEnds.length >= CAP) break;
    }
  }
  return { fromOrigin, toDest, bothEnds };
}

/**
 * Per-day "nearby reachability" for the radius calendar, when the exact route has
 * no free seat: level 1 = reachable by substituting ONE endpoint (a nearby start
 * OR a nearby finish); level 2 = reachable ONLY by substituting BOTH. Candidate
 * stations are fixed across days, so they're found once; each day short-circuits on
 * the first hit, and the (quadratic) both-ends check runs only when level 1 fails.
 */
function nearbyCalendarLevels(
  origin: string,
  destination: string,
  dates: string[],
  radiusKm: number,
  opts: ConnectionOptions,
): Map<string, 1 | 2> {
  const CAND_CAP = 12;
  const pool = deps.registry.list();
  const skip = new Set([origin, destination]);
  const nearest = (center: string): string[] =>
    pool
      .map((s) => ({ id: s.id, km: stationDistanceKm(center, s.id) }))
      .filter((x) => !skip.has(x.id) && Number.isFinite(x.km) && x.km > 0 && x.km <= radiusKm)
      .sort((a, b) => a.km - b.km)
      .slice(0, CAND_CAP)
      .map((x) => x.id);
  const nearOrigin = nearest(origin);
  const nearDest = nearest(destination);
  const bothOrigin = nearOrigin.slice(0, BOTH_ENDS_CAP);
  const bothDest = nearDest.slice(0, BOTH_ENDS_CAP);
  const out = new Map<string, 1 | 2>();
  for (const date of dates) {
    const single =
      nearOrigin.some((id) => bestJourney(deps.trains, id, destination, date, opts)) ||
      nearDest.some((id) => bestJourney(deps.trains, origin, id, date, opts));
    if (single) {
      out.set(date, 1);
      continue;
    }
    const both = bothOrigin.some((a) =>
      bothDest.some((b) => a !== b && bestJourney(deps.trains, a, b, date, opts)),
    );
    if (both) out.set(date, 2);
  }
  return out;
}

// Hard cap on how many cities one "find N" click can add, so a huge number can't
// freeze the planner.
const MAX_TOUR_FILL = 12;
// Bounds for the "find N cities" backtracking search so it always returns
// promptly: how many next-city options to weigh at each step, and a global
// plan-check budget. (Only-night destinations are pre-filtered, so the cap doesn't
// hide them.)
const TOUR_BRANCH = 24;
const TOUR_SEARCH_BUDGET = 900;

/** Cities to add per Surprise / Nearest click — the "Cities to add" input (≥1). */
function tourAddCount(): number {
  const n = Math.floor(Number(refs.tourCount.value.trim()));
  return Number.isFinite(n) && n >= 1 ? Math.min(MAX_TOUR_FILL, n) : 1;
}

/**
 * Grow the tour by `count` more cities — searching for ONE travel that strings all
 * of them together, not adding cities one greedy hop at a time. It backtracks: if a
 * choice dead-ends before reaching `count`, it tries another, so "Cities to add 5"
 * really finds a feasible 5-destination itinerary (or the longest one that exists).
 * `"nearest"` explores closest-first; `"random"` shuffles (Surprise me). Fills a
 * missing departure first; one re-render at the end.
 */
function growTour(mode: "nearest" | "random", count: number): void {
  setSurpriseMsg("");
  const avail = deps.trains.filter((tr) => tr.available);
  const inRegion = (id: string): boolean =>
    !query.region || deps.registry.get(id)?.region === query.region;

  // Need a departure to extend from — fill one (region-aware) if missing.
  let origin = query.origin;
  if (!origin) {
    const pool = [...new Set(avail.map((tr) => tr.origin))].filter(inRegion);
    origin = pool.length ? pool[Math.floor(Math.random() * pool.length)] : undefined;
  }
  if (!origin) {
    setSurpriseMsg(t("surprise_none"));
    return;
  }
  const start = origin;

  const lo = query.minDays ?? 1;
  const hi = Math.max(lo, query.maxDays ?? 3);
  // Honour "date flexibility": the first hop may leave within ±this many days of the
  // chosen date (never before today), so the search isn't pinned to a day with no (or
  // no night) departure.
  const startFlex = query.flexDays ?? 0;
  const planOpts = tourPlanOpts();
  // "Only night trains": a hop must END on a sleeper. With connections allowed,
  // reachableJourneys (below) already enforces that; direct-only needs an explicit
  // filter to night trains that run straight from the frontier.
  const onlyNightTour = Boolean(query.onlyNight);
  const withChanges = Boolean(query.maxConnections && query.maxConnections > 0);
  // The days a hop may depart, used to seed connection-aware candidates. The FIRST
  // hop leaves within ±startFlex of the chosen date (clamped to today), exactly the
  // window planSequence searches. A LATER hop leaves arrival+minDays..arrival+maxDays
  // — its real stay window — so a city reachable from an intermediate stop only on
  // that (later) date is still proposed; pinning every hop to the start date would
  // miss it. The direct path below is date-agnostic (scans every train), so this
  // only matters with changes.
  const startWindow = (): string[] => {
    const out: string[] = [];
    for (let i = -startFlex; i <= startFlex; i++) {
      const d = addDays(query.date, i);
      if (i === 0 || d >= today) out.push(d);
    }
    return out;
  };
  const stayWindow = (arrival: string): string[] => {
    const out: string[] = [];
    for (let i = lo; i <= hi; i++) out.push(addDays(arrival, i));
    return out;
  };
  // The next-city options from a frontier: every place the planner can actually
  // reach over `days`, unused, in-region, ordered by the mode (nearest needs
  // coordinates). When changes are allowed we seed from reachableJourneys
  // (connection- AND onlyNight-aware) across those days, not just direct trains on
  // the exact day — otherwise a city reachable only via a hub change (e.g. take a
  // train, then a connecting sleeper), or only on a flex/stay day, is never proposed.
  const reachableFrom = (frontier: string, days: string[]): string[] => {
    if (!withChanges) {
      return [...new Set(avail.filter((tr) => tr.origin === frontier).map((tr) => tr.destination))];
    }
    const dests = new Set<string>();
    for (const d of days)
      for (const dest of reachableJourneys(avail, frontier, d, planOpts).keys()) dests.add(dest);
    return [...dests];
  };
  const optionsFrom = (frontier: string, used: Set<string>, days: string[]): string[] => {
    let cs = reachableFrom(frontier, days).filter((d) => !used.has(d) && inRegion(d));
    if (onlyNightTour && !withChanges) {
      // Direct only: the sleeper must run straight from here. (With connections,
      // reachableJourneys already restricted to sleeper-arrival destinations.)
      const direct = new Set(
        avail.filter((tr) => tr.origin === frontier && isNightTrain(tr)).map((tr) => tr.destination),
      );
      cs = cs.filter((d) => direct.has(d));
    }
    if (mode === "nearest") {
      cs = cs.filter((d) => deps.registry.coords(d));
      if (deps.registry.coords(frontier)) {
        cs.sort((a, b) => stationDistanceKm(frontier, a) - stationDistanceKm(frontier, b));
      } else {
        cs.sort((a, b) => deps.registry.label(a).localeCompare(deps.registry.label(b)));
      }
    } else {
      cs.sort(() => Math.random() - 0.5);
    }
    // Day-train tours have hundreds of options — cap to keep the search snappy. The
    // night pool is already small (and must be fully weighed), so don't cap it.
    return onlyNightTour ? cs : cs.slice(0, TOUR_BRANCH);
  };
  let budget = TOUR_SEARCH_BUDGET;
  // Plan the whole in-order tour so far (returns the legs, or null if any hop is
  // infeasible). The arrival date of its last leg is when the traveller reaches the
  // frontier — which drives the NEXT hop's candidate window.
  const plan = (cities: string[]): Tour | null => {
    budget--;
    return planTourInOrder(deps.trains, start, cities, query.date, planOpts, lo, hi, stationDistanceKm, query.maxKm, query.maxLegKm, query.destination || undefined, query.destination ? query.tourEndDate : undefined, startFlex, today);
  };
  // Arrival date at a SPECIFIC city in the planned tour (the leg that ends there) —
  // not just the last leg: when a fixed destination is appended, the last leg lands
  // at the destination, so seeding from it would use the wrong (later) window for the
  // frontier we're actually extending from, dropping cities reachable in the right one.
  const arrivalAt = (tour: Tour, city: string): string => {
    const leg = tour.legs.find((j) => j.destination === city);
    return leg ? arrivalDate(leg) : query.date;
  };
  // Depth-first search with backtracking: extend `cities` by `remaining` more,
  // returning the FULL-depth itinerary if one exists (early out), else the deepest
  // feasible one found within the budget. `arrival` is when the traveller reaches the
  // current frontier (the chosen date for the start), so candidates are drawn from
  // the days the next hop could actually depart.
  const extend = (cities: string[], remaining: number, arrival: string): string[] => {
    if (remaining === 0 || budget <= 0) return cities;
    // The fixed finish (query.destination) is the END, never a nomad stop — exclude it
    // so it can't be proposed as a "city to add" (a ghost stop that plans away to the end).
    const used = new Set([start, ...cities, ...(query.destination ? [query.destination] : [])]);
    const frontier = cities[cities.length - 1] ?? start;
    const days = cities.length === 0 ? startWindow() : stayWindow(arrival);
    let deepest = cities;
    for (const c of optionsFrom(frontier, used, days)) {
      if (budget <= 0) break;
      const next = [...cities, c];
      const tour = plan(next); // the whole in-order tour so far must still plan
      if (!tour) continue;
      const result = extend(next, remaining - 1, arrivalAt(tour, c)); // seed from the NEW frontier c
      if (result.length === cities.length + remaining) return result; // reached count
      if (result.length > deepest.length) deepest = result; // keep the longest partial
    }
    return deepest;
  };

  const base = [...tourCities];
  // Seed the arrival at the existing frontier (if any) so the first new hop departs
  // from the right day. If the existing cities don't even plan, there's nothing to grow.
  const baseTour = base.length ? plan(base) : null;
  const baseFrontier = base[base.length - 1];
  tourCities =
    base.length && !baseTour
      ? base
      : extend(base, count, baseTour && baseFrontier ? arrivalAt(baseTour, baseFrontier) : query.date);
  const added = tourCities.length - base.length;

  if (added === 0) {
    // Couldn't add any city. Still commit the snapshotted form (a freshly-filled
    // departure, a removed finish/filter) so the view and URL reflect what's now in
    // the form — not a stale query that would keep a just-removed destination — then
    // flag that nothing was added.
    query = { ...query, origin };
    navStack = [];
    syncFormFromQuery();
    applyAndRun();
    setSurpriseMsg(t("surprise_none"));
    return;
  }
  query = { ...query, origin, cities: [...tourCities] };
  navStack = [];
  syncFormFromQuery();
  applyAndRun();
}

/** Tour "nearest stop": fill up to N closest reachable stops that keep it feasible. */
function addNearestCity(): void {
  // Snapshot the live form first (see surpriseMe): growTour rebuilds the query and
  // re-syncs the form, so it must start from the current form state — not a stale
  // query that would bring back a just-removed destination / staged edit.
  query = readQueryFromForm();
  growTour("nearest", tourAddCount());
}

async function promptInstall(): Promise<void> {
  // Use the browser's native prompt when it offered one (Chromium/Android).
  if (installPrompt) {
    try {
      await installPrompt.prompt();
      await installPrompt.userChoice.catch(() => undefined);
      installPrompt = null;
      return;
    } catch {
      // The native prompt threw (e.g. already consumed): fall through to the modal.
      installPrompt = null;
    }
  }
  // No usable native prompt (iOS Safari, Firefox, already installed elsewhere):
  // show a modal explaining it couldn't auto-install and how to do it manually.
  showInfoModal(t("act_install"), [t("install_unavailable"), t("install_help")]);
}

export function initApp(root: HTMLElement, dataset: Dataset, registry: StationRegistry): void {
  deps = { trains: dataset.trains, meta: dataset.meta, registry };
  rootRef = root;
  settings = store.loadSettings();
  const urlLang = new URLSearchParams(location.search).get("lang");
  applyTheme(settings.theme);
  setLang(isLang(urlLang) ? urlLang : settings.lang);
  // Every station present in the dataset becomes searchable (the curated registry
  // only covers map coordinates for the major ones).
  registry.addMissing(dataset.trains.flatMap((t) => [t.origin, t.destination]));
  labelToId = new Map(registry.list().map((s) => [s.label.toLowerCase(), s.id]));

  today = new Date().toISOString().slice(0, 10);
  query = store.urlHasQuery()
    ? queryFromUrl()
    : { mode: "from", date: today, card: settings.card, maxConnections: 1, excludeNight: true };

  // A genuine page reload restores the form from the URL but does NOT auto-run the
  // search — results wait for the Search button, matching how form edits are now
  // staged (see "Don't auto-run on form edits"). Otherwise every reload silently
  // recomputes. A fresh navigation — the first visit, or a shared/deep link opened
  // from elsewhere — still shows results immediately, so shared links keep working.
  rebuild(!(store.urlHasQuery() && isPageReload()));
  checkWatchedRoutes();

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e as InstallPromptEvent;
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
  });

  // Keep the map-first canvas sized to the viewport below the bars as they reflow.
  window.addEventListener("resize", updateRailMetrics);

  // Global keyboard shortcuts (mode switch, focus, day nav, surprise, run, help).
  document.addEventListener("keydown", onGlobalKey);

  document.addEventListener("click", (ev) => {
    const nav = document.querySelector<HTMLElement>(".header-nav.menu-open");
    if (nav && !nav.contains(ev.target as Node)) closeHeaderMenu();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeHeaderMenu();
  });

  // Native browser Back/Forward: restore the page from the URL. The in-app drill
  // stack is the URL's source of truth here, so clear it to keep the in-app
  // "Retour" button in step with where the browser history now sits.
  window.addEventListener("popstate", () => {
    query = queryFromUrl();
    navStack = [];
    syncFormFromQuery();
    runSearch();
  });
}

/**
 * Parse the query from the URL and snap its date back into the bookable window. The
 * date <input> is clamped to [today, today+29], so the search form can never produce
 * an out-of-range date — but a stale or shared link can. An out-of-window date would
 * otherwise collapse the ±flex browse window (only the chosen, unbookable day is in
 * range) and skew the exact-trip return calendar, so fall back to today.
 */
function queryFromUrl(): SearchQuery {
  const q = store.queryFromParams(new URLSearchParams(location.search), today);
  const lastBookable = addDays(today, BOOKING_WINDOW_DAYS - 1);
  if (q.date < today || q.date > lastBookable) q.date = today;
  return q;
}

function rebuild(autoRun = true): void {
  buildLayout(rootRef);
  syncFormFromQuery();
  if (autoRun) runSearch();
  else showSearchPrompt();
  updateRailMetrics();
  setMobileForm(!(autoRun && store.urlHasQuery()));
}

/**
 * Whether this page view is a browser reload, as opposed to a fresh navigation
 * (first visit, typed URL, or a shared/deep link). Used to hold back the search
 * on reload — the restored form waits for the Search button — while still running
 * it automatically when someone opens a link. Unknown navigation types (and jsdom,
 * where the entry is "navigate") count as "not a reload", so links keep auto-running.
 */
function isPageReload(): boolean {
  const nav = performance.getEntriesByType?.("navigation") as PerformanceNavigationTiming[] | undefined;
  return nav?.[0]?.type === "reload";
}

/**
 * Results placeholder shown when a reload restored the form but we're deliberately
 * waiting for the Search button rather than recomputing. Clicking Search (or the
 * "g" shortcut) runs the restored query as-is.
 */
function showSearchPrompt(): void {
  clear(refs.results);
  refs.results.append(render.emptyEl(t("prompt_search")));
  showBaseMap();
}

// --- station resolution -----------------------------------------------------

function resolveStation(text: string): string | undefined {
  const norm = text.trim();
  if (!norm) return undefined;
  const byLabel = labelToId.get(norm.toLowerCase());
  if (byLabel) return byLabel;
  // Strict: no fuzzy/raw fallback. Text matching no real station resolves to
  // undefined, so a typo or made-up name reads as invalid instead of being kept as
  // a phantom origin / city that silently matches nothing.
  const hit = deps.registry.search(norm, 1)[0];
  return hit ? hit.id : undefined;
}

// --- formatting / context ---------------------------------------------------

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return new Intl.DateTimeFormat(getLang(), {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(d);
}

/** Short weekday name for a date (e.g. "Sat" / "sam." / "土"), localized. */
function formatWeekday(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return new Intl.DateTimeFormat(getLang(), { weekday: "short" }).format(d);
}

function isWeekend(iso: string): boolean {
  const day = new Date(`${iso}T00:00:00`).getDay();
  return day === 0 || day === 6;
}

// Wikivoyage language editions that exist; others (e.g. ko) fall back to English.
const WIKIVOYAGE_LANGS = new Set(["fr", "en", "es", "de", "it", "zh"]);

/** Travel-guide (Wikivoyage) URL for a station's city, in the current language. */
function cityInfoUrl(id: string): string {
  const lang = getLang();
  const wv = WIKIVOYAGE_LANGS.has(lang) ? lang : "en";
  const article = deps.registry.city(id).replace(/ /g, "_");
  return `https://${wv}.wikivoyage.org/wiki/${encodeURIComponent(article)}`;
}

function ctx(): RenderCtx {
  return {
    label: (id) => deps.registry.label(id),
    formatDate,
    formatWeekday,
    // Deep-link to SNCF Connect with the trip pre-filled (clean station names, the
    // journey date, and the departure time). Connecting trips book per-leg instead.
    bookUrl: (origin, destination, date, time) =>
      generateBookingUrl(deps.registry.label(origin), deps.registry.label(destination), date, time),
    cityInfoUrl,
    onOpenRoute: (origin, destination) => {
      navStack.push({ ...query }); // remember the list we came from
      // Drop any "via" carried over from a previous exact-trip search: drilling into
      // a specific route (often a connecting one) shouldn't be filtered through an
      // unrelated hub, which would force it through a station it doesn't pass and
      // show nothing.
      query = { ...query, mode: "od", origin, destination, via: undefined };
      syncFormFromQuery();
      applyAndRun();
      setMobileForm(false);
      // One clean scroll to the new page's heading (focus uses preventScroll so
      // this is the only scroll, not a jump-then-smooth).
      refs.title.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    onFocusStation: (id) => mapInstance?.focus(id),
    onShowJourney: (j) => {
      showRoute([j.origin, ...j.hubs, j.destination]);
      refs.mapEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
    onShowTour: (tour) => {
      const first = tour.legs[0];
      const stops = first ? [first.origin, ...tour.legs.map((l) => l.destination)] : [];
      showRoute(stops);
      refs.mapEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
    distanceKm: (a, b) => stationDistanceKm(a, b),
    // Picking a calendar day only changes the date: refresh in place (no spinner,
    // no teardown flash) and keep the scroll position so the calendar appears to
    // just move its highlight instead of vanishing and rebuilding.
    onSelectDay: (date) => {
      // In ideas mode, clicking a day narrows the "all days" list to that day.
      const narrowing = query.mode === "best" && bestAllDays;
      if (date === query.date && !narrowing) return;
      if (query.mode === "best") bestAllDays = false;
      query = { ...query, date };
      refreshInPlace();
    },
    onIcs: (j) => {
      const summary = `MAX ${deps.registry.label(j.origin)} → ${deps.registry.label(j.destination)}`;
      const slug = j.legs.map((l) => l.trainNo.replace(/[^a-zA-Z0-9-]/g, "")).join("-");
      downloadText(`max-${j.date}-${slug}.ics`, journeyToIcs(j, summary));
    },
    onBookSteps: (j) => showBookingModal(j, ctx()),
    isFavorite: (route) => store.isFavorite(route),
    onToggleFavorite: (route) => {
      store.toggleFavorite(route);
      renderFavorites();
    },
    isTripSaved: (out, inb) => store.isTripSaved(store.tripId(out, inb)),
    onToggleTrip: (out, inb) => {
      store.toggleTrip(buildSavedTrip(out, inb));
      renderSavedTrips();
    },
    onShowTrip: (out, inb) => showTripModal(out, ctx(), { inbound: inb, onShare: shareCurrentUrl }),
    isTourSaved: (tour) => store.isTripSaved(store.tourId(tour)),
    onToggleTour: (tour) => {
      store.toggleTrip(buildSavedTour(tour));
      renderSavedTrips();
    },
  };
}

/** Snapshot a multi-city tour as a saved trip (its first leg labels the rail row). */
function buildSavedTour(tour: Tour): store.SavedTrip {
  return {
    id: store.tourId(tour),
    kind: "tour",
    outbound: tour.legs[0]!,
    tour,
    savedAt: Date.now(),
  };
}

/** Snapshot a journey (one-way) or a round trip (with `inbound`) as a saved trip. */
function buildSavedTrip(outbound: Journey, inbound?: Journey): store.SavedTrip {
  return {
    id: store.tripId(outbound, inbound),
    kind: inbound ? "round" : "one-way",
    outbound,
    ...(inbound ? { inbound } : {}),
    savedAt: Date.now(),
  };
}

// --- query <-> form ---------------------------------------------------------

function syncFormFromQuery(): void {
  setSurpriseMsg(""); // a navigation clears any stale "surprise" notice
  tripType = tripTypeForQuery(query);
  setActiveTab(tripType);
  refs.modeDesc.textContent = t(`desc_${tripType}` as const);
  refs.origin.value = query.origin ? deps.registry.label(query.origin) : "";
  refs.destination.value = query.destination ? deps.registry.label(query.destination) : "";
  refs.via.value = query.via ? deps.registry.label(query.via) : "";
  // Values set here are always resolved, so clear any stale invalid flag.
  for (const f of [refs.origin, refs.destination, refs.via]) f.classList.remove("is-invalid");
  refs.departDate.setRange(tripType === "return");
  refs.departDate.setMargin(query.flexDays ?? 0);
  refs.departDate.setDates(query.date, query.returnDate ?? "");
  refs.date.value = query.date;
  if (query.legs && query.legs.length > 0) {
    legRows = query.legs.map((l) =>
      makeLeg(l.from ? deps.registry.label(l.from) : "", l.to ? deps.registry.label(l.to) : "", l.date),
    );
    renderLegs();
  }
  refs.endDate.value = query.tourEndDate ?? "";
  refs.card.value = query.card;
  refs.departAfter.value = query.departAfter ?? "";
  refs.departBefore.value = query.departBefore ?? "";
  refs.arriveBefore.value = query.arriveBefore ?? "";
  refs.maxDuration.value = query.maxDurationMin != null ? String(query.maxDurationMin) : "";
  refs.maxSpanDays.value = query.maxSpanDays != null ? String(query.maxSpanDays) : "";
  refs.radius.value = query.radiusKm != null ? String(query.radiusKm) : "";
  refs.trainType.value = query.trainType ?? "";
  refs.maxConnections.value = String(query.maxConnections);
  refs.overnight.checked = Boolean(query.overnight);
  refs.night.checked = !query.excludeNight; // checked = night trains included
  refs.onlyNight.checked = Boolean(query.onlyNight);
  refs.roundTrip.checked = Boolean(query.roundTrip);
  refs.nights.value = query.flexNights ? "flex" : String(query.nights ?? 0);
  refs.stayHours.value = query.stayMinHours != null ? String(query.stayMinHours) : "";
  refs.lateReturn.checked = Boolean(query.lateReturn);
  refs.region.value = query.region ?? "";
  tourCities = [...(query.cities ?? [])];
  refs.cities.value = "";
  renderCityChips();
  refs.minDays.value = String(query.minDays ?? 1);
  refs.maxDays.value = String(query.maxDays ?? 3);
  refs.maxKm.value = query.maxKm != null ? String(query.maxKm) : "";
  refs.maxLegKm.value = query.maxLegKm != null ? String(query.maxLegKm) : "";
  refs.maxLegDuration.value = query.maxLegDurationMin != null ? String(query.maxLegDurationMin) : "";
  refs.minLegDuration.value = query.minLegDurationMin != null ? String(query.minLegDurationMin) : "";
  updateFieldVisibility();
}

function readQueryFromForm(): SearchQuery {
  const maxDur = Number(refs.maxDuration.value.trim());
  const maxKm = Number(refs.maxKm.value.trim());
  const maxLegKm = Number(refs.maxLegKm.value.trim());
  const maxLegDur = Number(refs.maxLegDuration.value.trim());
  const minLegDur = Number(refs.minLegDuration.value.trim());
  const span = Number(refs.maxSpanDays.value.trim());
  const rad = Number(refs.radius.value.trim());
  const mode = deriveMode();
  return {
    mode,
    origin: resolveStation(refs.origin.value),
    destination: resolveStation(refs.destination.value),
    via: mode === "od" ? resolveStation(refs.via.value) : undefined,
    flexDays: refs.departDate.getMargin() || undefined,
    returnDate: tripType === "return" && mode === "od" ? refs.departDate.getReturn() || undefined : undefined,
    returnFlexDays: tripType === "return" && mode === "od" ? refs.departDate.getMargin() || undefined : undefined,
    legs:
      mode === "tour"
        ? legRows
            .map((l) => ({
              from: resolveStation(l.from.value) ?? "",
              to: resolveStation(l.to.value) ?? "",
              date: l.dateCtl.input.value || query.date,
            }))
            .filter((l) => l.from && l.to)
        : undefined,
    date: refs.date.value || query.date,
    card: refs.card.value === "senior" ? "senior" : "jeune",
    departAfter: refs.departAfter.value || undefined,
    departBefore: refs.departBefore.value || undefined,
    arriveBefore: refs.arriveBefore.value || undefined,
    maxDurationMin: Number.isFinite(maxDur) && maxDur > 0 ? maxDur : undefined,
    trainType: refs.trainType.value || undefined,
    maxConnections: Number(refs.maxConnections.value),
    overnight: refs.overnight.checked || undefined,
    // Night trains: unchecked drops them; checked includes them, and the nested
    // "only" checkbox then narrows to sleep-aboard journeys.
    excludeNight: !refs.night.checked || undefined,
    onlyNight: (refs.night.checked && refs.onlyNight.checked) || undefined,
    region: refs.region.value || undefined,
    // Chips hold the committed cities; also fold in any text still in the input
    // (typed but not yet turned into a chip) so a pending entry isn't lost.
    cities:
      mode === "tour"
        ? [
            ...new Set([
              ...tourCities,
              ...refs.cities.value
                .split(",")
                .map((s) => resolveStation(s))
                .filter((s): s is string => Boolean(s)),
            ]),
          ]
        : query.cities,
    minDays: clampDays(refs.minDays.value, 1),
    maxDays: clampDays(refs.maxDays.value, 3),
    maxKm: Number.isFinite(maxKm) && maxKm > 0 ? Math.floor(maxKm) : undefined,
    maxLegKm: Number.isFinite(maxLegKm) && maxLegKm > 0 ? Math.floor(maxLegKm) : undefined,
    maxLegDurationMin:
      mode === "tour" && Number.isFinite(maxLegDur) && maxLegDur > 0
        ? Math.max(30, Math.floor(maxLegDur))
        : undefined,
    minLegDurationMin:
      mode === "tour" && Number.isFinite(minLegDur) && minLegDur > 0
        ? Math.floor(minLegDur)
        : undefined,
    maxSpanDays:
      mode === "od" && Number.isFinite(span) && span >= 1 ? Math.min(14, Math.floor(span)) : undefined,
    radiusKm:
      mode === "od" && Number.isFinite(rad) && rad >= 10 ? Math.min(300, Math.floor(rad)) : undefined,
    tourEndDate:
      mode === "tour" && resolveStation(refs.destination.value) ? refs.endDate.value || undefined : undefined,
    // The sort lives in the results toolbar, not the form — carry it through.
    sort: query.sort,
  };
}

/** Parse a day-count input into 1..14, falling back to `fallback`. */
function clampDays(raw: string, fallback: number): number {
  const n = Math.floor(Number(raw.trim()));
  return Number.isFinite(n) && n >= 1 ? Math.min(14, n) : fallback;
}

function applyAndRun(): void {
  // Push a browser history entry so the native Back button returns to the prior
  // page. (Incidental updates — e.g. picking a calendar day — use replaceState.)
  store.pushUrl(query);
  settings = { ...settings, card: query.card };
  store.saveSettings(settings);
  runSearch();
  // Move focus to the results heading so screen-reader users hear the new context,
  // but don't let focus yank the scroll — callers control scrolling explicitly.
  refs.title.focus({ preventScroll: true });
}

/**
 * Re-render the current query in place: synchronous (no spinner flash), keeping
 * the scroll position. Used for cheap updates like changing the calendar day,
 * where a full teardown + spinner + scroll-to-top is jarring.
 */
function refreshInPlace(): void {
  store.updateUrl(query);
  const scrollY = window.scrollY;
  // Mirror ONLY the date back to its input — a calendar-day pick or day-shift is the
  // only form-bound value an in-place refresh changes. Deliberately do NOT re-sync the
  // whole form from `query` here: that clobbered a staged, not-yet-searched edit — a
  // ticked "Night trains", a tour city chip — because those live in the form (and
  // `tourCities`) but aren't folded into `query` until Search. Re-syncing silently
  // reset them, which is the "my filter / cities disappeared" bug.
  refs.date.value = query.date;
  refs.departDate.setDate(query.date);
  refreshTourEndDate();
  clear(refs.results);
  renderSearch();
  window.scrollTo({ top: scrollY });
}

// --- search execution -------------------------------------------------------

/**
 * Connection options for the tour planner. Each tour hop is a single journey, so
 * the per-train time cap maps onto a journey's total-duration limit; a hop longer
 * than that is never considered. (Overnight stays are modelled by the per-city day
 * window, not a long layover, so the tour doesn't widen the connection ceiling.)
 */
function tourPlanOpts() {
  return {
    maxConnections: query.maxConnections,
    ...(query.maxLegDurationMin ? { maxDurationMin: query.maxLegDurationMin } : {}),
    ...(query.minLegDurationMin ? { minDurationMin: query.minLegDurationMin } : {}),
    // The train-type and depart-time filters are shown in every mode's Advanced
    // panel, so honour them here too — otherwise a tour silently ignores them.
    ...(query.trainType ? { trainType: query.trainType } : {}),
    ...(query.departAfter ? { departAfter: query.departAfter } : {}),
    ...(query.departBefore ? { departBefore: query.departBefore } : {}),
    ...(query.arriveBefore ? { arriveBefore: query.arriveBefore } : {}),
    ...(query.excludeNight ? { excludeNight: true } : {}),
    ...(query.onlyNight ? { onlyNight: true } : {}),
    // Overnight stopovers widen the layover ceiling, so a hop can wait a whole day
    // at a hub — e.g. step off a night train in the morning and pick up the next
    // night train that evening (a sleeper every day).
    ...(query.overnight ? { maxConnectionMin: OVERNIGHT_MAX_CONNECTION_MIN } : {}),
  };
}

function filterOpts() {
  return {
    departAfter: query.departAfter,
    departBefore: query.departBefore,
    arriveBefore: query.arriveBefore,
    maxDurationMin: query.maxDurationMin,
    trainType: query.trainType,
    ...(query.excludeNight ? { excludeNight: true } : {}),
    ...(query.onlyNight ? { onlyNight: true } : {}),
    // Overnight stopovers: widen the layover ceiling so a journey can wait
    // overnight at a hub instead of being limited to a ~4h connection.
    ...(query.overnight ? { maxConnectionMin: OVERNIGHT_MAX_CONNECTION_MIN } : {}),
  };
}

// --- result sorting ---------------------------------------------------------

const SORT_LABEL = {
  rec: "sort_rec",
  trains: "sort_trains",
  days: "sort_days",
  closest: "sort_closest",
  fastest: "sort_fastest",
  name: "sort_name",
} as const;

/** Build the sort-picker option list for a mode from its applicable keys. */
function sortOptions(keys: SortKey[]): { value: SortKey; label: string }[] {
  return keys.map((k) => ({ value: k, label: t(SORT_LABEL[k]) }));
}

/** Re-rank the current list to the chosen key (no recompute) and refresh in place. */
function onSort(key: SortKey): void {
  query = { ...query, sort: key === "rec" ? undefined : key };
  refreshInPlace();
}

interface SortAccessors<T> {
  name: (x: T) => string;
  trains?: (x: T) => number;
  days?: (x: T) => number;
  distanceKm?: (x: T) => number;
  durationMin?: (x: T) => number;
}

/**
 * Re-order a list by the active sort key, leaving the mode's natural rank (and the
 * default "rec") untouched. A key with no accessor for this list is a no-op, so
 * each mode can offer just the keys that make sense. Sorts a copy.
 */
function applySort<T>(items: T[], acc: SortAccessors<T>): T[] {
  const key = query.sort;
  if (!key || key === "rec") return items;
  const arr = [...items];
  switch (key) {
    case "trains":
      if (acc.trains) arr.sort((a, b) => acc.trains!(b) - acc.trains!(a));
      break;
    case "days":
      if (acc.days) arr.sort((a, b) => acc.days!(b) - acc.days!(a));
      break;
    case "closest":
      if (acc.distanceKm) arr.sort((a, b) => acc.distanceKm!(a) - acc.distanceKm!(b));
      break;
    case "fastest":
      if (acc.durationMin) arr.sort((a, b) => acc.durationMin!(a) - acc.durationMin!(b));
      break;
    case "name":
      arr.sort((a, b) => acc.name(a).localeCompare(acc.name(b)));
      break;
  }
  return arr;
}

/** Round-trip ("getaway") search options from the form (shared by Where-to? and Ideas). */
function getawayOpts() {
  return {
    maxConnections: query.maxConnections,
    ...filterOpts(),
    ...(query.nights ? { nights: query.nights } : {}),
    ...(query.flexNights ? { flexibleNights: true } : {}),
    ...(query.stayMinHours ? { minOnSiteMin: query.stayMinHours * 60 } : {}),
    ...(query.lateReturn ? { lateReturn: true } : {}),
  };
}

// Pending deferred-render frame, so an in-flight search can be cancelled (Escape).
let pendingRaf = 0;

/** Cancel a search that's still showing its spinner (before the compute runs). */
function cancelLoading(): boolean {
  if (!pendingRaf) return false;
  cancelAnimationFrame(pendingRaf);
  pendingRaf = 0;
  clear(refs.results); // drop the spinner — the search is abandoned
  return true;
}

function runSearch(): void {
  if (pendingRaf) cancelAnimationFrame(pendingRaf);
  clear(refs.results);
  // Delayed spinner: CSS keeps it invisible for 150ms, so instant searches never
  // flash it, while heavy modes (best/tour on large data) show it. The compute is
  // deferred a frame so the spinner can paint first.
  refs.results.append(
    el("div", { class: "loading", attrs: { role: "status", "aria-label": t("loading") } }, [
      el("span", { class: "spinner", attrs: { "aria-hidden": "true" } }),
    ]),
  );
  // Two frames so the spinner actually paints before a heavy (connection-aware)
  // compute blocks the main thread — otherwise long searches show no feedback.
  pendingRaf = requestAnimationFrame(() => {
    pendingRaf = requestAnimationFrame(() => {
      pendingRaf = 0;
      clear(refs.results);
      renderSearch();
    });
  });
}

function updateDocTitle(): void {
  const label = (id: string) => deps.registry.label(id);
  let context = "";
  if (query.mode === "od" && query.origin && query.destination) {
    context = `${label(query.origin)} → ${label(query.destination)} · ${formatDate(query.date)}`;
  } else if (query.mode === "from" && query.origin) {
    context = `${t("mode_from")} ${label(query.origin)}`;
  } else if (query.mode === "to" && query.destination) {
    context = `${t("mode_to")} ${label(query.destination)}`;
  } else if (query.mode === "best" && query.origin) {
    context = `${t("mode_best")} · ${label(query.origin)}`;
  } else if (query.mode === "tour" && query.origin) {
    context = `${t("mode_tour")} · ${label(query.origin)}`;
  }
  document.title = context ? `${context} — ${t("appName")}` : APP_TITLE;
}

async function shareCurrentUrl(onCopied: () => void): Promise<void> {
  const url = location.href;
  if (navigator.share) {
    try {
      await navigator.share({ title: document.title, url });
    } catch {
      return;
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    onCopied();
  } catch {
    return;
  }
}

function renderSearch(): void {
  const c = ctx();
  updateDocTitle();
  rootRef.dataset.detail = navStack.length ? "on" : "";

  // Default the map to the bare France basemap; a mode that has something to plot
  // overrides this with its own markers below. This keeps the map from sitting
  // empty when a search can't run yet (e.g. no origin entered).
  showBaseMap();

  // Back to the previous list (instant — journeys are memoized).
  if (navStack.length) {
    refs.results.append(
      el("button", { class: "back-btn", type: "button", text: `← ${t("act_back")}`, on: { click: goBack } }),
    );
  }

  // MAX SENIOR free tickets are weekday-only — flag a weekend date.
  if (query.card === "senior" && isWeekend(query.date)) {
    refs.results.append(el("p", { class: "notice", text: t("senior_weekend_warn") }));
  }

  if (query.mode === "from") {
    runBrowse(c, "from");
  } else if (query.mode === "to") {
    runBrowse(c, "to");
  } else if (query.mode === "best") {
    runBestSearch(c);
  } else if (query.mode === "tour") {
    runTourSearch(c);
  } else {
    runOdSearch(c);
  }
  updateSearchBar();
}

/**
 * "from"/"to" browse. Direct destinations keep their rich expandable cards;
 * when changes are allowed, every extra place reachable only via a connection
 * is appended as a compact "via" row, so raising the connections setting really
 * does surface more destinations.
 */
function runBrowse(c: RenderCtx, dir: "from" | "to"): void {
  const { trains, registry } = deps;
  const anchor = dir === "from" ? query.origin : query.destination;
  if (!anchor) return showHint(dir === "from" ? refs.origin : refs.destination);
  // "Round trip" view: day trips / N-night getaways from the origin.
  if (dir === "from" && query.roundTrip) return runGetaways(c, anchor);
  refs.title.textContent = t(dir === "from" ? "res_from_title" : "res_to_title", {
    station: registry.label(anchor),
    date: formatDate(query.date),
  });
  const countKey = dir === "from" ? "res_destinations" : "res_origins";

  // The list spans the chosen day, or — when "flexible dates" is on — a ±N-day
  // window around it. Every place shown has a free-MAX train within that span, so
  // there are no empty "0 this day" rows; widening the window surfaces more places.
  const flex = query.flexDays ?? 0;
  const lastBookable = addDays(today, BOOKING_WINDOW_DAYS - 1);
  const windowDates: string[] = [];
  for (let i = -flex; i <= flex; i++) {
    const d = addDays(query.date, i);
    // The selected date is always included; flex neighbours are clamped to the
    // bookable window.
    if (i === 0 || (d >= today && d <= lastBookable)) windowDates.push(d);
  }
  const dayCount = new Map<string, number>();
  for (const d of windowDates) {
    const g =
      dir === "from"
        ? reachableDestinations(trains, anchor, d, filterOpts())
        : reachableOrigins(trains, anchor, d, filterOpts());
    for (const x of g) dayCount.set(x.station, (dayCount.get(x.station) ?? 0) + x.count);
  }

  // Take the whole-window record for those reachable stations, so each card can show
  // both the day/window count and the month total (richer card data: fastest time etc.).
  const groups = reachableGroups(trains, anchor, dir, filterOpts()).filter(
    (g) => (dayCount.get(g.station) ?? 0) > 0,
  );
  const directStations = new Set(groups.map((g) => g.station));

  // Total MAX availability over the whole booking window, per destination, so each
  // card shows how many tickets exist before drilling into the exact-trip calendar.
  // Rank the list by that total (most-served first) — the "statistic" view.
  const stats = windowStats(trains, anchor, dir, filterOpts());
  groups.sort(
    (a, b) =>
      (stats.get(b.station)?.trains ?? 0) - (stats.get(a.station)?.trains ?? 0) ||
      a.station.localeCompare(b.station),
  );

  // Destinations reachable only with a change (not already direct), capped so the
  // "via" list stays compact like the direct list. Search the SAME ±flex window as
  // the direct list (keeping the shortest journey per station) — otherwise widening
  // flexibility surfaces more direct places but never any extra connecting ones.
  const connecting = ((): ReachTrip[] => {
    if (query.maxConnections <= 0) return [];
    const viaOpts = { ...filterOpts(), maxConnections: query.maxConnections };
    const byStation = new Map<string, ReachTrip>();
    for (const d of windowDates) {
      for (const tr of reachableBest(trains, anchor, d, stationsOnDate(trains, d), viaOpts, dir)) {
        if (tr.journey.legs.length <= 1 || directStations.has(tr.station)) continue;
        const cur = byStation.get(tr.station);
        if (!cur || tr.journey.totalDurationMin < cur.journey.totalDurationMin) byStation.set(tr.station, tr);
      }
    }
    return [...byStation.values()]
      .sort((a, b) => a.journey.totalDurationMin - b.journey.totalDurationMin)
      .slice(0, MAX_VIA_RESULTS);
  })();

  const total = groups.length + connecting.length;
  if (total === 0) {
    refs.results.append(render.emptyEl(t("res_none")), render.hintEl(t("res_none_hint")));
    showMap(anchor, []);
    return;
  }
  // Sort applies to the direct destinations (the rich cards); "rec" keeps the
  // most-served default. Via rows stay appended after, in their duration order.
  const sortedGroups = applySort(groups, {
    name: (g) => registry.label(g.station),
    distanceKm: (g) => stationDistanceKm(anchor, g.station),
    durationMin: (g) => g.minDurationMin,
  });
  refs.results.append(
    render.listToolbarEl(
      t(countKey, { n: total }),
      query.sort ?? "rec",
      sortOptions(["rec", "fastest", "closest", "name"]),
      onSort,
    ),
  );
  for (const g of sortedGroups)
    refs.results.append(
      render.groupCardEl(g, dir, anchor, c, dayCount.get(g.station) ?? 0, stats.get(g.station), flex),
    );
  for (const tr of connecting) refs.results.append(render.reachTripRowEl(tr.station, tr.journey, c));
  // Tint map pins by how many changes each place takes: direct = green, each
  // extra connection pushes toward red (see RouteMap.reachColor).
  const mapInfo = new Map<string, MarkerInfo>();
  for (const g of groups) mapInfo.set(g.station, { title: registry.label(g.station), connections: 0 });
  for (const tr of connecting)
    mapInfo.set(tr.station, {
      title: registry.label(tr.station),
      connections: tr.journey.legs.length - 1,
    });
  showMap(anchor, [...groups.map((g) => g.station), ...connecting.map((tr) => tr.station)], mapInfo);
}

/**
 * "Round trip" view (a toggle on "Where to?"): every city you can reach AND get
 * home from on free MAX — a same-day day trip (leave morning, back evening) or an
 * N-night getaway. Ranked by nights, then time on site / least travel, so the best
 * escapes float to the top.
 */
function runGetaways(c: RenderCtx, origin: string): void {
  const { trains, registry } = deps;
  refs.title.textContent = t("getaway_title", {
    station: registry.label(origin),
    date: formatDate(query.date),
  });
  // The Date field + "date flexibility" stepper drive this view (no calendar —
  // it added little here and confused the day-trip vs round-trip framing).
  // Flexible dates: search every day in the ±N window and keep the best round trip
  // per destination (more nights, then more time on site / less travel) — so you
  // can do a round trip "around these days", not only on the exact one.
  const flex = query.flexDays ?? 0;
  const lastBookable = addDays(today, BOOKING_WINDOW_DAYS - 1);
  const dates: string[] = [];
  for (let i = -flex; i <= flex; i++) {
    const d = addDays(query.date, i);
    if (i === 0 || (d >= today && d <= lastBookable)) dates.push(d);
  }
  const { trips } = getawaysAcrossWindow(trains, origin, dates, getawayOpts());
  if (trips.length === 0) {
    refs.results.append(render.emptyEl(t("getaway_none")), render.hintEl(t("getaway_none_hint")));
    showMap(origin, []);
    return;
  }
  refs.results.append(el("p", { class: "muted count", text: t("getaway_count", { n: trips.length }) }));
  // With flexible dates the trips fall on different start days, so each row shows its date.
  for (const trip of trips) refs.results.append(render.getawayRowEl(trip, c, { showDate: flex > 0 }));
  showMap(
    origin,
    trips.map((trip) => trip.destination),
  );
}

function runMultiCity(c: RenderCtx): void {
  const { trains, registry } = deps;
  const legs = (query.legs ?? []).filter((l) => l.from && l.to);
  if (legs.length === 0) {
    refs.results.append(render.emptyEl(t("multi_hint")));
    showBaseMap();
    return;
  }
  refs.title.textContent = t("multi_title", { n: legs.length });
  const stations: string[] = [];
  const legSections: HTMLElement[] = [];
  const chosen: (Journey | null)[] = legs.map(() => null);
  legs.forEach((leg, i) => {
    const opts = { ...filterOpts(), maxConnections: query.maxConnections };
    const journeys = findJourneys(trains, leg.from, leg.to, leg.date, opts).sort(
      (a, b) => a.totalDurationMin - b.totalDurationMin || a.departMin - b.departMin,
    );
    chosen[i] = journeys[0] ?? null;
    const sec = el("section", { class: "mc-result" }, [
      el("div", { class: "mc-result-head" }, [
        el("span", { class: "mc-num", text: String(i + 1) }),
        el("span", { class: "mc-route" }, [
          el("bdi", { text: registry.label(leg.from) }),
          el("span", { class: "muted", text: " → " }),
          el("bdi", { text: registry.label(leg.to) }),
        ]),
        el("span", { class: "mc-date muted", text: formatDate(leg.date) }),
      ]),
    ]);
    if (journeys.length === 0) sec.append(render.emptyEl(t("res_none")));
    else
      for (const j of journeys)
        sec.append(
          render.journeyEl(j, c, {
            onPick: (jj) => {
              chosen[i] = jj;
            },
            onArrow: (jj) => {
              chosen[i] = jj;
              const nextSec = legSections[i + 1];
              if (nextSec) nextSec.scrollIntoView({ behavior: "smooth", block: "start" });
              else showMultiTripModal(chosen.filter((x): x is Journey => x != null), c);
            },
          }),
        );
    legSections.push(sec);
    refs.results.append(sec);
    stations.push(leg.from);
    const next = legs[i + 1];
    if (!next || next.from !== leg.to) stations.push(leg.to);
  });
  showRoute(stations);
}

function runTourSearch(c: RenderCtx): void {
  const { trains, registry } = deps;
  if (query.legs || tripType === "multi") return runMultiCity(c);
  if (!query.origin) return showHint(refs.origin);
  refs.title.textContent = t("tour_title", {
    station: registry.label(query.origin),
    date: formatDate(query.date),
  });
  const cities = query.cities ?? [];
  if (cities.length === 0) {
    refs.results.append(render.emptyEl(t("tour_hint")));
    return;
  }
  const lo = query.minDays ?? 1;
  const hi = Math.max(lo, query.maxDays ?? 3);
  const planOpts = tourPlanOpts();
  const maxKm = query.maxKm; // optional cap on the tour's total straight-line km
  const legKm = query.maxLegKm; // optional cap on each hop's straight-line km
  // Optional fixed finish: end the tour at this city (may equal the start → a loop
  // back home). Empty = open-ended (end wherever the last nomad stop lands). With a
  // finish set, an optional end date requires arriving there on or before it.
  const end = query.destination || undefined;
  const endDate = end ? query.tourEndDate : undefined;
  // Flexible departure: the first hop may leave within ±flexDays of the chosen date
  // (never before today), so a tour is found even when nothing leaves on that exact day.
  const startFlex = query.flexDays ?? 0;
  // Up to 5 cities: try every order and pick the fastest. Beyond that, permuting
  // is factorial, so order them greedily (nearest reachable city each hop). If the
  // greedy route dead-ends, fall back to the typed order — a Surprise / "nearest
  // stop" run already builds a feasible chain in that order.
  let tours: Tour[];
  if (cities.length <= 5) {
    tours = planTours(trains, query.origin, cities, query.date, planOpts, 10, lo, hi, stationDistanceKm, maxKm, legKm, end, endDate, startFlex, today);
  } else {
    const single =
      planTourGreedy(trains, query.origin, cities, query.date, planOpts, lo, hi, stationDistanceKm, maxKm, legKm, end, endDate, startFlex, today) ??
      planTourInOrder(trains, query.origin, cities, query.date, planOpts, lo, hi, stationDistanceKm, maxKm, legKm, end, endDate, startFlex, today);
    tours = single ? [single] : [];
  }
  if (tours.length === 0) {
    refs.results.append(render.emptyEl(t("tour_none")), render.hintEl(t("tour_none_hint")));
    return;
  }
  for (const tour of tours) refs.results.append(render.tourEl(tour, c));
  // Draw the best tour as a single chained path (origin → city1 → city2 → …),
  // not a star of separate lines from the origin to each city.
  const best = tours[0];
  showRoute(best ? [query.origin, ...best.order] : [query.origin, ...cities]);
}

function runBestSearch(c: RenderCtx): void {
  const { trains, registry } = deps;
  if (!query.origin) return showHint(refs.origin);
  // "Round trip" toggle → ideas of good there-and-back escapes for the month.
  if (query.roundTrip) return runBestGetaways(c, query.origin);
  // No specific day picked → "all days": every destination reachable across the
  // whole window. Clicking a calendar day narrows to that day.
  const allDays = bestAllDays;
  refs.title.textContent = allDays
    ? t("best_title_all", { station: registry.label(query.origin) })
    : t("best_title", { station: registry.label(query.origin), date: formatDate(query.date) });
  // Ideas by day: a 30-day strip showing how many destinations run each day.
  // Clicking a day reloads that day's list (works even when today's is empty, so
  // you can hop to a better day).
  const inRegion = (d: string): boolean =>
    !query.region || registry.get(d)?.region === query.region;
  const window = dateRange(today, BOOKING_WINDOW_DAYS);
  // Count connection-aware destinations per day (matches the list, which includes
  // places reached via a stopover), so the calendar number is "destinations that day".
  const cal = reachableCountCalendar(
    trains,
    query.origin,
    window,
    { ...filterOpts(), maxConnections: query.maxConnections },
    inRegion,
  );
  refs.results.append(
    // In all-days mode no single day is "selected" — leave the strip unhighlighted.
    render.calendarEl(cal, c, allDays ? undefined : query.date, {
      title: t("best_cal_title"),
      count: (n) => t("best_cal_count", { n }),
      countLegend: t("cal_legend_dest"),
    }),
  );
  // Once a day is picked, offer a one-tap return to the full "all days" list.
  if (!allDays) {
    refs.results.append(
      el("p", { class: "best-alldays-row" }, [
        el("button", {
          class: "linklike best-alldays",
          type: "button",
          text: t("best_all_days"),
          on: {
            click: () => {
              bestAllDays = true;
              refreshInPlace();
            },
          },
        }),
      ]),
    );
  }

  const opts = { ...filterOpts(), maxConnections: query.maxConnections };
  let trips = allDays
    ? bestTripsAcrossWindow(trains, query.origin, window, opts)
    : bestTrips(trains, query.origin, query.date, stationsOnDate(trains, query.date), opts);
  if (query.region) {
    trips = trips.filter((tr) => registry.get(tr.destination)?.region === query.region);
  }
  if (trips.length === 0) {
    refs.results.append(render.emptyEl(t("res_none")), render.hintEl(t("res_none_hint")));
    return;
  }

  // Month-long train count per destination (same figure as the "Where to?" list),
  // so an idea shows how well-served it is before you drill in.
  const stats = windowStats(trains, query.origin, "from", filterOpts());
  // Sort by trains / days reachable / distance / name; "rec" keeps fastest-first.
  const origin = query.origin;
  const sorted = applySort(trips, {
    name: (tr) => registry.label(tr.destination),
    trains: (tr) => stats.get(tr.destination)?.trains ?? 0,
    days: (tr) => tr.days ?? 0,
    distanceKm: (tr) => stationDistanceKm(origin, tr.destination),
    durationMin: (tr) => tr.journey.totalDurationMin,
  });
  refs.results.append(
    render.listToolbarEl(
      t("res_destinations", { n: trips.length }),
      query.sort ?? "rec",
      sortOptions(["rec", "trains", "days", "closest", "name"]),
      onSort,
    ),
  );
  for (const tr of sorted)
    refs.results.append(render.bestTripRowEl(tr, c, stats.get(tr.destination)?.trains));
  showMap(query.origin, sorted.map((tr) => tr.destination));
}

/**
 * "Ideas" round trips: the best there-and-back escape to every destination,
 * scanned across the whole booking month (or a single picked day). Pairs the
 * round-trip toggle with best mode so you can discover good getaways for the
 * month, not just a one-way list. Ranked by nights, then time on site / travel.
 */
function runBestGetaways(c: RenderCtx, origin: string): void {
  const { trains, registry } = deps;
  const allDays = bestAllDays;
  refs.title.textContent = allDays
    ? t("best_round_title_all", { station: registry.label(origin) })
    : t("best_round_title", { station: registry.label(origin), date: formatDate(query.date) });
  const inRegion = (d: string): boolean => !query.region || registry.get(d)?.region === query.region;
  const window = dateRange(today, BOOKING_WINDOW_DAYS);
  const opts = getawayOpts();
  // One whole-window scan drives the by-day calendar (round trips startable each
  // day) so the calendar matches the round-trip list — a green day is one you can
  // actually start a getaway on, and its number is how many.
  const whole = getawayIdeas(trains, origin, window, opts, inRegion);
  refs.results.append(
    render.calendarEl(whole.perDay, c, allDays ? undefined : query.date, {
      title: t("best_round_cal_title"),
      count: (n) => t("best_round_count", { n }),
      countLegend: t("cal_legend_round"),
    }),
  );
  // All-days lists the best escape per destination; a picked day lists just that
  // day's round trips (a cheap single-day re-scan, mostly served from the cache).
  const trips = allDays ? whole.trips : getawayIdeas(trains, origin, [query.date], opts, inRegion).trips;
  if (!allDays) {
    refs.results.append(
      el("p", { class: "best-alldays-row" }, [
        el("button", {
          class: "linklike best-alldays",
          type: "button",
          text: t("best_all_days"),
          on: {
            click: () => {
              bestAllDays = true;
              refreshInPlace();
            },
          },
        }),
      ]),
    );
  }
  if (trips.length === 0) {
    refs.results.append(render.emptyEl(t("getaway_none")), render.hintEl(t("getaway_none_hint")));
    showMap(origin, []);
    return;
  }
  // Sort by distance / total travel / name; "rec" keeps the best-stay default.
  const sorted = applySort(trips, {
    name: (g) => registry.label(g.destination),
    distanceKm: (g) => stationDistanceKm(origin, g.destination),
    durationMin: (g) => g.travelMin,
  });
  refs.results.append(
    render.listToolbarEl(
      t("best_round_count", { n: trips.length }),
      query.sort ?? "rec",
      sortOptions(["rec", "closest", "fastest", "name"]),
      onSort,
    ),
  );
  // Trips fall on different start days across the month, so each row shows its date.
  for (const trip of sorted) refs.results.append(render.getawayRowEl(trip, c, { showDate: true }));
  showMap(origin, sorted.map((trip) => trip.destination));
}

function runOdSearch(c: RenderCtx): void {
  const { trains, registry } = deps;
  if (!query.origin || !query.destination) {
    return showHint(query.origin ? refs.destination : refs.origin);
  }
  odReturnDate = query.returnDate ?? null;
  refs.title.textContent = t("res_od_title", {
    origin: registry.label(query.origin),
    destination: registry.label(query.destination),
    date: formatDate(query.date),
  });
  refs.results.append(el("p", { class: "od-guide" }, [render.guideLinkEl(c, query.destination)]));

  // A "via" forces the route through a chosen station: add it to the allowed
  // interchange set, require ≥1 change, and keep only journeys passing through it.
  // A via that equals an endpoint is meaningless (the route already goes there),
  // so treat it as no via — otherwise it would require an interchange at the
  // origin/destination, which never appears in `hubs`, and return zero results.
  const viaId =
    query.via && query.via !== query.origin && query.via !== query.destination
      ? query.via
      : undefined;
  const connOpts = {
    ...filterOpts(),
    maxConnections: viaId ? Math.max(1, query.maxConnections) : query.maxConnections,
    ...(viaId ? { hubs: [...HUB_STATIONS, viaId] } : {}),
  };
  const passesVia = (j: Journey): boolean => !viaId || j.hubs.includes(viaId);

  // 30-day availability calendar, anchored to today's bookable window (not the
  // selected date) so clicking a day doesn't shift the strip. The chosen date is
  // highlighted in place.
  const windowDates = dateRange(today, BOOKING_WINDOW_DAYS);
  const cal = availabilityCalendar(trains, query.origin, query.destination, windowDates, connOpts, passesVia);
  // With a radius set, flag days the exact route can't cover but a nearby station
  // can — single-end substitution (amber) vs both-ends substitution (a third
  // colour), so the level of effort each day needs reads at a glance.
  if (query.radiusKm) {
    const levels = nearbyCalendarLevels(query.origin, query.destination, windowDates, query.radiusKm, {
      ...filterOpts(),
      maxConnections: query.maxConnections,
    });
    for (const d of cal) {
      if (d.available) continue;
      const lvl = levels.get(d.date);
      if (lvl === 1) d.nearby = true;
      else if (lvl === 2) d.nearbyBoth = true;
    }
  }
  refs.results.append(render.calendarEl(cal, c, query.date));

  const lastBookable = addDays(today, BOOKING_WINDOW_DAYS - 1);
  // A journey's day-span cap (e.g. "no trip longer than 2 days"): overnight
  // stopovers can chain trains across days, so cap the calendar span here.
  const withinSpan = (j: Journey): boolean =>
    !query.maxSpanDays || journeySpanDays(j) <= query.maxSpanDays;

  // A multi-day trip span pools that many days of trains so journeys can chain
  // hops with multi-day stopovers at hubs ("show every way to get there over N
  // days"). The 30-day calendar keeps the cheap 2-day search — it's just a per-day
  // availability hint, not the itinerary list.
  const spanDays = query.maxSpanDays && query.maxSpanDays > 2 ? query.maxSpanDays : undefined;
  const journeyOpts = spanDays ? { ...connOpts, spanDays } : connOpts;

  // Sort by total travel time, fastest first (then earliest departure as a
  // tiebreak) so the best option is at the top of the list and the slowest last.
  const raw = findJourneys(trains, query.origin, query.destination, query.date, journeyOpts);
  const journeys: Journey[] = raw
    .filter(passesVia)
    .filter(withinSpan)
    .sort((a, b) => a.totalDurationMin - b.totalDurationMin || a.departMin - b.departMin);
  // The outbound chosen for the round trip — defaults to the fastest; clicking a
  // journey card picks it, so "come back?" pairs returns with the leg you want.
  let chosenOutbound: Journey | null = journeys[0] ?? null;
  // Radius alternatives up front: when the exact route has no seat but a nearby
  // station within the radius does, defer to that section instead of showing a
  // bare "no MAX seat" message.
  const radiusAlt = query.radiusKm
    ? nearbyAlternatives(query.origin, query.destination, query.date, query.radiusKm, {
        ...filterOpts(),
        maxConnections: query.maxConnections,
      })
    : null;
  const hasNearby =
    !!radiusAlt &&
    (radiusAlt.fromOrigin.length > 0 || radiusAlt.toDest.length > 0 || radiusAlt.bothEnds.length > 0);
  if (journeys.length === 0) {
    // Suppress the empty message when nearby alternatives will fill the gap below.
    if (!hasNearby) refs.results.append(render.emptyEl(t("res_none")), render.hintEl(t("res_none_hint")));
  } else {
    // A wide span can return dozens of itineraries — count them, and be honest when
    // the search hit its internal cap (more multi-day routes exist than shown).
    if (spanDays) {
      refs.results.append(
        el("p", { class: "muted count", text: t("res_itineraries", { n: journeys.length }) }),
      );
      if (raw.length >= MAX_RESULTS) {
        refs.results.append(render.hintEl(t("res_capped", { n: MAX_RESULTS })));
      }
    }
    const ret = tripType === "return";
    for (const j of journeys)
      refs.results.append(
        ret
          ? render.journeyEl(j, c, {
              selected: j === chosenOutbound,
              onPick: (jj) => {
                chosenOutbound = jj;
              },
              onArrow: (jj) => {
                chosenOutbound = jj;
                refs.results
                  .querySelector<HTMLElement>(".od-return")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              },
            })
          : render.journeyEl(j, c),
      );
  }

  // Nearby paid-connection alternatives (radius search): surface nearby stations
  // that DO have a free MAX seat, so you can pay a short hop to/from one when the
  // exact route has none. Most useful with zero direct journeys, but always shown
  // when a radius is set. Their ids also feed the map circles below.
  let nearbyIds: string[] = [];
  if (query.radiusKm && radiusAlt) {
    const alt = radiusAlt;
    nearbyIds = [
      ...alt.fromOrigin.map((x) => x.id),
      ...alt.toDest.map((x) => x.id),
      ...alt.bothEnds.flatMap((x) => [x.from.id, x.to.id]),
    ];
    const sec = el("section", { class: "nearby" }, [
      el("h3", { text: t("nearby_title", { km: query.radiusKm }) }),
      el("p", { class: "muted small", text: t("nearby_hint") }),
    ]);
    if (alt.fromOrigin.length === 0 && alt.toDest.length === 0 && alt.bothEnds.length === 0) {
      sec.append(render.emptyEl(t("nearby_none")));
    } else {
      if (alt.fromOrigin.length) {
        sec.append(el("h4", { class: "nearby-sub", text: t("nearby_from_origin", { station: registry.label(query.origin) }) }));
        for (const a of alt.fromOrigin) sec.append(render.nearbyTripRowEl(a.id, Math.round(a.km), a.journey, c));
      }
      if (alt.toDest.length) {
        sec.append(el("h4", { class: "nearby-sub", text: t("nearby_to_dest", { station: registry.label(query.destination) }) }));
        for (const a of alt.toDest) sec.append(render.nearbyTripRowEl(a.id, Math.round(a.km), a.journey, c));
      }
      // Both ends substituted — the only option is leaving from AND arriving at a
      // nearby station. Shown only when neither single substitution worked.
      if (alt.bothEnds.length) {
        sec.append(el("h4", { class: "nearby-sub", text: t("nearby_both") }));
        for (const a of alt.bothEnds)
          sec.append(
            render.nearbyBothRowEl(a.from.id, Math.round(a.from.km), a.to.id, Math.round(a.to.km), a.journey, c),
          );
      }
    }
    refs.results.append(sec);
  }

  // "Do you want to come back?": a return availability calendar (every bookable
  // return day at a glance) plus a stay-N-nights quick pick. Picking a day lists
  // that day's free-MAX returns and lets you open the whole round trip on one page.
  // Only for a round trip (aller-retour) — a one-way search shows no return.
  if (tripType === "return" && journeys.length > 0) {
    const origin = query.origin;
    const destination = query.destination;
    const proposed =
      odReturnDate ?? (addDays(query.date, 2) > lastBookable ? lastBookable : addDays(query.date, 2));
    const returnOpts = {
      ...filterOpts(),
      maxConnections: query.maxConnections,
      ...(spanDays ? { spanDays } : {}),
    };
    // Availability of a free-MAX return (destination → origin) for every bookable
    // day from the outbound date onward — so all return options are visible at once.
    const retDates = dateRange(query.date, dayIndex(lastBookable) - dayIndex(query.date) + 1);
    const cal = availabilityCalendar(trains, destination, origin, retDates, returnOpts, withinSpan);
    const retCal = el("div", { class: "ret-cal" });
    const retList = el("div", { class: "return-list" });
    let selectReturn: (retDate: string) => void = () => {};
    // The return calendar reuses the journey ctx but redirects day clicks to the
    // return date (not the outbound date, which the main calendar owns).
    const retCtx: RenderCtx = { ...c, onSelectDay: (d) => selectReturn(d) };
    const renderReturns = (retDate: string): void => {
      clear(retList);
      const back = findJourneys(trains, destination, origin, retDate, returnOpts)
        .filter(withinSpan)
        .sort((a, b) => a.totalDurationMin - b.totalDurationMin || a.departMin - b.departMin);
      const nights = dayIndex(retDate) - dayIndex(query.date);
      retList.append(
        el("p", {
          class: "muted ret-summary",
          text: nights > 0 ? t("getaway_nights", { n: nights }) : t("nights_sameday"),
        }),
      );
      if (back.length === 0) {
        retList.append(render.emptyEl(t("ret_none")));
        return;
      }
      // Clicking a return opens the whole round trip (the chosen outbound + this
      // return) on one page, ready to book both legs and save.
      for (const j of back)
        retList.append(
          render.journeyEl(j, c, {
            onPick: () => {},
            onArrow: (rj) => showTripModal(chosenOutbound!, c, { inbound: rj, onShare: shareCurrentUrl }),
          }),
        );
    };
    selectReturn = (retDate: string): void => {
      odReturnDate = retDate;
      clear(retCal);
      retCal.append(render.calendarEl(cal, retCtx, retDate, { title: t("ret_cal_title") }));
      renderReturns(retDate);
    };
    selectReturn(proposed);
    refs.results.append(el("section", { class: "od-return" }, [el("h3", { text: t("ret_title") }), retCal, retList]));
  }

  // Draw the most relevant journey as an ordered path (origin → via → destination),
  // so a correspondence shows up as a secondary point on the line. The list is
  // sorted fastest-first, so the first journey is the quickest.
  const display = journeys[0] ?? null;
  showRoute(display ? [display.origin, ...display.hubs, display.destination] : [query.origin, query.destination]);
  // Overlay the search-radius circles + nearby-station markers on top of the route.
  if (query.radiusKm) {
    showRadius(
      [
        { id: query.origin, km: query.radiusKm },
        { id: query.destination, km: query.radiusKm },
      ],
      nearbyIds,
    );
  }
}

/** Coarse pointer ≈ touch/phone. */
function showHint(input: HTMLInputElement): void {
  // Empty state: no nagging prompt — just a blank heading and a ready cursor.
  refs.title.textContent = "";
  // On phones, don't auto-focus the field: it pops the keyboard + the station
  // suggestion dropdown over the whole UI on entry. Let the user tap it first.
  if (!isTouch()) input.focus({ preventScroll: true });
}

function goBack(): void {
  const prev = navStack.pop();
  if (!prev) return;
  query = prev;
  syncFormFromQuery();
  store.updateUrl(query);
  runSearch();
  refs.title.focus(); // announce the restored context to screen readers
}

/** Reset to the landing state (clicking the logo). Keeps language/theme/card. */
function goHome(): void {
  navStack = [];
  query = { mode: "from", date: today, card: settings.card, maxConnections: 1, excludeNight: true };
  syncFormFromQuery();
  applyAndRun();
  setMobileForm(true);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/** Switch trip type (tab click or 1–4 shortcut), starting a fresh history. */
function switchTab(next: TripType): void {
  navStack = [];
  tripType = next;
  if (next === "ideas") bestAllDays = true;
  setActiveTab(tripType);
  refs.modeDesc.textContent = t(`desc_${tripType}` as const);
  updateFieldVisibility();
  query = readQueryFromForm();
  applyAndRun();
}

/** Run a fresh search from the current form (submit or "g" shortcut). */
function runFromForm(): void {
  navStack = [];
  // In Ideas, running the search honours the date picked in the form (that day's
  // ideas), rather than the whole-window "all days" overview.
  if (tripType === "ideas") bestAllDays = false;
  query = readQueryFromForm();
  applyAndRun();
  setMobileForm(false);
}

/** Shift the chosen date by `delta` days, clamped to the bookable window. */
function shiftDay(delta: number): void {
  const last = addDays(today, BOOKING_WINDOW_DAYS - 1);
  const d = addDays(query.date, delta);
  if (d < today || d > last) return;
  query = { ...query, date: d };
  refreshInPlace();
}

/** A modal listing the keyboard shortcuts (the "?" key or header button). */
function showShortcutsHelp(): void {
  showInfoModal(t("keys_title"), [
    t("keys_modes"),
    t("keys_focus"),
    t("keys_day"),
    t("keys_surprise"),
    t("keys_nearest"),
    t("keys_clear"),
    t("keys_run"),
    t("keys_back"),
    t("keys_help"),
  ]);
}


/**
 * Global keyboard shortcuts. Order matters: Escape first (also closes the help
 * dialog natively), then bail on modifiers / while typing / under an open dialog.
 */
function onGlobalKey(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    // A modal <dialog> closes itself on Escape — bail before any page shortcut so
    // we neither navigate the page behind it nor preventDefault its native close.
    if (document.querySelector("dialog[open]")) return;
    // Cancel a search that's still loading (stop the spinner) before anything else.
    if (cancelLoading()) {
      e.preventDefault();
      return;
    }
    const tgt = e.target as HTMLElement | null;
    // Escape the search bar first: blur whatever field is focused.
    if (tgt && /^(INPUT|SELECT|TEXTAREA)$/.test(tgt.tagName)) {
      tgt.blur();
      e.preventDefault();
      return;
    }
    // In Ideas narrowed to a single day, return to the "all days" overview.
    if (query.mode === "best" && !bestAllDays) {
      e.preventDefault();
      bestAllDays = true;
      refreshInPlace();
      return;
    }
    if (navStack.length) {
      e.preventDefault();
      goBack();
    }
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return; // leave browser/OS combos alone
  const tgt = e.target as HTMLElement | null;
  if (tgt && (/^(INPUT|SELECT|TEXTAREA)$/.test(tgt.tagName) || tgt.isContentEditable)) return;
  if (document.querySelector("dialog[open]")) return; // not while a modal is up

  if (/^[1-4]$/.test(e.key)) {
    e.preventDefault();
    switchTab(TRIP_TABS[Number(e.key) - 1]!);
  } else if (e.key === "/") {
    e.preventDefault();
    const f = deriveMode() === "to" ? refs.destination : refs.origin;
    f.focus();
    f.select();
  } else if (e.key === "[") {
    e.preventDefault();
    shiftDay(-1);
  } else if (e.key === "]") {
    e.preventDefault();
    shiftDay(1);
  } else if (e.key === "s") {
    e.preventDefault();
    surpriseMe();
  } else if (e.key === "n" && tripType === "multi") {
    e.preventDefault();
    addNearestCity(); // tour-only: grow the trip to the nearest reachable stop
  } else if (e.key === "c" && tripType === "multi") {
    e.preventDefault();
    clearTourCities(); // tour-only: clear every "city to visit" at once
  } else if (e.key === "g") {
    e.preventDefault();
    runFromForm();
  } else if (e.key === "?") {
    e.preventDefault();
    showShortcutsHelp();
  }
}

/**
 * "Surprise me": stay on the current page and randomize that mode's own city —
 * a random city added to "Tour", a random arrival in "D'où venir", a random
 * reachable destination (keeping the origin) in "Trajet précis", and a random
 * departure elsewhere. Purely random, never a city that's already selected.
 */
function surpriseMe(): void {
  // Snapshot the live form first: "Surprise me" builds on top of the current query
  // and then re-syncs the form from it, so it must start from what's ACTUALLY in the
  // form (a cleared destination, a toggled filter) — not the stale last-searched
  // query, which would resurrect edits the user just made (e.g. a removed city).
  query = readQueryFromForm();
  const avail = deps.trains.filter((tr) => tr.available);
  const pickFrom = (xs: string[], not?: string): string | undefined => {
    const pool = not ? xs.filter((x) => x !== not) : xs;
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : undefined;
  };
  const origins = (): string[] => [...new Set(avail.map((t) => t.origin))];
  const destinations = (): string[] => [...new Set(avail.map((t) => t.destination))];
  // When a region is selected (best / tour modes), the surprise departure must
  // sit inside it — "I want to start my trip in Bretagne".
  const inRegion = (id: string): boolean =>
    !query.region || deps.registry.get(id)?.region === query.region;
  const regionOrigins = (): string[] => origins().filter(inRegion);

  setSurpriseMsg(""); // clear any prior "nothing to add" notice

  if (query.mode === "tour") {
    // Tour: fill the departure if empty, then add cities (the "Cities to add" count,
    // default 1) — each a random hop that keeps the WHOLE tour feasible. So "find me
    // 5 cities" is one click with the count set to 5.
    growTour("random", tourAddCount());
    return;
  } else if (query.mode === "to") {
    const dest = pickFrom(destinations(), query.destination);
    if (!dest) return;
    query = { ...query, destination: dest };
  } else if (query.mode === "od") {
    // Trajet précis: the random pick must have a direct MAX train on the SELECTED
    // date (passing the active filters), so the result is never empty for that day.
    const sameDay = filterTrains(deps.trains, {
      ...filterOpts(),
      date: query.date,
      ...(query.origin ? { origin: query.origin } : {}),
    });
    if (query.origin) {
      // Keep the origin; randomize only the destination.
      const dest = pickFrom([...new Set(sameDay.map((t) => t.destination))], query.destination);
      if (!dest) return;
      query = { ...query, destination: dest };
    } else {
      // No departure station: random for both — a real origin → destination pair
      // that runs that day.
      const pairs = [...new Map(sameDay.map((t) => [`${t.origin}->${t.destination}`, t])).values()];
      const p = pairs.length ? pairs[Math.floor(Math.random() * pairs.length)] : undefined;
      if (!p) return;
      query = { ...query, origin: p.origin, destination: p.destination };
    }
  } else {
    // from / best: a random departure city, staying in the same mode. In "best"
    // a chosen region constrains it to a departure inside that region.
    const pool = query.mode === "best" ? regionOrigins() : origins();
    const origin = pickFrom(pool, query.origin);
    if (!origin) {
      if (query.mode === "best" && query.region) setSurpriseMsg(t("surprise_none"));
      return;
    }
    query = { ...query, origin };
  }
  navStack = [];
  syncFormFromQuery();
  applyAndRun();
  setMobileForm(false);
}

function ensureMap(): Promise<RouteMap> {
  if (!mapPromise) {
    const host = refs.mapEl;
    mapPromise = import("./ui/map").then(
      ({ RouteMap: MapCtor }) => {
        const m = new MapCtor(host, deps.registry);
        m.onSelect = selectStation;
        m.onHover = onMarkerHover;
        mapInstance = m;
        return m;
      },
      (err: unknown) => {
        mapPromise = null;
        throw err;
      },
    );
  }
  return mapPromise;
}

function showMap(hub: string, others: string[], info?: Map<string, MarkerInfo>): void {
  ensureMap()
    .then((m) => {
      m.setInfo(info ?? new Map());
      m.show(hub, [...new Set(others)]);
      requestAnimationFrame(() => m.invalidate());
    })
    .catch(() => {});
}

function showRoute(stations: string[]): void {
  ensureMap()
    .then((m) => {
      m.route(stations);
      requestAnimationFrame(() => m.invalidate());
    })
    .catch(() => {});
}

/** Reset the map to the bare France basemap (no markers) — the pre-search state. */
function showBaseMap(): void {
  ensureMap()
    .then((m) => {
      m.base();
      requestAnimationFrame(() => m.invalidate());
    })
    .catch(() => {});
}

/** Overlay radius circles + nearby-station markers on the current route map. */
function showRadius(centers: { id: string; km: number }[], nearby: string[]): void {
  ensureMap()
    .then((m) => {
      m.radius(centers, nearby);
      requestAnimationFrame(() => m.invalidate());
    })
    .catch(() => {});
}

/** Open the destination matching a clicked map marker — navigates to its calendar. */
function selectStation(id: string): void {
  const sel = `[data-station="${id.replace(/["\\]/g, "\\$&")}"]`;
  const card = refs.results.querySelector<HTMLElement>(sel);
  if (!card) return;
  const open = card.querySelector<HTMLElement>(".dest-main");
  if (open) {
    open.click();
    return;
  }
  const panel = card.querySelector<HTMLElement>(".dest-panel");
  if (panel?.hasAttribute("hidden")) panel.removeAttribute("hidden");
  markSelected(id);
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.classList.add("flash");
  window.setTimeout(() => card.classList.remove("flash"), 1100);
}

/**
 * Persistently highlight a destination — its results card and its map pin — and
 * clear the previous selection, so it stays clear which place is being looked at.
 */
function markSelected(id: string): void {
  for (const prev of refs.results.querySelectorAll(".is-selected")) prev.classList.remove("is-selected");
  const sel = `[data-station="${id.replace(/["\\]/g, "\\$&")}"]`;
  refs.results.querySelector<HTMLElement>(sel)?.classList.add("is-selected");
  mapInstance?.highlight(id);
}

function onMarkerHover(id: string | null): void {
  for (const c of refs.results.querySelectorAll(".is-hover")) c.classList.remove("is-hover");
  if (!id) return;
  const sel = `[data-station="${id.replace(/["\\]/g, "\\$&")}"]`;
  const card = refs.results.querySelector<HTMLElement>(sel);
  if (!card) return;
  card.classList.add("is-hover");
  card.scrollIntoView({ block: "nearest" });
}

// --- watched routes ---------------------------------------------------------

function checkWatchedRoutes(): void {
  const watched = store.loadWatched();
  if (watched.length === 0) return;
  for (const r of watched) {
    const has = deps.trains.some(
      (tr) => tr.available && tr.origin === r.origin && tr.destination === r.destination,
    );
    if (has) {
      notify(
        t("appName"),
        `${deps.registry.label(r.origin)} → ${deps.registry.label(r.destination)} : MAX dispo`,
      );
    }
  }
}

// --- theme ------------------------------------------------------------------

// --- layout -----------------------------------------------------------------

function setActiveTab(trip: TripType): void {
  for (const btn of [...Array.from(refs.modeTabs.children), refs.ideasBtn]) {
    const active = (btn as HTMLElement).dataset.trip === trip;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  }
}

function updateFieldVisibility(): void {
  const ret = tripType === "return";
  const multi = tripType === "multi";
  const ideas = tripType === "ideas";
  const single = tripType === "simple" || ret;

  refs.originField.style.display = multi ? "none" : "";
  refs.destinationField.style.display = ideas || multi ? "none" : "";
  refs.dateField.style.display = multi ? "none" : "";
  refs.legsBlock.style.display = multi ? "" : "none";
  refs.origin.placeholder = single ? t("ph_anywhere") : "";
  refs.destination.placeholder = single ? t("ph_anywhere") : "";
  refs.departDate.setRange(ret);
  refreshTourEndDate();

  refs.viaField.style.display = single ? "" : "none";
  refs.onlyNightField.style.display = refs.night.checked ? "" : "none";
  refs.surpriseBtn.style.display = multi ? "none" : "";

  refs.maxDurationField.style.display = multi ? "none" : "";
  refs.maxLegDurationField.style.display = "none";
  refs.minLegDurationField.style.display = "none";

  refs.regionField.style.display = ideas ? "" : "none";
  refs.citiesField.style.display = "none";
  refs.tourCountField.style.display = "none";
  refs.stayField.style.display = "none";
  refs.maxKmField.style.display = "none";
  refs.maxSpanDaysField.style.display = single ? "" : "none";
  refs.radiusField.style.display = single ? "" : "none";
  if (nearestBtnEl) nearestBtnEl.style.display = "none";
}

function refreshTourEndDate(): void {
  refs.endDateField.style.display = "none";
}

/** The footer's "data updated …" line, localized (or the sample-data notice). */
function footerUpdatedText(): string {
  const meta = deps.meta;
  const when = meta.updatedAt
    ? new Date(meta.updatedAt).toLocaleString(getLang(), {
        dateStyle: "medium",
        timeStyle: "short",
        hourCycle: "h23",
      })
    : "";
  return when
    ? t("foot_updated", { date: when }) + (meta.isSample ? ` (${t("foot_sample")})` : "")
    : t("foot_sample");
}

function buildLayout(root: HTMLElement): void {
  clear(root);

  const built = buildForm();
  const shell = buildShell({
    theme: settings.theme,
    card: settings.card,
    updatedText: footerUpdatedText(),
    form: built.form,
    githubUrl: GITHUB_URL,
    issuesUrl: GITHUB_ISSUES_URL,
    goHome,
    onLang: (code) => {
      settings = { ...settings, lang: isLang(code) ? code : "fr" };
      setLang(settings.lang);
      store.saveSettings(settings);
      rebuild();
    },
    onThemeChange: (theme) => {
      settings = { ...settings, theme };
      store.saveSettings(settings);
    },
    onCard: (card) => {
      settings = { ...settings, card };
      store.saveSettings(settings);
      query = { ...query, card };
      store.updateUrl(query);
      runSearch();
    },
    onShare: (onCopied) => void shareCurrentUrl(onCopied),
    onInstall: () => void promptInstall(),
    onShortcuts: showShortcutsHelp,
    onOpenMobileForm: () => setMobileForm(true),
    onSelect: (id) => markSelected(id),
    onPeek: (id) => mapInstance?.peek(id),
  });

  root.append(shell.header, shell.layout);
  root.dataset.mform = "form";

  refs = {
    ...built.refs,
    title: shell.title,
    results: shell.results,
    mapEl: shell.mapEl,
    favList: shell.favList,
    tripList: shell.tripList,
    card: shell.cardSelect,
  };
  mapPromise = null;
  mapInstance = null;
  renderFavorites();
  renderSavedTrips();
}

// Distance from the document top to the results/map row (navbar + form + margins).
// Published as a CSS var so the map-first canvas can fill the viewport below the
// bars instead of a flat 100vh that overflows under them.
let lastAboveH = -1;
function updateRailMetrics(): void {
  const layoutEl = rootRef.querySelector<HTMLElement>(".layout");
  if (!layoutEl) return;
  const top = Math.round(layoutEl.getBoundingClientRect().top + window.scrollY);
  if (top === lastAboveH) return;
  lastAboveH = top;
  rootRef.style.setProperty("--above-h", `${top}px`);
  requestAnimationFrame(() => mapInstance?.invalidate());
}

function setMobileForm(open: boolean): void {
  if (!rootRef) return;
  rootRef.dataset.mform = open ? "form" : "results";
  if (!open) {
    updateSearchBar();
    updateRailMetrics();
    requestAnimationFrame(() => mapInstance?.invalidate());
  }
}

function updateSearchBar(): void {
  const bar = rootRef?.querySelector<HTMLElement>(".msearch-text");
  if (bar) bar.textContent = refs.title?.textContent || t("appName");
}

interface FormBuild {
  form: HTMLElement;
  refs: Omit<Refs, "title" | "results" | "mapEl" | "favList" | "tripList" | "card">;
}

interface DateFieldCtl {
  root: HTMLElement;
  input: HTMLInputElement;
  getMargin(): number;
  setMargin(n: number): void;
  setRange(on: boolean): void;
  setDate(date: string): void;
  setDates(out: string, ret: string): void;
  getReturn(): string;
  refresh(): void;
}

function popoverOpts() {
  return {
    maxConnections: Number(refs.maxConnections.value) || 0,
    departAfter: refs.departAfter.value || undefined,
    departBefore: refs.departBefore.value || undefined,
    arriveBefore: refs.arriveBefore.value || undefined,
    ...(refs.night.checked ? {} : { excludeNight: true }),
    ...(refs.night.checked && refs.onlyNight.checked ? { onlyNight: true } : {}),
    ...(refs.overnight.checked ? { maxConnectionMin: OVERNIGHT_MAX_CONNECTION_MIN } : {}),
  };
}

function computeAvail(
  o: string | undefined,
  d: string | undefined,
  kind: "out" | "ret",
  dates: string[],
): Map<string, number> {
  const opts = popoverOpts();
  const map = new Map<string, number>();
  let cal: { date: string; available: boolean; count: number }[] | null = null;
  if (kind === "ret") {
    if (o && d) cal = availabilityCalendar(deps.trains, d, o, dates, opts);
  } else if (o && d) {
    cal = availabilityCalendar(deps.trains, o, d, dates, opts);
  } else if (o) {
    cal = destinationCalendar(deps.trains, o, dates, opts);
  }
  if (cal) for (const c of cal) map.set(c.date, c.available ? c.count : 0);
  return map;
}

function makeDateField(label: string, routeFn?: () => { o?: string; d?: string }, bare = false): DateFieldCtl {
  const route = routeFn ?? (() => ({ o: resolveStation(refs.origin.value), d: resolveStation(refs.destination.value) }));
  const days = dateRange(today, BOOKING_WINDOW_DAYS);
  const lastBookable = days[days.length - 1] ?? today;
  const input = inputEl("date");
  input.min = today;
  input.max = lastBookable;
  input.classList.add("dp-native");

  let margin = 0;
  let isOpen = false;
  let range = false;
  let retDate = "";
  let awaitReturn = false;
  let avail = new Map<string, number>();
  const fmtShort = (d: string): string =>
    new Intl.DateTimeFormat(getLang(), { day: "numeric", month: "short" }).format(new Date(`${d}T00:00:00`));
  const phase = (): "out" | "ret" => (range && awaitReturn ? "ret" : "out");

  const valueText = el("span", { class: "dp-value-text" });
  const valueBadge = el("span", { class: "dp-value-badge", attrs: { hidden: "" } });
  const trigger = el(
    "button",
    { class: "dp-trigger input", type: "button", attrs: { "aria-haspopup": "dialog", "aria-expanded": "false" } },
    [valueText, valueBadge],
  );

  const marginVal = el("span", { class: "dp-margin-val", text: "0" });
  const marginMinus = el("button", { class: "dp-step", type: "button", text: "−", attrs: { "aria-label": "−1" } });
  const marginPlus = el("button", { class: "dp-step", type: "button", text: "+", attrs: { "aria-label": "+1" } });
  const marginRow = el("div", { class: "dp-margin" }, [
    el("span", { class: "dp-margin-label muted", text: t("field_flex") }),
    el("div", { class: "dp-margin-ctl" }, [
      marginMinus,
      el("span", { class: "dp-margin-box" }, [
        el("span", { class: "muted", text: "±" }),
        marginVal,
        el("span", { class: "muted", text: ` ${t("flex_days")}` }),
      ]),
      marginPlus,
    ]),
  ]);

  const dow = el("div", { class: "dp-dow" });
  const grid = el("div", { class: "dp-grid" });
  const legend = el("p", { class: "dp-legend muted" });
  const pop = el("div", { class: "datepop", attrs: { role: "dialog", hidden: "" } }, [marginRow, dow, grid, legend]);
  const wrap = el("div", { class: "datefield" }, [trigger, input]);
  const root = bare ? wrap : field(label, wrap);
  document.body.append(pop);

  const leading = (new Date(`${today}T00:00:00`).getDay() + 6) % 7;
  const refMonday = addDays(today, -leading);
  for (let i = 0; i < 7; i++) dow.append(el("span", { class: "dp-dow-c", text: formatWeekday(addDays(refMonday, i)) }));

  const setLabel = (): void => {
    if (range) {
      const a = input.value ? fmtShort(input.value) : t("field_depart");
      const b = retDate ? fmtShort(retDate) : t("field_ret");
      valueText.textContent = `${a} → ${b}`;
    } else {
      valueText.textContent = input.value ? formatDate(input.value) : t("field_date");
    }
    if (margin > 0) {
      valueBadge.textContent = `±${margin}`;
      valueBadge.removeAttribute("hidden");
    } else {
      valueBadge.setAttribute("hidden", "");
    }
  };

  const pick = (date: string): void => {
    if (range) {
      if (awaitReturn && date >= input.value) {
        retDate = date;
        awaitReturn = false;
        setLabel();
        paint();
        input.dispatchEvent(new Event("change", { bubbles: true }));
        close();
        return;
      }
      input.value = date;
      retDate = "";
      awaitReturn = true;
      setLabel();
      input.dispatchEvent(new Event("change", { bubbles: true }));
      refresh();
      return;
    }
    input.value = date;
    setLabel();
    paint();
    input.dispatchEvent(new Event("change", { bubbles: true }));
    close();
  };

  const paint = (): void => {
    clear(grid);
    for (let i = 0; i < leading; i++) grid.append(el("span", { class: "dp-cell dp-blank" }));
    const out = input.value;
    const outIdx = out ? dayIndex(out) : -1;
    const retIdx = retDate ? dayIndex(retDate) : -1;
    const picking = range && awaitReturn;
    const known = avail.size > 0;
    let anyOk = false;
    for (const date of days) {
      const di = dayIndex(date);
      const before = picking && di < outIdx;
      const ok = !before && (avail.get(date) ?? 0) > 0;
      if (ok) anyOk = true;
      const isSel = date === out || (range && date === retDate);
      const inRange = range && outIdx >= 0 && retIdx >= 0 && di > outIdx && di < retIdx;
      const nearOut = margin > 0 && outIdx >= 0 && Math.abs(di - outIdx) <= margin;
      const nearRet = range && margin > 0 && retIdx >= 0 && Math.abs(di - retIdx) <= margin;
      const inWin = !isSel && !inRange && (nearOut || nearRet);
      const cls = [
        "dp-cell",
        ok ? "ok" : before || known ? "no" : "",
        isSel ? "sel" : "",
        inRange ? "range" : "",
        inWin ? "win" : "",
      ]
        .filter(Boolean)
        .join(" ");
      grid.append(
        el("button", {
          class: cls,
          type: "button",
          text: date.slice(8, 10),
          attrs: { "aria-label": formatDate(date), "data-date": date, ...(isSel ? { "aria-current": "date" } : {}) },
          on: { click: () => pick(date) },
        }),
      );
    }
    legend.textContent = margin > 0 ? t("datepick_window") : anyOk ? t("cal_legend") : "";
  };

  const refresh = (): void => {
    const r = route();
    avail = computeAvail(r.o, r.d, phase(), days);
    paint();
  };

  const onDocClick = (e: MouseEvent): void => {
    const n = e.target as Node;
    if (!wrap.contains(n) && !pop.contains(n)) close();
  };
  const place = (): void => {
    const r = trigger.getBoundingClientRect();
    const w = pop.offsetWidth;
    let left = r.left;
    if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - w);
    pop.style.top = `${Math.round(r.bottom + 6)}px`;
    pop.style.left = `${Math.round(left)}px`;
  };
  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    pop.setAttribute("hidden", "");
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onDocClick, true);
    window.removeEventListener("scroll", place, true);
    window.removeEventListener("resize", place);
  }
  const openPop = (): void => {
    isOpen = true;
    refresh();
    pop.removeAttribute("hidden");
    place();
    trigger.setAttribute("aria-expanded", "true");
    document.addEventListener("click", onDocClick, true);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
  };
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    isOpen ? close() : openPop();
  });
  pop.addEventListener("click", (e) => e.stopPropagation());
  pop.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      close();
      trigger.focus();
    }
  });
  grid.addEventListener("mouseover", (e) => {
    if (!range || !awaitReturn) return;
    const cell = (e.target as HTMLElement).closest<HTMLElement>(".dp-cell");
    const hover = cell?.getAttribute("data-date");
    if (!hover) return;
    const outIdx = dayIndex(input.value);
    const hi = dayIndex(hover);
    for (const c of Array.from(grid.children) as HTMLElement[]) {
      const cd = c.getAttribute("data-date");
      c.classList.toggle("preview", Boolean(cd) && hi >= outIdx && dayIndex(cd!) > outIdx && dayIndex(cd!) <= hi);
    }
  });
  grid.addEventListener("mouseleave", () => {
    for (const c of Array.from(grid.children) as HTMLElement[]) c.classList.remove("preview");
  });

  const setMarginVal = (n: number): void => {
    margin = Math.max(0, Math.min(FLEX_MAX, Math.floor(Number.isFinite(n) ? n : 0)));
    marginVal.textContent = String(margin);
    setLabel();
    if (isOpen) paint();
  };
  marginMinus.addEventListener("click", (e) => {
    e.stopPropagation();
    setMarginVal(margin - 1);
  });
  marginPlus.addEventListener("click", (e) => {
    e.stopPropagation();
    setMarginVal(margin + 1);
  });

  setLabel();

  return {
    root,
    input,
    getMargin: () => margin,
    setMargin: (n) => setMarginVal(n),
    setRange: (on) => {
      range = on;
      if (!on) retDate = "";
      awaitReturn = false;
      setLabel();
      if (isOpen) refresh();
    },
    setDate: (d) => {
      input.value = d;
      setLabel();
      if (isOpen) paint();
    },
    setDates: (out, ret) => {
      input.value = out;
      retDate = range ? ret : "";
      awaitReturn = false;
      setLabel();
      if (isOpen) refresh();
    },
    getReturn: () => retDate,
    refresh,
  };
}

interface LegCtl {
  from: HTMLInputElement;
  to: HTMLInputElement;
  dateCtl: DateFieldCtl;
  row: HTMLElement;
  remove: HTMLElement;
}
let legRows: LegCtl[] = [];
let legsContainer: HTMLElement | null = null;

function makeLeg(fromVal = "", toVal = "", dateVal = ""): LegCtl {
  const from = inputEl("text", "station-list");
  const to = inputEl("text", "station-list");
  from.value = fromVal;
  to.value = toVal;
  from.placeholder = t("field_origin");
  to.placeholder = t("field_destination");
  for (const inp of [from, to]) {
    inp.addEventListener("input", () => inp.classList.remove("is-invalid"));
    inp.addEventListener("change", () => {
      const v = inp.value.trim();
      inp.classList.toggle("is-invalid", v !== "" && !resolveStation(v));
    });
  }
  const dateCtl = makeDateField(
    t("field_date"),
    () => ({ o: resolveStation(from.value), d: resolveStation(to.value) }),
    true,
  );
  if (dateVal) dateCtl.setDate(dateVal);
  const remove = el("button", {
    class: "mc-remove",
    type: "button",
    text: "×",
    attrs: { "aria-label": t("leg_remove"), title: t("leg_remove") },
  });
  const row = el("div", { class: "mc-leg" }, [from, to, dateCtl.root, remove]);
  const ctl: LegCtl = { from, to, dateCtl, row, remove };
  remove.addEventListener("click", () => removeLeg(ctl));
  to.addEventListener("change", () => {
    const id = resolveStation(to.value);
    const next = legRows[legRows.indexOf(ctl) + 1];
    if (next && id && !next.from.value.trim()) next.from.value = deps.registry.label(id);
  });
  return ctl;
}

function renderLegs(): void {
  if (!legsContainer) return;
  clear(legsContainer);
  const removable = legRows.length > 2;
  legRows.forEach((l) => {
    l.remove.style.display = removable ? "" : "none";
    legsContainer!.append(l.row);
  });
}

function addLeg(): void {
  const prev = legRows[legRows.length - 1];
  const id = prev ? resolveStation(prev.to.value) : undefined;
  legRows.push(makeLeg(id ? deps.registry.label(id) : ""));
  renderLegs();
}

function removeLeg(ctl: LegCtl): void {
  if (legRows.length <= 2) return;
  legRows = legRows.filter((l) => l !== ctl);
  renderLegs();
}

function clearTripLegs(): void {
  legRows = [makeLeg(), makeLeg()];
  renderLegs();
}

function buildForm(): FormBuild {
  const stationList = el("datalist", { id: "station-list" });
  for (const s of deps.registry.list()) stationList.append(el("option", { value: s.label }));

  const modeTabs = el("div", { class: "mode-tabs", attrs: { role: "group", "aria-label": t("appName") } });
  (["simple", "return", "multi"] as const).forEach((trip, i) => {
    const btn = el("button", {
      class: "mode-tab",
      type: "button",
      text: t(`tab_${trip}` as const),
      dataset: { trip },
      on: { click: () => switchTab(trip) },
    });
    withShortcut(btn, String(i + 1));
    modeTabs.append(btn);
  });
  const ideasBtn = el("button", {
    class: "mode-tab ideas-tab",
    type: "button",
    text: t("tab_ideas"),
    dataset: { trip: "ideas" },
    on: { click: () => switchTab("ideas") },
  });
  withShortcut(ideasBtn, "4");
  const modeBar = el("div", { class: "mode-bar" }, [modeTabs, ideasBtn]);
  const modeDesc = el("p", { class: "mode-desc" });

  const origin = inputEl("text", "station-list");
  const destination = inputEl("text", "station-list");
  const via = inputEl("text", "station-list");
  // Flag a station field whose text doesn't match any real station, so a typo or a
  // made-up name reads as invalid instead of silently doing nothing. Neutral while
  // typing (cleared on input); validated on commit (blur / datalist pick).
  for (const input of [origin, destination, via]) {
    input.addEventListener("input", () => input.classList.remove("is-invalid"));
    input.addEventListener("change", () => {
      const v = input.value.trim();
      input.classList.toggle("is-invalid", v !== "" && !resolveStation(v));
    });
  }
  // Mobile UX: in exact-trip mode, committing a valid "from" station jumps focus
  // straight to the still-empty "to" box, so you can fill the route in one flow
  // without reaching for the next field. Only on touch, and only when "to" is empty
  // (don't steal focus while editing an already-complete route).
  origin.addEventListener("change", () => {
    if (!isTouch() || query.mode !== "od") return;
    if (resolveStation(origin.value) && !destination.value.trim()) {
      destination.focus();
    }
  });
  const departDate = makeDateField(t("field_date"));
  const date = departDate.input;
  const dateField = departDate.root;
  const lastBookable = addDays(today, BOOKING_WINDOW_DAYS - 1);
  // Optional tour finish-by date (shown only when a tour has a destination).
  const endDate = inputEl("date");
  endDate.min = today;
  endDate.max = lastBookable;
  endDate.setAttribute("aria-label", t("field_end_date"));
  const endDateField = field(t("field_end_date"), endDate);
  const departAfter = inputEl("time");
  const departBefore = inputEl("time");
  const arriveBefore = inputEl("time");
  const maxDuration = inputEl("number");
  // Max trip length in days (exact trip): caps how many calendar days a journey may
  // straddle — overnight stopovers can chain trains across several days.
  const maxSpanDays = inputEl("number");
  maxSpanDays.min = "1";
  maxSpanDays.max = "14";
  maxSpanDays.placeholder = "2";
  maxSpanDays.setAttribute("aria-label", t("field_maxSpanDays"));
  // Search radius (km) around the endpoints: suggest nearby stations with free MAX
  // seats, for a paid hop to/from them when the exact route has none ("exact trip").
  const radius = inputEl("number");
  radius.min = "10";
  radius.step = "10";
  radius.placeholder = "100";
  radius.setAttribute("aria-label", t("field_radius"));
  const radiusField = field(t("field_radius"), radius);
  const trainType = el("select", { class: "input" }, [
    optionEl("", t("field_anyType"), true),
    ...["SUD EST", "ATLANTIQUE", "NORD", "EST"].map((a) => optionEl(a, a, false)),
  ]) as HTMLSelectElement;
  const maxConnections = el("select", { class: "input" }, [
    optionEl("0", t("conn_0"), false),
    optionEl("1", t("conn_1"), true),
    optionEl("2", t("conn_2"), false),
    optionEl("3", t("conn_3"), false),
    optionEl("6", t("conn_max"), false),
  ]) as HTMLSelectElement;
  const overnight = el("input", { type: "checkbox" }) as HTMLInputElement;
  const overnightField = el("label", { class: "field field-check" }, [
    overnight,
    el("span", { class: "field-label", text: t("field_overnight") }),
  ]);
  // Night trains: a checkbox to include them (off by default → trains that leave
  // late or arrive past midnight are dropped). When it's on, a second checkbox
  // narrows to ONLY journeys you can sleep aboard. syncFormFromQuery sets both from
  // the query's excludeNight / onlyNight; the default query carries excludeNight.
  const night = el("input", { type: "checkbox" }) as HTMLInputElement;
  const nightField = el("label", { class: "field field-check" }, [
    night,
    el("span", { class: "field-label", text: t("field_night") }),
  ]);
  const onlyNight = el("input", { type: "checkbox" }) as HTMLInputElement;
  const onlyNightField = el("label", { class: "field field-check field-sub" }, [
    onlyNight,
    el("span", { class: "field-label", text: t("night_only") }),
  ]);
  // The "only night trains" choice only makes sense once night trains are on.
  const syncNightOpts = (): void => {
    onlyNightField.style.display = night.checked ? "" : "none";
    if (!night.checked) onlyNight.checked = false;
  };
  night.addEventListener("change", syncNightOpts);
  // "Round trip" controls — shown only in "Where to?" mode. The toggle flips the
  // destinations list into round trips (out and back, both free MAX); its options
  // (nights away, min hours on site for a day trip, a late ~02:00 return) appear
  // only once it's on. Nights = 0 is a same-day day trip.
  const roundTrip = el("input", { type: "checkbox" }) as HTMLInputElement;
  const roundTripToggle = el("label", { class: "field field-check daytrip-toggle" }, [
    roundTrip,
    el("span", { class: "field-label", text: t("field_roundtrip") }),
  ]);
  const nights = el("select", { class: "input" }, [
    optionEl("0", t("nights_sameday"), true),
    optionEl("1", t("nights_n", { n: 1 }), false),
    optionEl("2", t("nights_n", { n: 2 }), false),
    optionEl("3", t("nights_n", { n: 3 }), false),
    optionEl("flex", t("nights_flex"), false),
  ]) as HTMLSelectElement;
  const nightsField = field(t("field_nights"), nights);
  const stayHours = inputEl("number");
  stayHours.min = "1";
  stayHours.max = "12";
  stayHours.placeholder = "4";
  stayHours.setAttribute("aria-label", t("field_daytrip_hours"));
  const stayHoursField = field(t("field_daytrip_hours"), stayHours);
  const lateReturn = el("input", { type: "checkbox" }) as HTMLInputElement;
  const lateReturnField = el("label", { class: "field field-check" }, [
    lateReturn,
    el("span", { class: "field-label", text: t("field_late_return") }),
  ]);
  const roundTripOpts = el("div", { class: "daytrip-opts" }, [nightsField, stayHoursField, lateReturnField]);
  const roundTripField = el("div", { class: "field daytrip-group" }, [roundTripToggle, roundTripOpts]);
  // Reveal/hide the round-trip options the moment the toggle or nights change. The
  // form-level `change` handler only re-syncs the tour finish-by date, so these
  // mode-specific fields are toggled here directly (staged, without the search
  // running). The "min hours on site" field is meaningful only for a same-day trip.
  const syncRoundTripOpts = (): void => {
    roundTripOpts.style.display = roundTrip.checked ? "" : "none";
    stayHoursField.style.display = nights.value === "0" ? "" : "none";
  };
  roundTrip.addEventListener("change", syncRoundTripOpts);
  nights.addEventListener("change", syncRoundTripOpts);
  const regionList = [
    ...new Set(deps.registry.all().map((s) => s.region).filter((r): r is string => Boolean(r))),
  ].sort();
  const region = el("select", { class: "input" }, [
    optionEl("", t("region_any"), true),
    ...regionList.map((r) => optionEl(r, r, false)),
  ]) as HTMLSelectElement;
  // Tour "cities to visit": a chip/tag input. Typing a city and pressing Enter
  // (or comma) turns it into a removable chip; Backspace on an empty field drops
  // the last one. Much clearer than a comma-separated string when adding several.
  const cities = inputEl("text", "station-list");
  cities.placeholder = t("cities_add");
  const cityChips = el("div", { class: "city-chips" });
  const citiesBox = el("div", { class: "cities-input" }, [cityChips, cities]);
  const commitCities = (raw: string): void => {
    let added = false;
    for (const part of raw.split(",")) {
      const id = resolveStation(part);
      if (id && !tourCities.includes(id)) {
        tourCities.push(id);
        added = true;
      }
    }
    if (added) renderCityChips();
  };
  cities.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      // Enter would otherwise submit the form (running the search); intercept it so
      // the text becomes a chip instead. The staged chip waits for the Search button.
      e.preventDefault();
      commitCities(cities.value);
      cities.value = "";
    } else if (e.key === "Backspace" && cities.value === "" && tourCities.length) {
      tourCities.pop();
      renderCityChips();
    }
  });
  cities.addEventListener("change", () => {
    // Fired when a datalist suggestion is picked.
    if (cities.value.trim()) {
      commitCities(cities.value);
      cities.value = "";
    }
  });

  const originField = clearableField(t("field_origin"), origin);
  const destinationField = clearableField(t("field_destination"), destination);
  const viaField = clearableField(t("field_via"), via);
  const regionField = field(t("field_region"), region);
  const clearCitiesBtn = el("button", {
    class: "linklike cities-clear",
    type: "button",
    text: t("cities_clear"),
    attrs: { hidden: "" },
    on: { click: clearTourCities },
  });
  withShortcut(clearCitiesBtn, "C"); // "c" clears every tour city
  cityClearBtnEl = clearCitiesBtn;
  // "Nearest stop": greedily extend the trip to the closest reachable new station.
  // It lives next to "Surprise me" in the form actions and only shows for a tour.
  const nearestBtn = el("button", {
    class: "btn btn-ghost nearest-btn",
    type: "button",
    text: t("act_nearest"),
    attrs: { title: t("nearest_hint") },
    on: { click: addNearestCity },
  });
  withShortcut(nearestBtn, "N"); // "n" grows the tour to the nearest stop
  nearestBtn.style.display = "none"; // shown only in tour mode by updateFieldVisibility()
  nearestBtnEl = nearestBtn;
  const citiesField = field(
    t("field_cities"),
    el("div", { class: "cities-wrap" }, [
      citiesBox,
      el("div", { class: "cities-actions" }, [clearCitiesBtn]),
    ]),
  );
  // How many days to spend in each city before the next hop — a range, so the
  // planner can find a feasible schedule (a free-MAX, multi-day vacation plan).
  const minDays = inputEl("number");
  minDays.min = "1";
  minDays.max = "14";
  minDays.value = "1";
  minDays.setAttribute("aria-label", t("field_stay_min"));
  const maxDays = inputEl("number");
  maxDays.min = "1";
  maxDays.max = "14";
  maxDays.value = "3";
  maxDays.setAttribute("aria-label", t("field_stay_max"));
  const stayField = el("div", { class: "stay-fields" }, [
    field(t("field_stay_min"), minDays),
    field(t("field_stay_max"), maxDays),
  ]);
  // How many cities Surprise me / Nearest stop add per click — set to 5 and click
  // once to "find me a tour of 5 cities".
  const tourCount = inputEl("number");
  tourCount.min = "1";
  tourCount.max = String(MAX_TOUR_FILL);
  tourCount.placeholder = "1";
  tourCount.setAttribute("aria-label", t("field_tour_count"));
  const tourCountField = field(t("field_tour_count"), tourCount);
  // Optional distance caps (km, straight line): the whole tour's total, and each
  // single hop ("a tour, but no more than ~1000 km total and no train over ~400 km").
  // No minimum — any positive cap is valid (an empty box means "no cap").
  const maxKm = inputEl("number");
  maxKm.step = "50";
  maxKm.placeholder = "1000";
  maxKm.setAttribute("aria-label", t("field_maxKm"));
  const maxLegKm = inputEl("number");
  maxLegKm.step = "50";
  maxLegKm.placeholder = "400";
  maxLegKm.setAttribute("aria-label", t("field_maxLegKm"));
  const maxKmField = el("div", { class: "stay-fields" }, [
    field(t("field_maxKm"), maxKm),
    field(t("field_maxLegKm"), maxLegKm),
  ]);
  // Per-train time cap (tour): no single hop longer than N minutes. Time matters
  // more than distance, so this carries a sensible minimum (a 5-min cap is useless).
  const maxLegDuration = inputEl("number");
  maxLegDuration.min = "30";
  maxLegDuration.step = "15";
  maxLegDuration.placeholder = "240";
  maxLegDuration.setAttribute("aria-label", t("field_maxLegDuration"));
  const maxLegDurationField = field(t("field_maxLegDuration"), maxLegDuration);
  // Floor on each hop's time — e.g. require ~6 h legs so a tour only chains long
  // overnight trains, never a quick 1 h regional hop.
  const minLegDuration = inputEl("number");
  minLegDuration.min = "0";
  minLegDuration.step = "15";
  minLegDuration.placeholder = "0";
  minLegDuration.setAttribute("aria-label", t("field_minLegDuration"));
  const minLegDurationField = field(t("field_minLegDuration"), minLegDuration);

  // These three default to Advanced; updateFieldVisibility() promotes them into the
  // main form for a tour (where connections/overnight/duration matter most). Train
  // type stays last as a stable insertion anchor. Km caps + max-span sit in Advanced
  // and are shown per mode (km for tour, span for od).
  const maxDurationField = field(t("field_maxDuration"), maxDuration);
  const maxSpanDaysField = field(t("field_maxSpanDays"), maxSpanDays);
  const trainTypeField = field(t("field_trainType"), trainType);
  // Overnight is an option of "Connections" (a long layover is just a slow change),
  // so group them into one cell — a lone checkbox floating mid-row looks orphaned.
  const connGroupField = el("div", { class: "conn-group" }, [
    field(t("field_connections"), maxConnections),
    overnightField,
    nightField,
    onlyNightField,
  ]);

  const advanced = el("details", { class: "advanced" }, [
    el("summary", { text: t("field_advanced") }),
    el("div", { class: "advanced-grid" }, [
      connGroupField,
      viaField,
      field(t("field_departAfter"), departAfter),
      field(t("field_departBefore"), departBefore),
      field(t("field_arriveBefore"), arriveBefore),
      maxDurationField,
      minLegDurationField,
      maxLegDurationField,
      maxSpanDaysField,
      radiusField,
      maxKmField,
      trainTypeField,
    ]),
  ]);

  const searchBtn = el("button", { class: "btn btn-primary", type: "submit", text: t("btn_search") });
  withShortcut(searchBtn, "G"); // "g" runs the search (see onGlobalKey)
  // A discreet, playful shortcut to a random city.
  const surpriseBtn = el("button", {
    class: "btn btn-ghost surprise-btn",
    type: "button",
    text: t("act_surprise"),
    on: { click: surpriseMe },
  });
  withShortcut(surpriseBtn, "S"); // "s" = surprise me
  // Inline status for "surprise" (e.g. no city can be added to a tour).
  surpriseMsgEl = el("p", { class: "surprise-msg", attrs: { role: "status" } });

  const addLegBtn = el("button", { class: "linklike mc-add", type: "button", text: t("leg_add"), on: { click: addLeg } });
  const clearLegsBtn = el("button", { class: "linklike mc-clear", type: "button", text: t("cities_clear"), on: { click: clearTripLegs } });
  const legsHead = el("div", { class: "mc-head" }, [
    el("span", { class: "field-label", text: t("field_origin") }),
    el("span", { class: "field-label", text: t("field_destination") }),
    el("span", { class: "field-label", text: t("field_date") }),
    el("span", {}),
  ]);
  const legsBlock = el("div", { class: "mc-block" }, [
    legsHead,
    el("div", { class: "mc-legs" }),
    el("div", { class: "mc-actions" }, [addLegBtn, clearLegsBtn]),
  ]);
  legsContainer = legsBlock.querySelector(".mc-legs");
  legRows = [makeLeg(), makeLeg()];
  renderLegs();

  const howto = el("details", { class: "howto" }, [
    el("summary", { text: t("how_title") }),
    el("ul", { class: "howto-list" }, [
      el("li", { text: t("how_jeune") }),
      el("li", { text: t("how_senior") }),
    ]),
    el("p", { class: "howto-links" }, [
      el("span", { class: "muted", text: `${t("how_more")} ` }),
      el("a", {
        text: "MAX JEUNE",
        href: MAX_JEUNE_URL,
        attrs: { target: "_blank", rel: "noopener noreferrer" },
      }),
      el("span", { class: "muted", text: " · " }),
      el("a", {
        text: "MAX SENIOR",
        href: MAX_SENIOR_URL,
        attrs: { target: "_blank", rel: "noopener noreferrer" },
      }),
    ]),
    el("p", { class: "muted small", text: t("how_note") }),
  ]);

  const form = el("form", { class: "search-form" }, [
    el("div", { class: "form-body" }, [
      modeBar,
      modeDesc,
      el("div", { class: "fields" }, [
        originField,
        destinationField,
        dateField,
        endDateField,
        regionField,
        legsBlock,
        citiesField,
        stayField,
        tourCountField,
      ]),
      advanced,
    ]),
    el("div", { class: "form-stub" }, [
      el("div", { class: "form-actions" }, [searchBtn, surpriseBtn, nearestBtn]),
      surpriseMsgEl,
      howto,
    ]),
    stationList,
  ]);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    runFromForm();
  });
  // Editing a field stages the change but no longer auto-runs the search: on mobile
  // with a large dataset, recomputing on every field commit (blur / datalist pick /
  // select) is slow, so the results now wait for the Search button (or Enter / "g").
  // The `change` handler still keeps dependent fields in sync as you edit — e.g. it
  // reveals the tour "finish by" date once a destination is filled.
  form.addEventListener("change", () => refreshTourEndDate());

  return {
    form,
    refs: {
      modeTabs,
      ideasBtn,
      modeDesc,
      origin,
      destination,
      date,
      dateField,
      departDate,
      legsBlock,
      surpriseBtn,
      endDate,
      endDateField,
      departAfter,
      departBefore,
      arriveBefore,
      maxDuration,
      maxSpanDays,
      maxSpanDaysField,
      radius,
      radiusField,
      trainType,
      maxConnections,
      connGroupField,
      overnight,
      night,
      onlyNight,
      onlyNightField,
      roundTrip,
      nights,
      stayHours,
      stayHoursField,
      lateReturn,
      roundTripField,
      roundTripOpts,
      via,
      originField,
      destinationField,
      viaField,
      maxDurationField,
      trainTypeField,
      region,
      regionField,
      cities,
      citiesField,
      tourCount,
      tourCountField,
      cityChips,
      minDays,
      maxDays,
      stayField,
      maxKm,
      maxLegKm,
      maxKmField,
      maxLegDuration,
      maxLegDurationField,
      minLegDuration,
      minLegDurationField,
    },
  };
}

/**
 * Prefill the search form with a saved route (origin + destination, exact-trip
 * mode) without running it — so clicking a favorite sets up the start rather than
 * jumping straight to a result. The user reviews and presses Search.
 */
function fillRoute(origin: string, destination: string): void {
  // Clear any stale "via" so a saved route isn't filtered through an unrelated hub.
  query = { ...query, mode: "od", origin, destination, via: undefined };
  syncFormFromQuery();
  store.updateUrl(query); // keep the URL in step with the prefilled route
  if (!isTouch()) refs.origin.focus({ preventScroll: true }); // no dropdown pop on phones
  refs.modeTabs.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Render the tour "cities to visit" chips from `tourCities`. */
function renderCityChips(): void {
  clear(refs.cityChips);
  tourCities.forEach((id, i) => {
    const chip = el("span", { class: "city-chip" }, [
      el("span", { text: deps.registry.label(id) }),
      el("button", {
        class: "chip-x",
        type: "button",
        text: "×",
        attrs: { "aria-label": `${t("act_fav_remove")} — ${deps.registry.label(id)}` },
        on: {
          click: () => {
            // Staged like every other edit — removing a chip waits for the Search button.
            tourCities.splice(i, 1);
            renderCityChips();
          },
        },
      }),
    ]);
    refs.cityChips.append(chip);
  });
  cityClearBtnEl?.toggleAttribute("hidden", tourCities.length === 0);
}

function renderFavorites(): void {
  clear(refs.favList);
  const favs = store.loadFavorites();
  // Hide the whole card while empty so it doesn't take prime space in the rail
  // (and so the map sits directly under the results on mobile).
  refs.favList.parentElement?.toggleAttribute("hidden", favs.length === 0);
  if (favs.length === 0) return;
  for (const f of favs) {
    const row = el("div", { class: "fav-row" }, [
      el("button", {
        class: "fav-open",
        type: "button",
        text: `${deps.registry.label(f.origin)} → ${deps.registry.label(f.destination)}`,
        on: { click: () => fillRoute(f.origin, f.destination) },
      }),
      el("button", {
        class: "iconbtn",
        type: "button",
        text: "✕",
        title: t("act_fav_remove"),
        on: {
          click: () => {
            store.toggleFavorite(f);
            renderFavorites();
          },
        },
      }),
    ]);
    refs.favList.append(row);
  }
}

// The rail (sidebar) only shows the few most recent saved trips; the rest live
// on the dedicated "Saved trips" page reached via the "See all" link.
const SAVED_RAIL_LIMIT = 3;

/**
 * Route label, date label, and an "open" action for a saved trip, shared by the
 * rail and the dedicated saved-trips page. A tour chains every stop; a round
 * trip uses ⇄ and a date range; a one-way is a single arrow + date.
 */
function savedTripInfo(trip: store.SavedTrip): { label: string; when: string; open: () => void } {
  const out = trip.outbound;
  const inb = trip.inbound;
  const tour = trip.tour;
  if (tour) {
    const stops = [tour.legs[0]?.origin ?? out.origin, ...tour.legs.map((l) => l.destination)];
    const last = tour.legs[tour.legs.length - 1];
    return {
      label: stops.map((s) => deps.registry.label(s)).join(" → "),
      when: last ? `${formatDate(out.date)} – ${formatDate(last.date)}` : formatDate(out.date),
      open: () => showTourModal(tour, ctx()),
    };
  }
  return {
    label: `${deps.registry.label(out.origin)} ${inb ? "⇄" : "→"} ${deps.registry.label(out.destination)}`,
    when: inb ? `${formatDate(out.date)} – ${formatDate(inb.date)}` : formatDate(out.date),
    open: () => showTripModal(out, ctx(), { inbound: inb, onShare: shareCurrentUrl }),
  };
}

/**
 * Render the "Saved trips" rail card from localStorage (newest first), capped at
 * the last few. When more exist (or any do), a "See all (N)" link opens the
 * dedicated saved-trips page.
 */
function renderSavedTrips(): void {
  clear(refs.tripList);
  const trips = store.loadTrips();
  // Hide the whole card while empty so it doesn't take prime space in the rail.
  refs.tripList.parentElement?.toggleAttribute("hidden", trips.length === 0);
  if (trips.length === 0) return;
  for (const trip of trips.slice(0, SAVED_RAIL_LIMIT)) {
    const info = savedTripInfo(trip);
    const row = el("div", { class: "fav-row trip-row" }, [
      el(
        "button",
        {
          class: "fav-open trip-open",
          type: "button",
          on: { click: info.open },
        },
        [
          el("span", { class: "trip-open-route", text: info.label }),
          el("span", { class: "muted small", text: info.when }),
        ],
      ),
      el("button", {
        class: "iconbtn",
        type: "button",
        text: "✕",
        title: t("act_unsave"),
        on: {
          click: () => {
            store.removeTrip(trip.id);
            renderSavedTrips();
          },
        },
      }),
    ]);
    refs.tripList.append(row);
  }
  // Always offer the dedicated page (it holds the full history + remove controls).
  refs.tripList.append(
    el("button", {
      class: "saved-see-all",
      type: "button",
      text: t("saved_see_all", { n: trips.length }),
      on: { click: openSavedPage },
    }),
  );
}

/** Open the dedicated saved-trips page (full list), remembering where we were. */
function openSavedPage(): void {
  navStack.push({ ...query }); // so the page's Back returns to the current list
  if (pendingRaf) cancelAnimationFrame(pendingRaf);
  pendingRaf = 0;
  clear(refs.results);
  renderSavedPage();
  refs.title.focus({ preventScroll: true });
  refs.title.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Full saved-trips list: back button, count, then a card per trip with remove. */
function renderSavedPage(): void {
  clear(refs.results);
  refs.title.textContent = t("saved_title");
  refs.results.append(
    el("button", { class: "back-btn", type: "button", text: `← ${t("act_back")}`, on: { click: goBack } }),
  );
  const trips = store.loadTrips();
  if (trips.length === 0) {
    refs.results.append(render.emptyEl(t("saved_none")));
    return;
  }
  refs.results.append(el("p", { class: "muted count", text: t("saved_count", { n: trips.length }) }));
  for (const trip of trips) {
    const info = savedTripInfo(trip);
    const card = el("div", { class: "saved-page-card" }, [
      el(
        "button",
        { class: "fav-open trip-open", type: "button", on: { click: info.open } },
        [
          el("span", { class: "trip-open-route", text: info.label }),
          el("span", { class: "muted small", text: info.when }),
        ],
      ),
      el("button", {
        class: "iconbtn",
        type: "button",
        text: "✕",
        title: t("act_unsave"),
        on: {
          click: () => {
            store.removeTrip(trip.id);
            renderSavedTrips();
            renderSavedPage(); // refresh the page in place (may now be empty)
          },
        },
      }),
    ]);
    refs.results.append(card);
  }
}

// --- small DOM helpers ------------------------------------------------------

function inputEl(type: string, list?: string): HTMLInputElement {
  // Accessible name comes from the wrapping <label> built by field().
  const i = el("input", { class: "input", type }) as HTMLInputElement;
  if (list) i.setAttribute("list", list);
  return i;
}

function field(label: string, control: HTMLElement): HTMLElement {
  return el("label", { class: "field" }, [el("span", { class: "field-label", text: label }), control]);
}

const FLEX_MAX = 7;

/**
 * A field whose text input carries a clear "×" button (shown only when there's
 * something to clear). Clearing fires input+change so the field's invalid flag and
 * any dependent fields re-sync — the search itself waits for the Search button.
 */
function clearableField(label: string, input: HTMLInputElement): HTMLElement {
  input.classList.add("has-clear");
  const clearBtn = el("button", {
    class: "input-clear",
    type: "button",
    // An SVG cross centres reliably (the "×" glyph sits optically high in its box).
    html: '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    attrs: { "aria-label": t("act_clear"), tabindex: "-1", title: t("act_clear") },
  });
  const sync = (): void => {
    clearBtn.style.display = input.value ? "" : "none";
  };
  input.addEventListener("input", sync);
  clearBtn.addEventListener("click", (e) => {
    e.preventDefault();
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.focus();
    sync();
  });
  sync();
  return field(label, el("span", { class: "input-wrap" }, [input, clearBtn]));
}

/**
 * Append a keyboard-shortcut badge to a button. The badge stays out of the way
 * until the pointer hovers (or the button is keyboard-focused), when CSS reveals
 * it — so the same key shown in the "?" help is discoverable right on the button.
 */
function withShortcut(btn: HTMLElement, key: string): HTMLElement {
  btn.classList.add("has-kbd");
  btn.append(el("kbd", { class: "kbd-hint", text: key, attrs: { "aria-hidden": "true" } }));
  return btn;
}
