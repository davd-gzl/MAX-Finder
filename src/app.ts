import type { Dataset } from "./data/dataset";
import { StationRegistry } from "./data/stations";
import type { SearchQuery, MaxTrain, Journey } from "./types";
import {
  reachableDestinations,
  reachableOrigins,
  reachableGroups,
  windowStats,
} from "./core/destinations";
import { filterTrains } from "./core/search";
import { bestTrips, bestTripsAcrossWindow, stationsOnDate, reachableBest } from "./core/best";
import { getaways } from "./core/getaways";
import { planTours, planTourInOrder, planTourGreedy, type Tour } from "./core/tour";
import { findJourneys, bestJourney, journeySpanDays, MAX_RESULTS } from "./core/connections";
import type { ConnectionOptions } from "./core/connections";
import { availabilityCalendar, destinationCalendar, dateRange } from "./core/calendar";
import { addDays, dayIndex } from "./util/time";
import { haversineKm } from "./util/geo";
import { el, clear } from "./ui/dom";
import { RouteMap } from "./ui/map";
import * as render from "./ui/render";
import type { RenderCtx } from "./ui/render";
import { journeyToIcs, downloadText } from "./ui/ics";
import { generateBookingUrl } from "./util/booking";
import { t, setLang, getLang, LANGS, isLang } from "./i18n";
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
  modeDesc: HTMLElement;
  origin: HTMLInputElement;
  destination: HTMLInputElement;
  date: HTMLInputElement;
  endDate: HTMLInputElement;
  endDateField: HTMLElement;
  card: HTMLSelectElement;
  departAfter: HTMLInputElement;
  departBefore: HTMLInputElement;
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
  roundTrip: HTMLInputElement;
  nights: HTMLSelectElement;
  stayHours: HTMLInputElement;
  stayHoursField: HTMLElement;
  lateReturn: HTMLInputElement;
  roundTripField: HTMLElement;
  roundTripOpts: HTMLElement;
  via: HTMLInputElement;
  flex: HTMLSelectElement;
  flexField: HTMLElement;
  originField: HTMLElement;
  destinationField: HTMLElement;
  viaField: HTMLElement;
  maxDurationField: HTMLElement;
  trainTypeField: HTMLElement;
  region: HTMLSelectElement;
  regionField: HTMLElement;
  cities: HTMLInputElement;
  citiesField: HTMLElement;
  cityChips: HTMLElement;
  minDays: HTMLInputElement;
  maxDays: HTMLInputElement;
  stayField: HTMLElement;
  maxKm: HTMLInputElement;
  maxLegKm: HTMLInputElement;
  maxKmField: HTMLElement;
  maxLegDuration: HTMLInputElement;
  maxLegDurationField: HTMLElement;
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
let map: RouteMap | null = null;
let labelToId: Map<string, string>;
// Today (YYYY-MM-DD). MAX seats are only bookable ~30 days out, so the calendar
// and the date picker stay anchored to a today..today+30 window.
let today = "";
const BOOKING_WINDOW_DAYS = 30;
// Cap on connection-only ("via") destinations appended to a browse list.
const MAX_VIA_RESULTS = 30;
// Query history for the in-app Back button (drilling into a route pushes here).
let navStack: SearchQuery[] = [];
// "Ideas" (best) mode: when no specific day is picked, show every destination
// reachable across the whole window. A calendar-day click narrows to that day.
let bestAllDays = true;

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

/** Remove every tour "city to visit" at once. */
function clearTourCities(): void {
  if (tourCities.length === 0) return;
  tourCities = [];
  query = { ...query, cities: [] };
  navStack = [];
  syncFormFromQuery();
  applyAndRun();
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

/**
 * Tour "nearest stop": extend the trip to the geographically closest station you
 * can still reach by free MAX from the current frontier (the last stop, or the
 * departure when the list is empty) and that keeps the whole tour feasible.
 * Already-visited stations are excluded, so the route never loops back.
 */
function addNearestCity(): void {
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

  const frontier = tourCities[tourCities.length - 1] ?? origin;
  const used = new Set([origin, ...tourCities]);
  // Candidates: stations with a direct free-MAX train from the frontier, not yet
  // visited, in-region, and locatable.
  const candidates = [...new Set(avail.filter((tr) => tr.origin === frontier).map((tr) => tr.destination))]
    .filter((d) => !used.has(d) && inRegion(d) && deps.registry.coords(d));
  // Order by straight-line distance from the frontier (nearest first). If the
  // frontier itself is unplotted every distance is Infinity (NaN comparator), so
  // fall back to a stable label order instead of an arbitrary one.
  if (deps.registry.coords(frontier)) {
    candidates.sort((a, b) => stationDistanceKm(frontier, a) - stationDistanceKm(frontier, b));
  } else {
    candidates.sort((a, b) => deps.registry.label(a).localeCompare(deps.registry.label(b)));
  }

  const lo = query.minDays ?? 1;
  const hi = Math.max(lo, query.maxDays ?? 3);
  const planOpts = tourPlanOpts();
  let chosen: string | undefined;
  for (let i = 0; i < candidates.length && i < 40; i++) {
    const c = candidates[i]!;
    if (planTourInOrder(deps.trains, origin, [...tourCities, c], query.date, planOpts, lo, hi, stationDistanceKm, query.maxKm, query.maxLegKm, query.destination || undefined, query.destination ? query.tourEndDate : undefined)) {
      chosen = c;
      break;
    }
  }
  if (!chosen) {
    // Nothing reachable nearby keeps the tour feasible: reflect a freshly-filled
    // departure if any, but add no city.
    if (origin !== query.origin) {
      query = { ...query, origin };
      navStack = [];
      syncFormFromQuery();
      applyAndRun();
    }
    setSurpriseMsg(t("surprise_none"));
    return;
  }
  tourCities.push(chosen);
  query = { ...query, origin, cities: [...tourCities] };
  navStack = [];
  syncFormFromQuery();
  applyAndRun();
}

/** A simple accessible modal dialog: a title and one or more message lines. */
function showInfoModal(title: string, lines: string[]): void {
  const dialog = el("dialog", { class: "modal" }) as HTMLDialogElement;
  const closeBtn = el("button", {
    class: "btn btn-primary modal-close",
    type: "button",
    text: t("act_close"),
    on: { click: () => dialog.close() },
  });
  dialog.append(
    el("div", { class: "modal-body" }, [
      el("h2", { class: "modal-title", text: title }),
      ...lines.map((line) => el("p", { class: "modal-text", text: line })),
      el("div", { class: "modal-actions" }, [closeBtn]),
    ]),
  );
  // Remove from the DOM once dismissed; click on the backdrop closes it.
  dialog.addEventListener("close", () => dialog.remove());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  dialog.showModal();
}

/**
 * Step-by-step booking modal for a connecting journey: one SNCF Connect deep link
 * per train, in order. A single via search can't be pinned to the exact free trains
 * (SNCF re-optimises the route), so each leg is booked on its own — this lays out
 * exactly which buttons to click, in sequence.
 */
function showBookingModal(j: Journey): void {
  const label = (id: string): string => deps.registry.label(id);
  const dialog = el("dialog", { class: "modal" }) as HTMLDialogElement;
  const closeBtn = el("button", {
    class: "btn btn-ghost modal-close",
    type: "button",
    text: t("act_close"),
    on: { click: () => dialog.close() },
  });
  const steps = el("ol", { class: "book-steps" });
  j.legs.forEach((leg, i) => {
    const href = generateBookingUrl(label(leg.origin), label(leg.destination), leg.date, leg.depart);
    steps.append(
      el("li", { class: "book-step" }, [
        el("div", { class: "book-step-info" }, [
          el("div", { class: "book-step-route" }, [
            el("strong", { text: label(leg.origin) }),
            el("span", { class: "muted", text: " → " }),
            el("strong", { text: label(leg.destination) }),
          ]),
          el("div", {
            class: "book-step-meta muted small",
            text: `${leg.depart} → ${leg.arrive} · ${t("lbl_train", { no: leg.trainNo })}`,
          }),
        ]),
        el("a", {
          class: "btn btn-primary book-step-btn",
          href,
          attrs: { target: "_blank", rel: "noopener noreferrer" },
          text: t("act_book_leg", { n: i + 1 }),
        }),
      ]),
    );
  });
  dialog.append(
    el("div", { class: "modal-body" }, [
      el("h2", { class: "modal-title", text: t("book_steps_title") }),
      el("p", { class: "modal-text", text: t("book_steps_note") }),
      steps,
      el("div", { class: "modal-actions" }, [closeBtn]),
    ]),
  );
  dialog.addEventListener("close", () => dialog.remove());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  dialog.showModal();
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
  applyTheme(settings.theme);
  setLang(settings.lang);
  // Every station present in the dataset becomes searchable (the curated registry
  // only covers map coordinates for the major ones).
  registry.addMissing(dataset.trains.flatMap((t) => [t.origin, t.destination]));
  labelToId = new Map(registry.list().map((s) => [s.label.toLowerCase(), s.id]));

  today = new Date().toISOString().slice(0, 10);
  query = store.urlHasQuery()
    ? store.queryFromParams(new URLSearchParams(location.search), today)
    : { mode: "from", date: today, card: settings.card, maxConnections: 1, excludeNight: true };

  rebuild();
  checkWatchedRoutes();

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e as InstallPromptEvent;
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
  });

  // Global keyboard shortcuts (mode switch, focus, day nav, surprise, run, help).
  document.addEventListener("keydown", onGlobalKey);

  // Native browser Back/Forward: restore the page from the URL. The in-app drill
  // stack is the URL's source of truth here, so clear it to keep the in-app
  // "Retour" button in step with where the browser history now sits.
  window.addEventListener("popstate", () => {
    query = store.queryFromParams(new URLSearchParams(location.search), today);
    navStack = [];
    syncFormFromQuery();
    runSearch();
  });
}

function rebuild(): void {
  buildLayout(rootRef);
  syncFormFromQuery();
  runSearch();
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
      // One clean scroll to the new page's heading (focus uses preventScroll so
      // this is the only scroll, not a jump-then-smooth).
      refs.title.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    onFocusStation: (id) => map?.focus(id),
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
    onBookSteps: (j) => showBookingModal(j),
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
    onShowTrip: (out, inb) => showTripModal(out, inb),
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

/**
 * The whole trip on one page (a modal): a single journey or a round trip, with both
 * legs bookable, a Save toggle, and a shortcut to the route's full calendar.
 */
function showTripModal(outbound: Journey, inbound?: Journey): void {
  const dialog = el("dialog", { class: "modal trip-modal" }) as HTMLDialogElement;
  const closeBtn = el("button", {
    class: "btn btn-primary modal-close",
    type: "button",
    text: t("act_close"),
    on: { click: () => dialog.close() },
  });
  const moreDates = el("button", {
    class: "linklike trip-more",
    type: "button",
    text: t("trip_more_dates"),
    on: {
      click: () => {
        dialog.close();
        ctx().onOpenRoute(outbound.origin, outbound.destination);
      },
    },
  });
  dialog.append(
    el("div", { class: "modal-body" }, [
      render.tripViewEl(outbound, ctx(), inbound),
      el("div", { class: "modal-actions" }, [moreDates, closeBtn]),
    ]),
  );
  dialog.addEventListener("close", () => dialog.remove());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  dialog.showModal();
}

/**
 * A saved multi-city tour on one page (a modal): the full itinerary with every
 * bookable leg and a Save toggle. Map actions are no-ops here — there's no map
 * behind the dialog to draw on (and we don't want to scroll the page underneath).
 */
function showTourModal(tour: Tour): void {
  const modalCtx: RenderCtx = { ...ctx(), onShowTour: () => {}, onShowJourney: () => {} };
  const dialog = el("dialog", { class: "modal trip-modal" }) as HTMLDialogElement;
  const closeBtn = el("button", {
    class: "btn btn-primary modal-close",
    type: "button",
    text: t("act_close"),
    on: { click: () => dialog.close() },
  });
  dialog.append(
    el("div", { class: "modal-body" }, [
      render.tourEl(tour, modalCtx),
      el("div", { class: "modal-actions" }, [closeBtn]),
    ]),
  );
  dialog.addEventListener("close", () => dialog.remove());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  dialog.showModal();
}

// --- query <-> form ---------------------------------------------------------

function syncFormFromQuery(): void {
  setSurpriseMsg(""); // a navigation clears any stale "surprise" notice
  setActiveTab(query.mode);
  refs.modeDesc.textContent = t(`desc_${query.mode}` as const);
  refs.origin.value = query.origin ? deps.registry.label(query.origin) : "";
  refs.destination.value = query.destination ? deps.registry.label(query.destination) : "";
  refs.via.value = query.via ? deps.registry.label(query.via) : "";
  // Values set here are always resolved, so clear any stale invalid flag.
  for (const f of [refs.origin, refs.destination, refs.via]) f.classList.remove("is-invalid");
  refs.flex.value = String(query.flexDays ?? 0);
  refs.date.value = query.date;
  refs.endDate.value = query.tourEndDate ?? "";
  refs.card.value = query.card;
  refs.departAfter.value = query.departAfter ?? "";
  refs.departBefore.value = query.departBefore ?? "";
  refs.maxDuration.value = query.maxDurationMin != null ? String(query.maxDurationMin) : "";
  refs.maxSpanDays.value = query.maxSpanDays != null ? String(query.maxSpanDays) : "";
  refs.radius.value = query.radiusKm != null ? String(query.radiusKm) : "";
  refs.trainType.value = query.trainType ?? "";
  refs.maxConnections.value = String(query.maxConnections);
  refs.overnight.checked = Boolean(query.overnight);
  refs.night.checked = !query.excludeNight; // checked = night trains included
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
  updateFieldVisibility();
}

function readQueryFromForm(): SearchQuery {
  const maxDur = Number(refs.maxDuration.value.trim());
  const maxKm = Number(refs.maxKm.value.trim());
  const maxLegKm = Number(refs.maxLegKm.value.trim());
  const maxLegDur = Number(refs.maxLegDuration.value.trim());
  const span = Number(refs.maxSpanDays.value.trim());
  const rad = Number(refs.radius.value.trim());
  const stayHours = Number(refs.stayHours.value.trim());
  // Round trip is a "Where to?" feature only — gate it to `from` so it never leaks.
  const roundTrip = query.mode === "from" && refs.roundTrip.checked;
  const flexNights = refs.nights.value === "flex";
  const nightsVal = flexNights ? 3 : Number(refs.nights.value) || 0;
  return {
    mode: query.mode,
    origin: resolveStation(refs.origin.value),
    destination: resolveStation(refs.destination.value),
    via: resolveStation(refs.via.value),
    flexDays: Number(refs.flex.value) || undefined,
    date: refs.date.value || query.date,
    card: refs.card.value === "senior" ? "senior" : "jeune",
    departAfter: refs.departAfter.value || undefined,
    departBefore: refs.departBefore.value || undefined,
    maxDurationMin: Number.isFinite(maxDur) && maxDur > 0 ? maxDur : undefined,
    trainType: refs.trainType.value || undefined,
    maxConnections: Number(refs.maxConnections.value),
    overnight: refs.overnight.checked || undefined,
    excludeNight: !refs.night.checked || undefined, // unchecked = drop night trains
    region: refs.region.value || undefined,
    // Chips hold the committed cities; also fold in any text still in the input
    // (typed but not yet turned into a chip) so a pending entry isn't lost.
    cities:
      query.mode === "tour"
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
    // Per-train time cap (tour mode). Floor at 30 min so a too-tight value can't
    // silently rule out every train.
    maxLegDurationMin:
      query.mode === "tour" && Number.isFinite(maxLegDur) && maxLegDur > 0
        ? Math.max(30, Math.floor(maxLegDur))
        : undefined,
    // Max trip span (days) is an exact-trip cap only — gated to od so it never leaks.
    maxSpanDays:
      query.mode === "od" && Number.isFinite(span) && span >= 1 ? Math.min(14, Math.floor(span)) : undefined,
    // Search radius (km) is an exact-trip feature only.
    radiusKm:
      query.mode === "od" && Number.isFinite(rad) && rad >= 10 ? Math.min(300, Math.floor(rad)) : undefined,
    // Round-trip view (day trips + N-night getaways) — a "Where to?" feature only.
    roundTrip: roundTrip || undefined,
    nights: roundTrip && nightsVal > 0 ? Math.min(3, nightsVal) : undefined,
    flexNights: (roundTrip && flexNights) || undefined,
    stayMinHours:
      roundTrip && nightsVal === 0 && Number.isFinite(stayHours) && stayHours >= 1
        ? Math.min(12, Math.floor(stayHours))
        : undefined,
    lateReturn: (roundTrip && refs.lateReturn.checked) || undefined,
    // Tour finish-by date — only meaningful with a tour destination set.
    tourEndDate:
      query.mode === "tour" && resolveStation(refs.destination.value) ? refs.endDate.value || undefined : undefined,
  };
}

/** Parse a day-count input into 1..14, falling back to `fallback`. */
function clampDays(raw: string, fallback: number): number {
  const n = Math.floor(Number(raw.trim()));
  return Number.isFinite(n) && n >= 1 ? Math.min(14, n) : fallback;
}

function applyAndRun(): void {
  // Push a browser history entry so the native Back button returns to the prior
  // page. (Incidental updates — calendar day, live form edits — use replaceState.)
  store.pushUrl(query);
  settings = { ...settings, card: query.card };
  store.saveSettings(settings);
  runSearch();
  // Move focus to the results heading so screen-reader users hear the new context,
  // but don't let focus yank the scroll — callers control scrolling explicitly.
  refs.title.focus({ preventScroll: true });
}

/**
 * Live form update: re-read the form and re-run, without stealing focus from the
 * field being edited or jumping the scroll (unlike applyAndRun, which focuses the
 * results heading). Triggered when any field is committed/cleared.
 */
function liveUpdate(): void {
  navStack = [];
  query = readQueryFromForm();
  store.updateUrl(query);
  settings = { ...settings, card: query.card };
  store.saveSettings(settings);
  refreshTourEndDate(); // a freshly typed tour destination reveals the finish-by date
  runSearch();
}

/**
 * Re-render the current query in place: synchronous (no spinner flash), keeping
 * the scroll position. Used for cheap updates like changing the calendar day,
 * where a full teardown + spinner + scroll-to-top is jarring.
 */
function refreshInPlace(): void {
  store.updateUrl(query);
  const scrollY = window.scrollY;
  syncFormFromQuery();
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
    ...(query.excludeNight ? { excludeNight: true } : {}),
  };
}

function filterOpts() {
  return {
    departAfter: query.departAfter,
    departBefore: query.departBefore,
    maxDurationMin: query.maxDurationMin,
    trainType: query.trainType,
    ...(query.excludeNight ? { excludeNight: true } : {}),
    // Overnight stopovers: widen the layover ceiling so a journey can wait
    // overnight at a hub instead of being limited to a ~4h connection.
    ...(query.overnight ? { maxConnectionMin: OVERNIGHT_MAX_CONNECTION_MIN } : {}),
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

function renderSearch(): void {
  const c = ctx();

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
  // "via" list stays compact like the direct list (reachableBest is duration-sorted).
  const connecting =
    query.maxConnections > 0
      ? reachableBest(trains, anchor, query.date, stationsOnDate(trains, query.date), {
          ...filterOpts(),
          maxConnections: query.maxConnections,
        }, dir)
          .filter((tr) => tr.journey.legs.length > 1 && !directStations.has(tr.station))
          .slice(0, MAX_VIA_RESULTS)
      : [];

  const total = groups.length + connecting.length;
  if (total === 0) {
    refs.results.append(render.emptyEl(t("res_none")), render.hintEl(t("res_none_hint")));
    showMap(anchor, []);
    return;
  }
  refs.results.append(el("p", { class: "muted count", text: t(countKey, { n: total }) }));
  for (const g of groups)
    refs.results.append(
      render.groupCardEl(g, dir, anchor, c, dayCount.get(g.station) ?? 0, stats.get(g.station), flex),
    );
  for (const tr of connecting) refs.results.append(render.reachTripRowEl(tr.station, tr.journey, c));
  showMap(anchor, [...groups.map((g) => g.station), ...connecting.map((tr) => tr.station)]);
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
  const trips = getaways(trains, origin, query.date, {
    maxConnections: query.maxConnections,
    ...filterOpts(),
    ...(query.nights ? { nights: query.nights } : {}),
    ...(query.flexNights ? { flexibleNights: true } : {}),
    ...(query.stayMinHours ? { minOnSiteMin: query.stayMinHours * 60 } : {}),
    ...(query.lateReturn ? { lateReturn: true } : {}),
  });
  if (trips.length === 0) {
    refs.results.append(render.emptyEl(t("getaway_none")), render.hintEl(t("getaway_none_hint")));
    showMap(origin, []);
    return;
  }
  refs.results.append(el("p", { class: "muted count", text: t("getaway_count", { n: trips.length }) }));
  for (const trip of trips) refs.results.append(render.getawayRowEl(trip, c));
  showMap(
    origin,
    trips.map((trip) => trip.destination),
  );
}

function runTourSearch(c: RenderCtx): void {
  const { trains, registry } = deps;
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
  // Flexible departure: let the first hop slip up to flexDays later than the chosen
  // date, so a tour is found even when nothing leaves on that exact day.
  const startFlex = query.flexDays ?? 0;
  // Up to 5 cities: try every order and pick the fastest. Beyond that, permuting
  // is factorial, so order them greedily (nearest reachable city each hop). If the
  // greedy route dead-ends, fall back to the typed order — a Surprise / "nearest
  // stop" run already builds a feasible chain in that order.
  let tours: Tour[];
  if (cities.length <= 5) {
    tours = planTours(trains, query.origin, cities, query.date, planOpts, 10, lo, hi, stationDistanceKm, maxKm, legKm, end, endDate, startFlex);
  } else {
    const single =
      planTourGreedy(trains, query.origin, cities, query.date, planOpts, lo, hi, stationDistanceKm, maxKm, legKm, end, endDate, startFlex) ??
      planTourInOrder(trains, query.origin, cities, query.date, planOpts, lo, hi, stationDistanceKm, maxKm, legKm, end, endDate, startFlex);
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
  const cal = destinationCalendar(trains, query.origin, window, filterOpts(), inRegion);
  refs.results.append(
    // In all-days mode no single day is "selected" — leave the strip unhighlighted.
    render.calendarEl(cal, c, allDays ? undefined : query.date, {
      title: t("best_cal_title"),
      count: (n) => t("best_cal_count", { n }),
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

  refs.results.append(
    el("p", { class: "muted count", text: t("res_destinations", { n: trips.length }) }),
  );
  // Month-long train count per destination (same figure as the "Where to?" list),
  // so an idea shows how well-served it is before you drill in.
  const stats = windowStats(trains, query.origin, "from", filterOpts());
  for (const tr of trips)
    refs.results.append(render.bestTripRowEl(tr, c, stats.get(tr.destination)?.trains));
  showMap(query.origin, trips.map((tr) => tr.destination));
}

function runOdSearch(c: RenderCtx): void {
  const { trains, registry } = deps;
  if (!query.origin || !query.destination) {
    return showHint(query.origin ? refs.destination : refs.origin);
  }
  odReturnDate = null; // a fresh outbound search re-proposes the return (outbound + 2)
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
    for (const j of journeys)
      refs.results.append(
        render.journeyEl(j, c, {
          selected: j === chosenOutbound,
          onPick: (jj) => {
            chosenOutbound = jj;
            c.onShowJourney(jj);
          },
        }),
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
  if (journeys.length > 0) {
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
        retList.append(render.journeyEl(j, c, { onPick: (rj) => showTripModal(chosenOutbound!, rj) }));
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
function isTouch(): boolean {
  return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
}

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
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/** Switch search mode (tab click or 1–5 shortcut), starting a fresh history. */
function switchMode(mode: SearchQuery["mode"]): void {
  navStack = [];
  if (mode === "best") bestAllDays = true; // a fresh "ideas" view shows every day
  query = { ...readQueryFromForm(), mode };
  syncFormFromQuery();
  applyAndRun();
}

/** Run a fresh search from the current form (submit or "g" shortcut). */
function runFromForm(): void {
  navStack = [];
  query = readQueryFromForm();
  applyAndRun();
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
    t("keys_run"),
    t("keys_back"),
    t("keys_help"),
  ]);
}

const SHORTCUT_MODES = ["from", "to", "od", "tour", "best"] as const;

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

  if (/^[1-5]$/.test(e.key)) {
    e.preventDefault();
    switchMode(SHORTCUT_MODES[Number(e.key) - 1]!);
  } else if (e.key === "/") {
    e.preventDefault();
    const f = query.mode === "to" ? refs.destination : refs.origin;
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
  } else if (e.key === "n" && query.mode === "tour") {
    e.preventDefault();
    addNearestCity(); // tour-only: grow the trip to the nearest reachable stop
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
    // Tour: fill the departure if empty, then add ONE more random city that keeps
    // the WHOLE tour feasible on the chosen date (validated with the planner). No
    // city cap — keep clicking to see how far a free-MAX trip can sprawl. If
    // nothing can be added, say so and add nothing — never a dead-end city.
    // Fill a missing departure — from the chosen region when one is set.
    const origin = query.origin || pickFrom(regionOrigins());
    if (!origin) {
      setSurpriseMsg(t("surprise_none"));
      return;
    }
    const used = new Set([origin, ...tourCities]);
    // The next hop leaves from the frontier (last city, or the departure when the
    // list is empty), so draw candidates from there — not from every visited
    // station, which would waste tries on cities the final hop can't reach.
    const frontier = tourCities[tourCities.length - 1] ?? origin;
    const pool = [...new Set(avail.filter((t) => t.origin === frontier).map((t) => t.destination))]
      .filter((d) => !used.has(d))
      // "Focus on a region" (e.g. visit Bretagne): only add cities from it.
      .filter((d) => !query.region || deps.registry.get(d)?.region === query.region)
      .sort(() => Math.random() - 0.5);
    const lo = query.minDays ?? 1;
    const hi = Math.max(lo, query.maxDays ?? 3);
    const planOpts = tourPlanOpts();
    // No cap: the planner is memoised (journey cache persists across calls), so
    // scanning the whole frontier pool is cheap and avoids falsely reporting
    // "no city" when the few feasible ones land late in the shuffled order.
    let chosen: string | undefined;
    for (const c of pool) {
      if (planTourInOrder(deps.trains, origin, [...tourCities, c], query.date, planOpts, lo, hi, stationDistanceKm, query.maxKm, query.maxLegKm, query.destination || undefined, query.destination ? query.tourEndDate : undefined)) {
        chosen = c;
        break;
      }
    }
    if (!chosen) {
      // No possible city. Reflect a freshly-filled departure, but add nothing.
      if (origin !== query.origin) {
        query = { ...query, origin };
        navStack = [];
        syncFormFromQuery();
        applyAndRun();
      }
      setSurpriseMsg(t("surprise_none"));
      return;
    }
    tourCities.push(chosen);
    query = { ...query, origin, cities: [...tourCities] };
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
}

function ensureMap(): RouteMap {
  if (!map) {
    map = new RouteMap(refs.mapEl, deps.registry);
    map.onSelect = selectStation;
  }
  return map;
}

function showMap(hub: string, others: string[]): void {
  const m = ensureMap();
  m.show(hub, [...new Set(others)]);
  requestAnimationFrame(() => m.invalidate());
}

function showRoute(stations: string[]): void {
  const m = ensureMap();
  m.route(stations);
  requestAnimationFrame(() => m.invalidate());
}

/** Overlay radius circles + nearby-station markers on the current route map. */
function showRadius(centers: { id: string; km: number }[], nearby: string[]): void {
  const m = ensureMap();
  m.radius(centers, nearby);
  requestAnimationFrame(() => m.invalidate());
}

/** Reveal & expand the destination card matching a clicked map marker. */
function selectStation(id: string): void {
  const sel = `[data-station="${id.replace(/["\\]/g, "\\$&")}"]`;
  const card = refs.results.querySelector<HTMLElement>(sel);
  if (!card) return;
  const panel = card.querySelector<HTMLElement>(".dest-panel");
  if (panel?.hasAttribute("hidden")) {
    panel.removeAttribute("hidden");
    card.querySelector(".dest-main")?.setAttribute("aria-expanded", "true");
  }
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.classList.add("flash");
  window.setTimeout(() => card.classList.remove("flash"), 1100);
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

function applyTheme(theme: store.Theme): void {
  document.documentElement.dataset.theme = theme;
}

// --- layout -----------------------------------------------------------------

function setActiveTab(mode: SearchQuery["mode"]): void {
  for (const btn of Array.from(refs.modeTabs.children)) {
    const active = (btn as HTMLElement).dataset.mode === mode;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  }
}

function updateFieldVisibility(): void {
  // "D'où venir" (to) picks a destination, so the departure field is irrelevant.
  refs.originField.style.display = query.mode === "to" ? "none" : "";
  // Destination: required in od/to; in tour it's the optional finish (can equal the
  // start for a loop), so the field appears there too with a clarifying placeholder.
  const needsDest = query.mode === "od" || query.mode === "to" || query.mode === "tour";
  refs.destinationField.style.display = needsDest ? "" : "none";
  refs.destination.placeholder = query.mode === "tour" ? t("tour_end_ph") : "";
  refreshTourEndDate();
  refs.viaField.style.display = query.mode === "od" ? "" : "none";
  // Flexible dates: in the "where to / where from" browse, widening to ±N days
  // surfaces more places; in a tour it lets the departure slip a few days later to
  // find a feasible start. Exact trip already has the 30-day calendar (the flex list
  // would just duplicate it); best has its ideas-by-day calendar.
  refs.flexField.style.display =
    query.mode === "from" || query.mode === "to" || query.mode === "tour" ? "" : "none";

  // Round trip (day trips + N-night getaways) is a "Where to?"-only toggle; its
  // options appear once the toggle is on, and "min hours on site" only for a
  // same-day (0-night) trip.
  refs.roundTripField.style.display = query.mode === "from" ? "" : "none";
  refs.roundTripOpts.style.display = query.mode === "from" && refs.roundTrip.checked ? "" : "none";
  refs.stayHoursField.style.display = refs.nights.value === "0" ? "" : "none";

  // Field placement per mode: a tour AND an exact trip promote Connections (with
  // Overnight/Night) into the prominent main form; the other modes keep it in
  // Advanced. The exact trip also promotes its search radius. Single elements moved
  // between the main fields grid and Advanced, never duplicated.
  const tour = query.mode === "tour";
  const od = query.mode === "od";
  if (tour || od) refs.regionField.parentElement?.insertBefore(refs.connGroupField, refs.regionField);
  else refs.trainTypeField.parentElement?.insertBefore(refs.connGroupField, refs.trainTypeField);
  if (od) refs.regionField.parentElement?.insertBefore(refs.radiusField, refs.regionField);
  else refs.trainTypeField.parentElement?.insertBefore(refs.radiusField, refs.trainTypeField);

  // Duration caps differ by mode. A single journey (od / from / to / best) caps its
  // TOTAL time. A multi-city tour instead caps the time of each hop ("max per
  // train") — a whole-tour total would be meaningless across multi-day stays.
  refs.maxDurationField.style.display = tour ? "none" : "";
  refs.maxLegDurationField.style.display = tour ? "" : "none";

  // Region: filters ideas in "best", and focuses the tour ("visit Bretagne").
  refs.regionField.style.display = query.mode === "best" || tour ? "" : "none";
  refs.citiesField.style.display = tour ? "" : "none";
  refs.stayField.style.display = tour ? "" : "none";
  // Km caps live in Advanced, shown only for a tour. Max trip span (days) lives in
  // Advanced too, shown only for the exact trip.
  refs.maxKmField.style.display = tour ? "" : "none";
  refs.maxSpanDaysField.style.display = query.mode === "od" ? "" : "none";
  refs.radiusField.style.display = query.mode === "od" ? "" : "none";
  // "Nearest stop" is a tour-only action (it grows a multi-city trip). Toggle the
  // inline display (not the `hidden` attribute, which `.btn { display }` overrides).
  if (nearestBtnEl) nearestBtnEl.style.display = tour ? "" : "none";
}

/**
 * The tour "finish by" date only makes sense with a destination set, so it appears
 * the moment a tour destination is filled (and tracks the start as its lower bound).
 */
function refreshTourEndDate(): void {
  const show = query.mode === "tour" && Boolean(resolveStation(refs.destination.value));
  refs.endDateField.style.display = show ? "" : "none";
  refs.endDate.min = query.date; // can't finish before you leave
}

function buildLayout(root: HTMLElement): void {
  clear(root);

  const meta = deps.meta;
  const when = meta.updatedAt
    ? new Date(meta.updatedAt).toLocaleString(getLang(), {
        dateStyle: "medium",
        timeStyle: "short",
        hourCycle: "h23", // 24-hour clock — no AM/PM, the convention in France/Europe
      })
    : "";
  const updated = when
    ? t("foot_updated", { date: when }) + (meta.isSample ? ` (${t("foot_sample")})` : "")
    : t("foot_sample");

  // header
  const langSel = el(
    "select",
    { class: "ctl", attrs: { "aria-label": t("ctl_lang") } },
    LANGS.map((l) => optionEl(l.code, l.label, settings.lang === l.code)),
  ) as HTMLSelectElement;
  langSel.addEventListener("change", () => {
    settings = { ...settings, lang: isLang(langSel.value) ? langSel.value : "fr" };
    setLang(settings.lang);
    store.saveSettings(settings);
    rebuild();
  });

  // Theme cycles auto → light → dark on a single monochrome icon button.
  const themeBtn = el("button", {
    class: "ctl icon-ctl",
    type: "button",
    attrs: { "aria-label": t("ctl_theme"), title: t("ctl_theme") },
    html: themeSvg(settings.theme),
  });
  themeBtn.addEventListener("click", () => {
    const order: store.Theme[] = ["auto", "light", "dark"];
    const next = order[(order.indexOf(settings.theme) + 1) % order.length]!;
    settings = { ...settings, theme: next };
    applyTheme(next);
    store.saveSettings(settings);
    themeBtn.innerHTML = themeSvg(next);
  });

  // Keyboard-shortcuts help (also the "?" key). Hidden on coarse-pointer devices
  // where there's no keyboard, to avoid clutter.
  const keysBtn = el("button", {
    class: "ctl icon-ctl keys-btn",
    type: "button",
    text: "?",
    attrs: { "aria-label": t("keys_title"), title: t("keys_title") },
    on: { click: showShortcutsHelp },
  });
  if (isTouch()) keysBtn.style.display = "none";

  // Card (pass) is a global preference, kept at the top and persisted at once.
  const cardSel = el("select", { class: "ctl", attrs: { "aria-label": t("field_card") } }, [
    optionEl("jeune", t("card_jeune"), settings.card === "jeune"),
    optionEl("senior", t("card_senior"), settings.card === "senior"),
  ]) as HTMLSelectElement;
  cardSel.addEventListener("change", () => {
    const card: store.Settings["card"] = cardSel.value === "senior" ? "senior" : "jeune";
    settings = { ...settings, card };
    store.saveSettings(settings);
    query = { ...query, card };
    store.updateUrl(query);
    runSearch(); // refresh the MAX SENIOR weekend notice
  });

  // Install (Add to home screen) — always present. Uses the native prompt when
  // the browser offers one, otherwise shows manual instructions.
  const installBtn = el("button", {
    class: "ctl install-btn",
    type: "button",
    text: t("act_install"),
    on: { click: () => void promptInstall() },
  });

  // GitHub link with a star, to invite stars on the repo.
  const ghLink = el("a", {
    class: "ctl gh-link",
    html: `<span aria-hidden="true">★</span> GitHub`,
    href: GITHUB_URL,
    attrs: { target: "_blank", rel: "noopener noreferrer", "aria-label": "GitHub" },
  });

  const header = el("header", { class: "site-header" }, [
    el("div", { class: "brand" }, [
      el("button", {
        class: "logo",
        type: "button",
        attrs: { "aria-label": t("appName"), title: t("appName") },
        on: { click: goHome },
        html: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="14" rx="3.2"/><path d="M5 10.5h14"/><path d="M9 17l-2.2 3.3M15 17l2.2 3.3"/><circle cx="9" cy="13.6" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="13.6" r="1" fill="currentColor" stroke="none"/></svg>`,
      }),
      el("div", {}, [
        el("h1", { text: t("appName") }),
        el("p", { class: "tagline", text: t("tagline") }),
        el("p", { class: "updated", attrs: { title: t("data_why"), tabindex: "0" } }, [
          el("span", { text: updated }),
          el("span", { class: "sr-only", text: t("data_why") }),
        ]),
      ]),
    ]),
    el("div", { class: "header-ctls" }, [ghLink, cardSel, langSel, keysBtn, themeBtn, installBtn]),
  ]);

  // form
  const built = buildForm();
  // results + map
  const title = el("h2", {
    class: "results-title",
    id: "results-title",
    text: t("tagline"),
    attrs: { tabindex: "-1" },
  });
  const results = el("div", { class: "results", attrs: { "aria-live": "polite" } });
  const mapEl = el("div", { class: "map", attrs: { "aria-label": t("map_title") } });

  const tripList = el("div", { class: "trip-list" });
  const savedAside = el("aside", { class: "saved-trips" }, [
    el("h2", { text: t("saved_title") }),
    tripList,
  ]);

  const favList = el("div", { class: "fav-list" });
  const aside = el("aside", { class: "favorites" }, [
    el("h2", { text: t("fav_title") }),
    favList,
  ]);

  const footer = el("footer", { class: "site-footer" }, [
    el("p", { class: "muted", text: t("foot_source") }),
    el("p", { class: "muted small", text: t("foot_disclaimer") }),
    el("div", { class: "foot-actions" }, [
      el("a", {
        class: "btn btn-ghost feedback-btn",
        text: t("act_report"),
        href: GITHUB_ISSUES_URL,
        attrs: { target: "_blank", rel: "noopener noreferrer" },
      }),
      el("a", {
        class: "foot-link",
        text: "GitHub",
        href: GITHUB_URL,
        attrs: { target: "_blank", rel: "noopener noreferrer" },
      }),
    ]),
  ]);

  const mapSection = el("section", { class: "map-section" }, [
    el("h3", { text: t("map_title") }),
    mapEl,
  ]);
  const layout = el("div", { class: "layout" }, [
    el("div", { class: "main-col" }, [built.form, title, results]),
    el("div", { class: "side-col" }, [savedAside, aside, mapSection]),
  ]);

  root.append(header, layout, footer);

  refs = {
    ...built.refs,
    title,
    results,
    mapEl,
    favList,
    tripList,
    card: cardSel,
  };
  map = null;
  renderFavorites();
  renderSavedTrips();
}

interface FormBuild {
  form: HTMLElement;
  refs: Omit<Refs, "title" | "results" | "mapEl" | "favList" | "tripList" | "card">;
}

function buildForm(): FormBuild {
  const stationList = el("datalist", { id: "station-list" });
  for (const s of deps.registry.list()) stationList.append(el("option", { value: s.label }));

  const modeTabs = el("div", { class: "mode-tabs", attrs: { role: "group", "aria-label": t("appName") } });
  (["from", "to", "od", "tour", "best"] as const).forEach((m, i) => {
    const btn = el("button", {
      class: "mode-tab",
      type: "button",
      text: t(`mode_${m}` as const),
      dataset: { mode: m },
      on: { click: () => switchMode(m) },
    });
    withShortcut(btn, String(i + 1)); // 1–5 mode shortcuts (see onGlobalKey)
    modeTabs.append(btn);
  });
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
  const date = inputEl("date");
  // Constrain dates to exactly the window the 30-day calendar renders.
  const windowDates = dateRange(today, BOOKING_WINDOW_DAYS);
  const lastBookable = windowDates[windowDates.length - 1] ?? today;
  date.min = today;
  date.max = lastBookable;
  // Optional tour finish-by date (shown only when a tour has a destination).
  const endDate = inputEl("date");
  endDate.min = today;
  endDate.max = lastBookable;
  endDate.setAttribute("aria-label", t("field_end_date"));
  const endDateField = field(t("field_end_date"), endDate);
  const departAfter = inputEl("time");
  const departBefore = inputEl("time");
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
  // Night trains are OFF by default (checkbox unchecked = trains that leave late or
  // arrive past midnight are dropped); checking it includes them. The default query
  // carries excludeNight, and syncFormFromQuery sets this from it.
  const night = el("input", { type: "checkbox" }) as HTMLInputElement;
  night.checked = false;
  const nightField = el("label", { class: "field field-check" }, [
    night,
    el("span", { class: "field-label", text: t("field_night") }),
  ]);
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
  // live form `change` handler re-runs the search but doesn't re-sync field
  // visibility (it avoids touching the form to keep focus), so switch here directly.
  // The "min hours on site" field is meaningful only for a same-day (0-night) trip.
  const syncRoundTripOpts = (): void => {
    roundTripOpts.style.display = roundTrip.checked ? "" : "none";
    stayHoursField.style.display = nights.value === "0" ? "" : "none";
  };
  roundTrip.addEventListener("change", syncRoundTripOpts);
  nights.addEventListener("change", syncRoundTripOpts);
  // Flexible dates ("± N days") for the exact-trip search — find a MAX seat around
  // the chosen date, not only on it.
  const flex = el("select", { class: "input" }, [
    optionEl("0", t("flex_exact"), true),
    optionEl("1", "± 1", false),
    optionEl("2", "± 2", false),
    optionEl("3", "± 3", false),
    optionEl("7", "± 7", false),
  ]) as HTMLSelectElement;
  const flexField = field(t("field_flex"), flex);
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
      e.preventDefault();
      commitCities(cities.value);
      cities.value = "";
      liveUpdate(); // keydown fires no `change`, so sync query/URL/results explicitly
    } else if (e.key === "Backspace" && cities.value === "" && tourCities.length) {
      tourCities.pop();
      renderCityChips();
      liveUpdate();
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
  ]);

  const advanced = el("details", { class: "advanced" }, [
    el("summary", { text: t("field_advanced") }),
    el("div", { class: "advanced-grid" }, [
      field(t("field_departAfter"), departAfter),
      field(t("field_departBefore"), departBefore),
      connGroupField,
      maxDurationField,
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
    modeTabs,
    modeDesc,
    el("div", { class: "fields" }, [
      originField,
      destinationField,
      viaField,
      field(t("field_date"), date),
      endDateField,
      roundTripField,
      flexField,
      regionField,
      citiesField,
      stayField,
    ]),
    advanced,
    el("div", { class: "form-actions" }, [searchBtn, surpriseBtn, nearestBtn]),
    surpriseMsgEl,
    howto,
    stationList,
  ]);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    runFromForm();
  });
  // Live form: react to any committed field change (incl. clearing a box) without
  // waiting for the Search button. `change` fires on commit (blur / datalist pick /
  // select), so it doesn't re-run on every keystroke. Keeps focus and scroll.
  form.addEventListener("change", () => liveUpdate());

  return {
    form,
    refs: {
      modeTabs,
      modeDesc,
      origin,
      destination,
      date,
      endDate,
      endDateField,
      departAfter,
      departBefore,
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
      roundTrip,
      nights,
      stayHours,
      stayHoursField,
      lateReturn,
      roundTripField,
      roundTripOpts,
      via,
      flex,
      flexField,
      originField,
      destinationField,
      viaField,
      maxDurationField,
      trainTypeField,
      region,
      regionField,
      cities,
      citiesField,
      cityChips,
      minDays,
      maxDays,
      stayField,
      maxKm,
      maxLegKm,
      maxKmField,
      maxLegDuration,
      maxLegDurationField,
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
            tourCities.splice(i, 1);
            renderCityChips();
            liveUpdate(); // keep query/URL/results in sync with the removal
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

/** Render the "Saved trips" rail card from localStorage (newest first). */
function renderSavedTrips(): void {
  clear(refs.tripList);
  const trips = store.loadTrips();
  // Hide the whole card while empty so it doesn't take prime space in the rail.
  refs.tripList.parentElement?.toggleAttribute("hidden", trips.length === 0);
  if (trips.length === 0) return;
  for (const trip of trips) {
    const out = trip.outbound;
    const inb = trip.inbound;
    const tour = trip.tour;
    // Route + date label differ by kind: a tour chains every stop; a round trip
    // uses ⇄ and a date range; a one-way is a single arrow + date.
    let label: string;
    let when: string;
    let open: () => void;
    if (tour) {
      const stops = [tour.legs[0]?.origin ?? out.origin, ...tour.legs.map((l) => l.destination)];
      label = stops.map((s) => deps.registry.label(s)).join(" → ");
      const last = tour.legs[tour.legs.length - 1];
      when = last ? `${formatDate(out.date)} – ${formatDate(last.date)}` : formatDate(out.date);
      open = () => showTourModal(tour);
    } else {
      label = `${deps.registry.label(out.origin)} ${inb ? "⇄" : "→"} ${deps.registry.label(out.destination)}`;
      when = inb ? `${formatDate(out.date)} – ${formatDate(inb.date)}` : formatDate(out.date);
      open = () => showTripModal(out, inb);
    }
    const row = el("div", { class: "fav-row trip-row" }, [
      el(
        "button",
        {
          class: "fav-open trip-open",
          type: "button",
          on: { click: open },
        },
        [el("span", { class: "trip-open-route", text: label }), el("span", { class: "muted small", text: when })],
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

/**
 * A field whose text input carries a clear "×" button (shown only when there's
 * something to clear). Clearing fires input+change so the live search reacts.
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

function optionEl(value: string, label: string, selected: boolean): HTMLElement {
  const o = el("option", { value, text: label }) as HTMLOptionElement;
  o.selected = selected;
  return o;
}

/** Monochrome theme glyph (sun / moon / half-disc) drawn in currentColor. */
function themeSvg(theme: store.Theme): string {
  const wrap = (inner: string): string =>
    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  if (theme === "light")
    return wrap(
      '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4l1.4-1.4M18 6l1.4-1.4"/>',
    );
  if (theme === "dark") return wrap('<path d="M20.5 13.2A8 8 0 1 1 10.8 3.5 6.3 6.3 0 0 0 20.5 13.2z"/>');
  return wrap('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>');
}
