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
import { bestTrips, stationsOnDate, reachableBest } from "./core/best";
import { planTours, planTourInOrder, planTourGreedy, type Tour } from "./core/tour";
import { findJourneys, journeySpanDays } from "./core/connections";
import { availabilityCalendar, destinationCalendar, dateRange } from "./core/calendar";
import { addDays } from "./util/time";
import { haversineKm } from "./util/geo";
import { el, clear } from "./ui/dom";
import { RouteMap } from "./ui/map";
import * as render from "./ui/render";
import type { RenderCtx } from "./ui/render";
import { journeyToIcs, downloadText } from "./ui/ics";
import { t, setLang, getLang, LANGS, isLang } from "./i18n";
import * as store from "./state/store";
import {
  SNCF_CONNECT_URL,
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
  card: HTMLSelectElement;
  departAfter: HTMLInputElement;
  departBefore: HTMLInputElement;
  maxDuration: HTMLInputElement;
  maxSpanDays: HTMLInputElement;
  maxSpanDaysField: HTMLElement;
  trainType: HTMLSelectElement;
  maxConnections: HTMLSelectElement;
  connectionsField: HTMLElement;
  overnight: HTMLInputElement;
  overnightField: HTMLElement;
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
  title: HTMLElement;
  results: HTMLElement;
  mapEl: HTMLElement;
  favList: HTMLElement;
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
  const planOpts = { maxConnections: query.maxConnections };
  let chosen: string | undefined;
  for (let i = 0; i < candidates.length && i < 40; i++) {
    const c = candidates[i]!;
    if (planTourInOrder(deps.trains, origin, [...tourCities, c], query.date, planOpts, lo, hi, stationDistanceKm, query.maxKm, query.maxLegKm)) {
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
    : { mode: "from", date: today, card: settings.card, maxConnections: 1 };

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
  const hit = deps.registry.search(norm, 1)[0];
  return hit ? hit.id : norm;
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
    bookUrl: () => SNCF_CONNECT_URL,
    cityInfoUrl,
    onOpenRoute: (origin, destination) => {
      navStack.push({ ...query }); // remember the list we came from
      query = { ...query, mode: "od", origin, destination };
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
      if (date === query.date) return;
      query = { ...query, date };
      refreshInPlace();
    },
    onIcs: (j) => {
      const summary = `MAX ${deps.registry.label(j.origin)} → ${deps.registry.label(j.destination)}`;
      const slug = j.legs.map((l) => l.trainNo.replace(/[^a-zA-Z0-9-]/g, "")).join("-");
      downloadText(`max-${j.date}-${slug}.ics`, journeyToIcs(j, summary));
    },
    isFavorite: (route) => store.isFavorite(route),
    onToggleFavorite: (route) => {
      store.toggleFavorite(route);
      renderFavorites();
    },
  };
}

// --- query <-> form ---------------------------------------------------------

function syncFormFromQuery(): void {
  setSurpriseMsg(""); // a navigation clears any stale "surprise" notice
  setActiveTab(query.mode);
  refs.modeDesc.textContent = t(`desc_${query.mode}` as const);
  refs.origin.value = query.origin ? deps.registry.label(query.origin) : "";
  refs.destination.value = query.destination ? deps.registry.label(query.destination) : "";
  refs.via.value = query.via ? deps.registry.label(query.via) : "";
  refs.flex.value = String(query.flexDays ?? 0);
  refs.date.value = query.date;
  refs.card.value = query.card;
  refs.departAfter.value = query.departAfter ?? "";
  refs.departBefore.value = query.departBefore ?? "";
  refs.maxDuration.value = query.maxDurationMin != null ? String(query.maxDurationMin) : "";
  refs.maxSpanDays.value = query.maxSpanDays != null ? String(query.maxSpanDays) : "";
  refs.trainType.value = query.trainType ?? "";
  refs.maxConnections.value = String(query.maxConnections);
  refs.overnight.checked = Boolean(query.overnight);
  refs.region.value = query.region ?? "";
  tourCities = [...(query.cities ?? [])];
  refs.cities.value = "";
  renderCityChips();
  refs.minDays.value = String(query.minDays ?? 1);
  refs.maxDays.value = String(query.maxDays ?? 3);
  refs.maxKm.value = query.maxKm != null ? String(query.maxKm) : "";
  refs.maxLegKm.value = query.maxLegKm != null ? String(query.maxLegKm) : "";
  updateFieldVisibility();
}

function readQueryFromForm(): SearchQuery {
  const maxDur = Number(refs.maxDuration.value.trim());
  const maxKm = Number(refs.maxKm.value.trim());
  const maxLegKm = Number(refs.maxLegKm.value.trim());
  const span = Number(refs.maxSpanDays.value.trim());
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
    // Max trip span (days) is an exact-trip cap only — gated to od so it never leaks.
    maxSpanDays:
      query.mode === "od" && Number.isFinite(span) && span >= 1 ? Math.min(14, Math.floor(span)) : undefined,
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

function filterOpts() {
  return {
    departAfter: query.departAfter,
    departBefore: query.departBefore,
    maxDurationMin: query.maxDurationMin,
    trainType: query.trainType,
    // Overnight stopovers: widen the layover ceiling so a journey can wait
    // overnight at a hub instead of being limited to a ~4h connection.
    ...(query.overnight ? { maxConnectionMin: OVERNIGHT_MAX_CONNECTION_MIN } : {}),
  };
}

function runSearch(): void {
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
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
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
  refs.title.textContent = t(dir === "from" ? "res_from_title" : "res_to_title", {
    station: registry.label(anchor),
    date: formatDate(query.date),
  });
  const countKey = dir === "from" ? "res_destinations" : "res_origins";

  // Trains that run on the *selected* day, per station — this is the list: every
  // place shown actually has a free-MAX train that day (no "0 this day" rows).
  const dayGroups =
    dir === "from"
      ? reachableDestinations(trains, anchor, query.date, filterOpts())
      : reachableOrigins(trains, anchor, query.date, filterOpts());
  const dayCount = new Map(dayGroups.map((g) => [g.station, g.count]));

  // Take the whole-window record for those same-day stations, so each card can show
  // both the day count and the month total (the richer card data: fastest time etc.).
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
      render.groupCardEl(g, dir, anchor, c, dayCount.get(g.station) ?? 0, stats.get(g.station)),
    );
  for (const tr of connecting) refs.results.append(render.reachTripRowEl(tr.station, tr.journey, c));
  showMap(anchor, [...groups.map((g) => g.station), ...connecting.map((tr) => tr.station)]);
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
  const planOpts = { maxConnections: query.maxConnections };
  const maxKm = query.maxKm; // optional cap on the tour's total straight-line km
  const legKm = query.maxLegKm; // optional cap on each hop's straight-line km
  // Up to 5 cities: try every order and pick the fastest. Beyond that, permuting
  // is factorial, so order them greedily (nearest reachable city each hop). If the
  // greedy route dead-ends, fall back to the typed order — a Surprise / "nearest
  // stop" run already builds a feasible chain in that order.
  let tours: Tour[];
  if (cities.length <= 5) {
    tours = planTours(trains, query.origin, cities, query.date, planOpts, 10, lo, hi, stationDistanceKm, maxKm, legKm);
  } else {
    const single =
      planTourGreedy(trains, query.origin, cities, query.date, planOpts, lo, hi, stationDistanceKm, maxKm, legKm) ??
      planTourInOrder(trains, query.origin, cities, query.date, planOpts, lo, hi, stationDistanceKm, maxKm, legKm);
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
  refs.title.textContent = t("best_title", {
    station: registry.label(query.origin),
    date: formatDate(query.date),
  });
  // Ideas by day: a 30-day strip showing how many destinations run each day.
  // Clicking a day reloads that day's list (works even when today's is empty, so
  // you can hop to a better day).
  const inRegion = (d: string): boolean =>
    !query.region || registry.get(d)?.region === query.region;
  const cal = destinationCalendar(
    trains,
    query.origin,
    dateRange(today, BOOKING_WINDOW_DAYS),
    filterOpts(),
    inRegion,
  );
  refs.results.append(
    render.calendarEl(cal, c, query.date, {
      title: t("best_cal_title"),
      count: (n) => t("best_cal_count", { n }),
    }),
  );

  let trips = bestTrips(trains, query.origin, query.date, stationsOnDate(trains, query.date), {
    ...filterOpts(),
    maxConnections: query.maxConnections,
  });
  if (query.region) {
    trips = trips.filter((tr) => registry.get(tr.destination)?.region === query.region);
  }
  if (trips.length === 0) {
    refs.results.append(render.emptyEl(t("res_none")), render.hintEl(t("res_none_hint")));
    return;
  }

  // (Date navigation in best mode is the "ideas by day" calendar above — no
  // separate flexible-dates strip here.)
  refs.results.append(
    el("p", { class: "muted count", text: t("res_destinations", { n: trips.length }) }),
  );
  for (const tr of trips) refs.results.append(render.bestTripRowEl(tr, c));
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
  const cal = availabilityCalendar(
    trains,
    query.origin,
    query.destination,
    dateRange(today, BOOKING_WINDOW_DAYS),
    connOpts,
    passesVia,
  );
  refs.results.append(render.calendarEl(cal, c, query.date));

  const lastBookable = addDays(today, BOOKING_WINDOW_DAYS - 1);
  // A journey's day-span cap (e.g. "no trip longer than 2 days"): overnight
  // stopovers can chain trains across days, so cap the calendar span here.
  const withinSpan = (j: Journey): boolean =>
    !query.maxSpanDays || journeySpanDays(j) <= query.maxSpanDays;

  // Flexible dates: the fastest free-MAX trip for each day within ±flexDays of the
  // chosen date (clamped to the bookable window). Pick a day to see its full list.
  if (query.flexDays && query.flexDays > 0) {
    const section = el("section", { class: "flex-dates" }, [el("h3", { text: t("field_flex") })]);
    let any = false;
    for (let i = -query.flexDays; i <= query.flexDays; i++) {
      const d = addDays(query.date, i);
      if (d < today || d > lastBookable) continue;
      const fastest = findJourneys(trains, query.origin, query.destination, d, connOpts)
        .filter(passesVia)
        .filter(withinSpan)
        .reduce<Journey | null>((a, b) => (!a || b.totalDurationMin < a.totalDurationMin ? b : a), null);
      if (!fastest) continue;
      section.append(render.flexDayEl(d, fastest, c, d === query.date));
      any = true;
    }
    if (any) refs.results.append(section);
  }

  // Sort by total travel time, fastest first (then earliest departure as a
  // tiebreak) so the best option is at the top of the list and the slowest last.
  const journeys: Journey[] = findJourneys(
    trains,
    query.origin,
    query.destination,
    query.date,
    connOpts,
  )
    .filter(passesVia)
    .filter(withinSpan)
    .sort((a, b) => a.totalDurationMin - b.totalDurationMin || a.departMin - b.departMin);
  if (journeys.length === 0)
    refs.results.append(render.emptyEl(t("res_none")), render.hintEl(t("res_none_hint")));
  else for (const j of journeys) refs.results.append(render.journeyEl(j, c));

  // "Do you want to come back?": once an outbound exists, propose a return a couple
  // of days later (editable) and list the free-MAX returns for that day, live.
  if (journeys.length > 0) {
    const origin = query.origin;
    const destination = query.destination;
    const proposed =
      odReturnDate ?? (addDays(query.date, 2) > lastBookable ? lastBookable : addDays(query.date, 2));
    const retInput = inputEl("date");
    retInput.min = query.date;
    retInput.max = lastBookable;
    retInput.value = proposed;
    retInput.setAttribute("aria-label", t("ret_date_label"));
    const retList = el("div", { class: "return-list" });
    const returnOpts = { ...filterOpts(), maxConnections: query.maxConnections };
    const renderReturns = (retDate: string): void => {
      clear(retList);
      const back = findJourneys(trains, destination, origin, retDate, returnOpts)
        .filter(withinSpan)
        .sort((a, b) => a.totalDurationMin - b.totalDurationMin || a.departMin - b.departMin);
      if (back.length === 0) retList.append(render.emptyEl(t("ret_none")));
      else for (const j of back) retList.append(render.journeyEl(j, c));
    };
    retInput.addEventListener("change", () => {
      odReturnDate = retInput.value || proposed;
      renderReturns(odReturnDate);
    });
    renderReturns(proposed);
    refs.results.append(
      el("section", { class: "od-return" }, [
        el("h3", { text: t("ret_title") }),
        el("label", { class: "field return-date-field" }, [
          el("span", { class: "field-label", text: t("ret_date_label") }),
          retInput,
        ]),
        retList,
      ]),
    );
  }

  // Draw the most relevant journey as an ordered path (origin → via → destination),
  // so a correspondence shows up as a secondary point on the line. The list is
  // sorted fastest-first, so the first journey is the quickest.
  const display = journeys[0] ?? null;
  showRoute(display ? [display.origin, ...display.hubs, display.destination] : [query.origin, query.destination]);
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
  query = { mode: "from", date: today, card: settings.card, maxConnections: 1 };
  syncFormFromQuery();
  applyAndRun();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/** Switch search mode (tab click or 1–5 shortcut), starting a fresh history. */
function switchMode(mode: SearchQuery["mode"]): void {
  navStack = [];
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
    const planOpts = { maxConnections: query.maxConnections };
    // No cap: the planner is memoised (journey cache persists across calls), so
    // scanning the whole frontier pool is cheap and avoids falsely reporting
    // "no city" when the few feasible ones land late in the shuffled order.
    let chosen: string | undefined;
    for (const c of pool) {
      if (planTourInOrder(deps.trains, origin, [...tourCities, c], query.date, planOpts, lo, hi, stationDistanceKm, query.maxKm, query.maxLegKm)) {
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
  const needsDest = query.mode === "od" || query.mode === "to";
  refs.destinationField.style.display = needsDest ? "" : "none";
  refs.viaField.style.display = query.mode === "od" ? "" : "none";
  // Flexible dates make sense only for a precise trip (od). from/to span the whole
  // window already, best has its own "ideas by day" calendar, tour its day range.
  refs.flexField.style.display = query.mode === "od" ? "" : "none";

  // Field placement per mode: a tour promotes Connections, Overnight and Max
  // duration into the prominent main form (and tucks its km caps into Advanced);
  // every other mode keeps Connections/Overnight/Max-duration in Advanced. These
  // are single elements moved between containers, never duplicated.
  const tour = query.mode === "tour";
  const movables = [refs.maxDurationField, refs.connectionsField, refs.overnightField];
  for (const f of movables) {
    if (tour) refs.regionField.parentElement?.insertBefore(f, refs.regionField);
    else refs.trainTypeField.parentElement?.insertBefore(f, refs.trainTypeField);
  }
  refs.maxDurationField.style.display = ""; // visible in whichever container it sits

  // Region: filters ideas in "best", and focuses the tour ("visit Bretagne").
  refs.regionField.style.display = query.mode === "best" || tour ? "" : "none";
  refs.citiesField.style.display = tour ? "" : "none";
  refs.stayField.style.display = tour ? "" : "none";
  // Km caps live in Advanced, shown only for a tour. Max trip span (days) lives in
  // Advanced too, shown only for the exact trip.
  refs.maxKmField.style.display = tour ? "" : "none";
  refs.maxSpanDaysField.style.display = query.mode === "od" ? "" : "none";
  // "Nearest stop" is a tour-only action (it grows a multi-city trip). Toggle the
  // inline display (not the `hidden` attribute, which `.btn { display }` overrides).
  if (nearestBtnEl) nearestBtnEl.style.display = tour ? "" : "none";
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
    el("div", { class: "side-col" }, [aside, mapSection]),
  ]);

  root.append(header, layout, footer);

  refs = {
    ...built.refs,
    title,
    results,
    mapEl,
    favList,
    card: cardSel,
  };
  map = null;
  renderFavorites();
}

interface FormBuild {
  form: HTMLElement;
  refs: Omit<Refs, "title" | "results" | "mapEl" | "favList" | "card">;
}

function buildForm(): FormBuild {
  const stationList = el("datalist", { id: "station-list" });
  for (const s of deps.registry.list()) stationList.append(el("option", { value: s.label }));

  const modeTabs = el("div", { class: "mode-tabs", attrs: { role: "group", "aria-label": t("appName") } });
  for (const m of ["from", "to", "od", "tour", "best"] as const) {
    const btn = el("button", {
      class: "mode-tab",
      type: "button",
      text: t(`mode_${m}` as const),
      dataset: { mode: m },
      on: { click: () => switchMode(m) },
    });
    modeTabs.append(btn);
  }
  const modeDesc = el("p", { class: "mode-desc" });

  const origin = inputEl("text", "station-list");
  const destination = inputEl("text", "station-list");
  const via = inputEl("text", "station-list");
  const date = inputEl("date");
  // Constrain dates to exactly the window the 30-day calendar renders.
  const windowDates = dateRange(today, BOOKING_WINDOW_DAYS);
  const lastBookable = windowDates[windowDates.length - 1] ?? today;
  date.min = today;
  date.max = lastBookable;
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

  const originField = field(t("field_origin"), origin);
  const destinationField = field(t("field_destination"), destination);
  const viaField = field(t("field_via"), via);
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
  const maxKm = inputEl("number");
  maxKm.min = "0";
  maxKm.step = "50";
  maxKm.placeholder = "1000";
  maxKm.setAttribute("aria-label", t("field_maxKm"));
  const maxLegKm = inputEl("number");
  maxLegKm.min = "0";
  maxLegKm.step = "50";
  maxLegKm.placeholder = "400";
  maxLegKm.setAttribute("aria-label", t("field_maxLegKm"));
  const maxKmField = el("div", { class: "stay-fields" }, [
    field(t("field_maxKm"), maxKm),
    field(t("field_maxLegKm"), maxLegKm),
  ]);

  // These three default to Advanced; updateFieldVisibility() promotes them into the
  // main form for a tour (where connections/overnight/duration matter most). Train
  // type stays last as a stable insertion anchor. Km caps + max-span sit in Advanced
  // and are shown per mode (km for tour, span for od).
  const maxDurationField = field(t("field_maxDuration"), maxDuration);
  const connectionsField = field(t("field_connections"), maxConnections);
  const maxSpanDaysField = field(t("field_maxSpanDays"), maxSpanDays);
  const trainTypeField = field(t("field_trainType"), trainType);

  const advanced = el("details", { class: "advanced" }, [
    el("summary", { text: t("field_advanced") }),
    el("div", { class: "advanced-grid" }, [
      field(t("field_departAfter"), departAfter),
      field(t("field_departBefore"), departBefore),
      connectionsField,
      overnightField,
      maxDurationField,
      maxSpanDaysField,
      maxKmField,
      trainTypeField,
    ]),
  ]);

  const searchBtn = el("button", { class: "btn btn-primary", type: "submit", text: t("btn_search") });
  // A discreet, playful shortcut to a random city.
  const surpriseBtn = el("button", {
    class: "btn btn-ghost surprise-btn",
    type: "button",
    text: t("act_surprise"),
    on: { click: surpriseMe },
  });
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
      departAfter,
      departBefore,
      maxDuration,
      maxSpanDays,
      maxSpanDaysField,
      trainType,
      maxConnections,
      connectionsField,
      overnight,
      overnightField,
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
    },
  };
}

/**
 * Prefill the search form with a saved route (origin + destination, exact-trip
 * mode) without running it — so clicking a favorite sets up the start rather than
 * jumping straight to a result. The user reviews and presses Search.
 */
function fillRoute(origin: string, destination: string): void {
  query = { ...query, mode: "od", origin, destination };
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
