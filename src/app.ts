import type { Dataset } from "./data/dataset";
import { StationRegistry } from "./data/stations";
import type { SearchQuery, MaxTrain, Journey } from "./types";
import { reachableDestinations, reachableOrigins, windowStats } from "./core/destinations";
import { filterTrains } from "./core/search";
import { bestTrips, stationsOnDate, reachableBest } from "./core/best";
import { planTours } from "./core/tour";
import { findJourneys } from "./core/connections";
import { availabilityCalendar, dateRange } from "./core/calendar";
import { findRoundTrips } from "./core/roundtrip";
import { el, clear } from "./ui/dom";
import { RouteMap, type MarkerInfo } from "./ui/map";
import * as render from "./ui/render";
import type { RenderCtx } from "./ui/render";
import { journeyToIcs, downloadText } from "./ui/ics";
import { relativeTime, formatDuration } from "./util/time";
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
  returnDate: HTMLInputElement;
  card: HTMLSelectElement;
  departAfter: HTMLInputElement;
  departBefore: HTMLInputElement;
  maxDuration: HTMLInputElement;
  trainType: HTMLSelectElement;
  maxConnections: HTMLSelectElement;
  overnight: HTMLInputElement;
  via: HTMLInputElement;
  originField: HTMLElement;
  destinationField: HTMLElement;
  viaField: HTMLElement;
  returnField: HTMLElement;
  region: HTMLSelectElement;
  regionField: HTMLElement;
  cities: HTMLInputElement;
  citiesField: HTMLElement;
  cityChips: HTMLElement;
  stayDays: HTMLInputElement;
  stayField: HTMLElement;
  title: HTMLElement;
  resultsTools: HTMLElement;
  searchBox: HTMLInputElement;
  sortSel: HTMLSelectElement;
  viewToggle: HTMLElement;
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

// --- results toolbar (filter box + sort + show-more) ------------------------
type SortKey = "relevance" | "fast" | "name" | "depart";
// Render the destination list in pages; "Show more" reveals the next page. Keeps
// the DOM light on long lists while preserving a single scannable list.
const RESULTS_PAGE = 40;
let resultsQuery = ""; // place filter text (browse/best lists only)
let resultsSort: SortKey = "relevance";
let resultsShown = RESULTS_PAGE;
// Signature of the last "real" search; when it changes we reset the toolbar.
let lastMainKey = "";

/** A sortable/filterable destination row in a browse/best list. */
interface DestItem {
  station: string;
  name: string; // lowercased label, for the filter box
  trains: number; // window availability — drives "relevance"/most-trains in browse
  duration: number; // minutes — drives "fastest"
  connections: number; // changes to reach it — tints the map pin green→red
  meta: string; // concise summary for the map pin card, e.g. "3 trains · 1 h 50"
  open: () => void; // open the exact-trip view for this destination
  build: () => HTMLElement;
}
// Computed once per search and reused while the user filters/sorts/pages, so
// typing in the filter box doesn't recompute the heavy reachability search.
let listCache: { anchor: string; items: DestItem[] } | null = null;

// PWA install prompt (Chromium "beforeinstallprompt"). Held until the user clicks.
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
let installPrompt: InstallPromptEvent | null = null;
let installBtnEl: HTMLElement | null = null;

function refreshInstallBtn(): void {
  installBtnEl?.toggleAttribute("hidden", !installPrompt);
}

async function promptInstall(): Promise<void> {
  if (!installPrompt) return;
  await installPrompt.prompt();
  await installPrompt.userChoice.catch(() => undefined);
  installPrompt = null;
  refreshInstallBtn();
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

  // The bars above the map row can reflow (wrapping controls, mode change); keep
  // the map's available height in sync.
  window.addEventListener("resize", updateRailMetrics);

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e as InstallPromptEvent;
    refreshInstallBtn();
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    refreshInstallBtn();
  });

  // Escape goes back to the previous page (same as the "Retour" button), when
  // there's somewhere to go back to.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && navStack.length) {
      e.preventDefault();
      goBack();
    }
  });

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
  setActiveTab(query.mode);
  refs.modeDesc.textContent = t(`desc_${query.mode}` as const);
  refs.origin.value = query.origin ? deps.registry.label(query.origin) : "";
  refs.destination.value = query.destination ? deps.registry.label(query.destination) : "";
  refs.via.value = query.via ? deps.registry.label(query.via) : "";
  refs.date.value = query.date;
  refs.card.value = query.card;
  refs.departAfter.value = query.departAfter ?? "";
  refs.departBefore.value = query.departBefore ?? "";
  refs.maxDuration.value = query.maxDurationMin != null ? String(query.maxDurationMin) : "";
  refs.trainType.value = query.trainType ?? "";
  refs.maxConnections.value = String(query.maxConnections);
  refs.overnight.checked = Boolean(query.overnight);
  refs.region.value = query.region ?? "";
  tourCities = [...(query.cities ?? [])];
  refs.cities.value = "";
  renderCityChips();
  refs.stayDays.value = query.stayDays != null ? String(query.stayDays) : "";
  updateFieldVisibility();
}

function readQueryFromForm(): SearchQuery {
  const maxDur = Number(refs.maxDuration.value.trim());
  return {
    mode: query.mode,
    origin: resolveStation(refs.origin.value),
    destination: resolveStation(refs.destination.value),
    via: resolveStation(refs.via.value),
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
    stayDays: (() => {
      const n = Number(refs.stayDays.value.trim());
      return Number.isFinite(n) && n > 1 ? Math.min(14, Math.floor(n)) : undefined;
    })(),
  };
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
  // Delayed skeleton: CSS keeps it invisible for 150ms, so instant searches never
  // flash it, while heavy modes (best/tour on large data) show it. The compute is
  // deferred a frame so the skeleton can paint first.
  refs.results.append(render.skeletonEl());
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

  // Reset the results toolbar (filter/sort/page) on a genuinely new search; a
  // toolbar-driven repaint keeps the same query signature and is left untouched.
  const mainKey = JSON.stringify(query);
  const isNewSearch = mainKey !== lastMainKey;
  if (isNewSearch) {
    lastMainKey = mainKey;
    resultsQuery = "";
    resultsSort = defaultSort(query.mode);
    resultsShown = RESULTS_PAGE;
    listCache = null;
  }
  configureToolbar(query.mode, isNewSearch);

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

  // Keep the sticky map sized to the viewport minus the bars above it.
  updateRailMetrics();
}

/** Default sort for a mode: browse ranks by availability, others by speed. */
function defaultSort(mode: SearchQuery["mode"]): SortKey {
  return mode === "from" || mode === "to" ? "relevance" : "fast";
}

/** Per-mode visibility + sort options for the results toolbar. */
function configureToolbar(mode: SearchQuery["mode"], resetFilterValue: boolean): void {
  const listMode = mode === "from" || mode === "to" || mode === "best" || mode === "od";
  const hasAnchor =
    mode === "to"
      ? Boolean(query.destination)
      : mode === "od"
        ? Boolean(query.origin && query.destination)
        : Boolean(query.origin);
  refs.resultsTools.hidden = !(listMode && hasAnchor);
  if (refs.resultsTools.hidden) return;

  // The place filter only makes sense for lists of different places, not the
  // single-route exact-trip view. Hide the whole input wrap (keep sort).
  (refs.searchBox.parentElement as HTMLElement | null)?.toggleAttribute("hidden", mode === "od");

  const opts: Array<[SortKey, "sort_relevance" | "sort_fast" | "sort_name" | "sort_depart"]> =
    mode === "od"
      ? [["fast", "sort_fast"], ["depart", "sort_depart"]]
      : mode === "best"
        ? [["fast", "sort_fast"], ["name", "sort_name"]]
        : [["relevance", "sort_relevance"], ["fast", "sort_fast"], ["name", "sort_name"]];
  if (!opts.some(([v]) => v === resultsSort)) resultsSort = opts[0]![0];
  clear(refs.sortSel);
  for (const [val, key] of opts) refs.sortSel.append(optionEl(val, t(key), val === resultsSort));
  refs.sortSel.value = resultsSort;
  if (resetFilterValue) refs.searchBox.value = resultsQuery;
}

/**
 * Filter + sort + page a cached destination list into the results area, and plot
 * the (filtered) stations on the map. Used by browse and "best" modes.
 */
function paintDestList(countKey: "res_destinations" | "res_origins"): void {
  if (!listCache) return;
  const { anchor, items } = listCache;
  const q = resultsQuery.trim().toLowerCase();
  const filtered = (q ? items.filter((it) => it.name.includes(q)) : items.slice()).sort(
    sortComparator(resultsSort, query.mode),
  );

  if (filtered.length === 0) {
    refs.results.append(render.emptyEl(t("res_none")));
    showMap(anchor, []);
    return;
  }
  refs.results.append(el("p", { class: "muted count", text: t(countKey, { n: filtered.length }) }));
  const visible = filtered.slice(0, resultsShown);
  for (const it of visible) refs.results.append(it.build());
  const hidden = filtered.length - visible.length;
  if (hidden > 0) {
    refs.results.append(
      el("button", {
        class: "btn btn-ghost show-more",
        type: "button",
        text: `${t("results_more")} (${hidden})`,
        on: {
          click: () => {
            resultsShown += RESULTS_PAGE;
            repaintResults();
          },
        },
      }),
    );
  }
  // Map pins carry a hover/click card with the trip summary + "open exact trip".
  const info = new Map<string, MarkerInfo>();
  for (const it of filtered) {
    info.set(it.station, {
      title: deps.registry.label(it.station),
      meta: it.meta,
      connections: it.connections,
      action: { label: t("mode_od"), run: it.open },
    });
  }
  showMap(anchor, filtered.map((it) => it.station), info);
}

/** Comparator for the chosen sort key. Relevance differs by mode. */
function sortComparator(sort: SortKey, mode: SearchQuery["mode"]): (a: DestItem, b: DestItem) => number {
  const byName = (a: DestItem, b: DestItem): number => a.name.localeCompare(b.name);
  const byFast = (a: DestItem, b: DestItem): number => a.duration - b.duration || byName(a, b);
  const byTrains = (a: DestItem, b: DestItem): number => b.trains - a.trains || byName(a, b);
  if (sort === "name") return byName;
  if (sort === "fast") return byFast;
  return mode === "best" ? byFast : byTrains; // relevance
}

/** Re-render the results in place (filter/sort/page change) keeping scroll. */
function repaintResults(): void {
  const y = window.scrollY;
  clear(refs.results);
  renderSearch();
  window.scrollTo({ top: y });
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

  // Compute the destination list once per search; filter/sort/page reuse the cache.
  if (!listCache) {
    const groups =
      dir === "from"
        ? reachableDestinations(trains, anchor, query.date, filterOpts())
        : reachableOrigins(trains, anchor, query.date, filterOpts());
    const directStations = new Set(groups.map((g) => g.station));
    // Total MAX availability over the whole booking window, per place — the figure
    // shown on each card and the basis for the "relevance" (most-served) ranking.
    const stats = windowStats(trains, anchor, dir, filterOpts());

    const items: DestItem[] = groups.map((g) => {
      const origin = dir === "from" ? anchor : g.station;
      const destination = dir === "from" ? g.station : anchor;
      const windowTrains = stats.get(g.station)?.trains ?? g.count;
      return {
        station: g.station,
        name: registry.label(g.station).toLowerCase(),
        trains: windowTrains,
        duration: g.minDurationMin,
        connections: 0, // direct destinations
        meta: `${t("badge_trains", { n: windowTrains })} · ${formatDuration(g.minDurationMin)}`,
        open: () => c.onOpenRoute(origin, destination),
        build: () => render.groupCardEl(g, dir, anchor, c, stats.get(g.station)),
      };
    });

    // Connection-only destinations (not already direct), capped for compactness.
    if (query.maxConnections > 0) {
      const connecting = reachableBest(
        trains,
        anchor,
        query.date,
        stationsOnDate(trains, query.date),
        { ...filterOpts(), maxConnections: query.maxConnections },
        dir,
      )
        .filter((tr) => tr.journey.legs.length > 1 && !directStations.has(tr.station))
        .slice(0, MAX_VIA_RESULTS);
      for (const tr of connecting) {
        const j = tr.journey;
        items.push({
          station: tr.station,
          name: registry.label(tr.station).toLowerCase(),
          trains: 0,
          duration: j.totalDurationMin,
          connections: j.legs.length - 1,
          meta: `${t("lbl_via", { hub: j.hubs.map((h) => registry.label(h)).join(", ") })} · ${formatDuration(j.totalDurationMin)}`,
          open: () => c.onOpenRoute(j.origin, j.destination),
          build: () => render.reachTripRowEl(tr.station, j, c),
        });
      }
    }
    listCache = { anchor, items };
  }
  paintDestList(countKey);
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
  const tours = planTours(
    trains,
    query.origin,
    cities,
    query.date,
    { maxConnections: query.maxConnections },
    10,
    query.stayDays ?? 1,
  );
  if (tours.length === 0) {
    refs.results.append(render.emptyEl(t("tour_none")));
    return;
  }
  for (const tour of tours) refs.results.append(render.tourEl(tour, c));
  showMap(query.origin, cities);
}

function runBestSearch(c: RenderCtx): void {
  const { trains, registry } = deps;
  if (!query.origin) return showHint(refs.origin);
  refs.title.textContent = t("best_title", {
    station: registry.label(query.origin),
    date: formatDate(query.date),
  });
  if (!listCache) {
    let trips = bestTrips(trains, query.origin, query.date, stationsOnDate(trains, query.date), {
      ...filterOpts(),
      maxConnections: query.maxConnections,
    });
    if (query.region) {
      trips = trips.filter((tr) => registry.get(tr.destination)?.region === query.region);
    }
    const items: DestItem[] = trips.map((tr) => {
      const j = tr.journey;
      const via =
        j.legs.length > 1
          ? t("lbl_via", { hub: j.hubs.map((h) => registry.label(h)).join(", ") })
          : t("lbl_direct");
      return {
        station: tr.destination,
        name: registry.label(tr.destination).toLowerCase(),
        trains: 0,
        duration: j.totalDurationMin,
        connections: j.legs.length - 1,
        meta: `${via} · ${formatDuration(j.totalDurationMin)}`,
        open: () => c.onOpenRoute(j.origin, j.destination),
        build: () => render.bestTripRowEl(tr, c),
      };
    });
    listCache = { anchor: query.origin, items };
  }
  paintDestList("res_destinations");
}

function runOdSearch(c: RenderCtx): void {
  const { trains, registry } = deps;
  if (!query.origin || !query.destination) {
    return showHint(query.origin ? refs.destination : refs.origin);
  }
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

  // Sort by the chosen key: fastest (default, earliest departure as tiebreak) or
  // earliest departure. The toolbar sort dropdown drives this for exact trips.
  const journeys: Journey[] = findJourneys(
    trains,
    query.origin,
    query.destination,
    query.date,
    connOpts,
  )
    .filter(passesVia)
    .sort((a, b) =>
      resultsSort === "depart"
        ? a.departMin - b.departMin || a.totalDurationMin - b.totalDurationMin
        : a.totalDurationMin - b.totalDurationMin || a.departMin - b.departMin,
    );
  if (journeys.length === 0) refs.results.append(render.emptyEl(t("res_none")));
  else for (const j of journeys) refs.results.append(render.journeyEl(j, c));

  // optional round trips
  const ret = refs.returnDate.value;
  if (ret) {
    const trips = findRoundTrips(trains, query.origin, query.destination, query.date, ret, connOpts).filter(
      (rt) => passesVia(rt.outbound) && passesVia(rt.inbound),
    );
    const section = el("section", { class: "roundtrips" }, [el("h3", { text: t("rt_title") })]);
    if (trips.length === 0) section.append(render.emptyEl(t("rt_none")));
    else for (const rt of trips.slice(0, 20)) section.append(render.roundTripEl(rt, c));
    refs.results.append(section);
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
  // A clean "get started" empty state instead of a blank area.
  refs.title.textContent = "";
  refs.results.append(render.emptyEl(t("prompt_pick"), t("tagline")));
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

  if (query.mode === "tour") {
    // Tour: add a random city to visit — never touch the departure city.
    const used = new Set([query.origin, ...tourCities].filter((x): x is string => Boolean(x)));
    const city = pickFrom(destinations().filter((d) => !used.has(d)));
    if (!city) return;
    tourCities.push(city);
    query = { ...query, cities: [...tourCities] };
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
    // from / best: a random departure city, staying in the same mode.
    const origin = pickFrom(origins(), query.origin);
    if (!origin) return;
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

function showMap(hub: string, others: string[], info?: Map<string, MarkerInfo>): void {
  const m = ensureMap();
  m.setInfo(info ?? new Map());
  m.show(hub, [...new Set(others)]);
  requestAnimationFrame(() => m.invalidate());
}

function showRoute(stations: string[]): void {
  const m = ensureMap();
  m.setInfo(new Map());
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

// --- rail metrics -----------------------------------------------------------

// Distance from the document top to the results/map row (= navbar + search bar +
// margins). Published as a CSS var so the sticky map can size to the viewport
// minus that height, instead of a full 100vh that overflows under the bars.
let lastAboveH = -1;
function updateRailMetrics(): void {
  const layoutEl = rootRef.querySelector<HTMLElement>(".layout");
  if (!layoutEl) return;
  const top = Math.round(layoutEl.getBoundingClientRect().top + window.scrollY);
  if (top === lastAboveH) return;
  lastAboveH = top;
  rootRef.style.setProperty("--above-h", `${top}px`);
  requestAnimationFrame(() => map?.invalidate());
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
  refs.returnField.style.display = query.mode === "od" ? "" : "none";
  refs.regionField.style.display = query.mode === "best" ? "" : "none";
  refs.citiesField.style.display = query.mode === "tour" ? "" : "none";
  refs.stayField.style.display = query.mode === "tour" ? "" : "none";
}

function buildLayout(root: HTMLElement): void {
  clear(root);

  const meta = deps.meta;

  // header — "data updated" is now a compact relative-time pill on the right.
  // Real data → "il y a 3 h" (localized, relative); sample data → "données d'exemple".
  const hasReal = Boolean(meta.updatedAt) && !meta.isSample;
  const when = meta.updatedAt
    ? new Date(meta.updatedAt).toLocaleString(getLang(), {
        dateStyle: "medium",
        timeStyle: "short",
        hourCycle: "h23", // 24-hour clock — no AM/PM, the convention in France/Europe
      })
    : "";
  const pillText = hasReal ? relativeTime(meta.updatedAt, getLang()) : t("foot_sample");
  const pillLabel = when ? t("foot_updated", { date: when }) : t("foot_sample");
  const updatedPill = el(
    "div",
    {
      class: "updated-pill",
      attrs: { tabindex: "0", role: "note", title: `${pillLabel} — ${t("data_why")}`, "aria-label": pillLabel },
    },
    [
      el("span", {
        class: "icon",
        attrs: { "aria-hidden": "true" },
        html: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
      }),
      el("span", { text: pillText }),
      el("span", { class: "sr-only", text: t("data_why") }),
    ],
  );

  // Language selector — wrapped in a pill with a globe glyph (native <select> kept
  // for accessibility/keyboard, just dressed up).
  const langSel = el(
    "select",
    { class: "lang-select", attrs: { "aria-label": t("ctl_lang") } },
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

  // Install (Add to home screen) — revealed only when the browser offers it.
  const installBtn = el("button", {
    class: "ctl install-btn",
    type: "button",
    text: t("act_install"),
    attrs: { hidden: "" },
    on: { click: () => void promptInstall() },
  });
  installBtnEl = installBtn;

  // GitHub link with a star, to invite stars on the repo.
  const ghLink = el("a", {
    class: "ctl gh-link",
    html: `<span aria-hidden="true">★</span> GitHub`,
    href: GITHUB_URL,
    attrs: { target: "_blank", rel: "noopener noreferrer", "aria-label": "GitHub" },
  });

  const langCtl = el("div", { class: "lang-ctl" }, [
    el("span", {
      class: "lang-globe icon",
      attrs: { "aria-hidden": "true" },
      html: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.6 2.9 2.6 15.1 0 18M12 3c-2.6 2.9-2.6 15.1 0 18"/></svg>`,
    }),
    langSel,
  ]);

  const header = el("header", { class: "site-header" }, [
    el("div", { class: "brand" }, [
      el("button", {
        class: "logo",
        type: "button",
        attrs: { "aria-label": t("appName"), title: t("appName") },
        on: { click: goHome },
        html: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="14" rx="3.2"/><path d="M5 10.5h14"/><path d="M9 17l-2.2 3.3M15 17l2.2 3.3"/><circle cx="9" cy="13.6" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="13.6" r="1" fill="currentColor" stroke="none"/></svg>`,
      }),
      el("h1", { text: t("appName") }),
    ]),
    el("div", { class: "header-ctls" }, [updatedPill, langCtl, themeBtn, ghLink, installBtn]),
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
  // Results toolbar: a place filter + a sort dropdown. Persistent across result
  // repaints (so the filter box keeps focus while typing). Visibility/options are
  // configured per mode in configureToolbar().
  const searchBox = el("input", {
    class: "input results-search",
    type: "search",
    attrs: { "aria-label": t("results_filter"), placeholder: t("results_filter"), autocomplete: "off" },
  }) as HTMLInputElement;
  searchBox.addEventListener("input", () => {
    resultsQuery = searchBox.value;
    resultsShown = RESULTS_PAGE;
    repaintResults();
  });
  const sortSel = el("select", { class: "input results-sort", attrs: { "aria-label": t("results_sort") } }) as HTMLSelectElement;
  sortSel.addEventListener("change", () => {
    resultsSort = sortSel.value as SortKey;
    resultsShown = RESULTS_PAGE;
    repaintResults();
  });
  // List ⇄ Map view switch.
  const viewToggle = el("div", { class: "view-toggle", attrs: { role: "group", "aria-label": t("view_label") } }, [
    viewBtn(
      "list",
      t("view_list"),
      `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>`,
    ),
    viewBtn(
      "map",
      t("view_map"),
      `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4 3.5 6v14l5.5-2 6 2 5.5-2V4l-5.5 2-6-2z"/><path d="M9 4v14M15 6v14"/></svg>`,
    ),
  ]);

  const resultsTools = el("div", { class: "results-tools" }, [
    el("div", { class: "results-search-wrap" }, [
      el("span", {
        class: "icon",
        attrs: { "aria-hidden": "true" },
        html: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`,
      }),
      searchBox,
    ]),
    sortSel,
    viewToggle,
  ]);

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
    el("h3", { class: "sr-only", text: t("map_title") }),
    mapEl,
  ]);
  // Search bar spans the full row on top; below it, results (left) sit beside a
  // sticky panel (map on top, favourites under it) that stays in view while the
  // list scrolls.
  const layout = el("div", { class: "layout" }, [
    el("div", { class: "main-col" }, [title, resultsTools, results]),
    el("div", { class: "side-col" }, [mapSection, aside]),
  ]);

  root.append(header, built.form, layout, footer);
  root.dataset.view = settings.view;

  refs = {
    ...built.refs,
    title,
    resultsTools,
    searchBox,
    sortSel,
    viewToggle,
    results,
    mapEl,
    favList,
  };
  map = null;
  updateViewToggle();
  renderFavorites();
  refreshInstallBtn();
}

/** A single segment of the List ⇄ Map view switch. */
function viewBtn(view: store.ViewMode, label: string, iconHtml: string): HTMLElement {
  const btn = el("button", {
    class: "view-btn",
    type: "button",
    dataset: { view },
    attrs: { "aria-label": label, title: label },
    html: iconHtml,
    on: { click: () => setView(view) },
  });
  return btn;
}

/** Reflect the current view on the toggle's pressed state. */
function updateViewToggle(): void {
  for (const btn of Array.from(refs.viewToggle.children)) {
    const active = (btn as HTMLElement).dataset.view === settings.view;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  }
}

/** Switch between the list layout and the map-first canvas (persisted). */
function setView(view: store.ViewMode): void {
  if (settings.view === view) return;
  settings = { ...settings, view };
  store.saveSettings(settings);
  rootRef.dataset.view = view;
  updateViewToggle();
  // The map container changed size — let Leaflet recompute over two frames so the
  // new layout has settled before invalidateSize/refit.
  requestAnimationFrame(() => requestAnimationFrame(() => map?.invalidate()));
}

interface FormBuild {
  form: HTMLElement;
  refs: Omit<
    Refs,
    "title" | "resultsTools" | "searchBox" | "sortSel" | "viewToggle" | "results" | "mapEl" | "favList"
  >;
}

function buildForm(): FormBuild {
  const stationList = el("datalist", { id: "station-list" });
  for (const s of deps.registry.list()) stationList.append(el("option", { value: s.label }));

  const modeTabs = el("div", { class: "mode-tabs", attrs: { role: "group", "aria-label": t("appName") } });
  for (const m of ["from", "to", "od", "best", "tour"] as const) {
    const btn = el("button", {
      class: "mode-tab",
      type: "button",
      text: t(`mode_${m}` as const),
      dataset: { mode: m },
      on: {
        click: () => {
          navStack = []; // switching mode starts a new history
          query = { ...readQueryFromForm(), mode: m };
          syncFormFromQuery();
          applyAndRun();
        },
      },
    });
    modeTabs.append(btn);
  }
  const modeDesc = el("p", { class: "mode-desc" });

  const origin = inputEl("text", "station-list");
  const destination = inputEl("text", "station-list");
  const via = inputEl("text", "station-list");
  const date = inputEl("date");
  const returnDate = inputEl("date");
  // Constrain dates to exactly the window the 30-day calendar renders.
  const windowDates = dateRange(today, BOOKING_WINDOW_DAYS);
  const lastBookable = windowDates[windowDates.length - 1] ?? today;
  date.min = today;
  date.max = lastBookable;
  returnDate.min = today;
  returnDate.max = lastBookable;
  const departAfter = inputEl("time");
  const departBefore = inputEl("time");
  const maxDuration = inputEl("number");
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
  const regionList = [
    ...new Set(deps.registry.all().map((s) => s.region).filter((r): r is string => Boolean(r))),
  ].sort();
  const region = el("select", { class: "input" }, [
    optionEl("", t("region_any"), true),
    ...regionList.map((r) => optionEl(r, r, false)),
  ]) as HTMLSelectElement;
  // MAX subscription type — now a segment in the search bar (no longer in the
  // header). Still a global preference: the form's live `change` handler persists
  // it and refreshes the MAX SENIOR weekend notice.
  const card = el("select", { class: "input", attrs: { "aria-label": t("field_card") } }, [
    optionEl("jeune", t("card_jeune"), settings.card === "jeune"),
    optionEl("senior", t("card_senior"), settings.card === "senior"),
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

  const originField = field(t("field_origin"), origin);
  const destinationField = field(t("field_destination"), destination);
  const viaField = field(t("field_via"), via);
  const returnField = field(t("field_return"), returnDate);
  const regionField = field(t("field_region"), region);
  const citiesField = field(t("field_cities"), citiesBox);
  const dateField = field(t("field_date"), date);
  const cardField = field(t("field_card"), card);
  // Minimum days spent in each city before the next hop — turns a tour into a
  // multi-day, free-MAX vacation plan. Default 1 (a hop a day).
  const stayDays = inputEl("number");
  stayDays.min = "1";
  stayDays.max = "14";
  stayDays.placeholder = "1";
  const stayField = field(t("field_stay"), stayDays);

  // Advanced filters + the less-common per-mode fields (via / return / days-per-
  // city) live in a popover anchored under the "Filtres" button, so the search bar
  // stays a single thin row. Native HTML popover: top-layer, Esc/outside dismiss.
  const filtersPop = el(
    "div",
    { class: "filters-pop", id: "mf-filters-pop", attrs: { popover: "auto" } },
    [
      el("div", { class: "advanced-grid" }, [
        field(t("field_departAfter"), departAfter),
        field(t("field_departBefore"), departBefore),
        field(t("field_maxDuration"), maxDuration),
        field(t("field_trainType"), trainType),
        field(t("field_connections"), maxConnections),
        overnightField,
        viaField,
        returnField,
        stayField,
      ]),
    ],
  );
  const filtersBtn = el("button", {
    class: "btn btn-ghost filters-btn",
    type: "button",
    attrs: { "aria-haspopup": "dialog", popovertarget: "mf-filters-pop" },
    html: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h14M5 17h14"/><circle cx="9" cy="7" r="2.3" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="2.3" fill="currentColor" stroke="none"/></svg>`,
  });
  filtersBtn.append(el("span", { class: "filters-btn-label", text: t("field_advanced") }));
  // Place the (top-layer) popover directly under its button with JS — CSS anchor
  // positioning isn't reliable across browsers (it was landing on the far left).
  // Pin it on scroll/resize while open and tear those listeners down on close.
  let repositionFilters: (() => void) | null = null;
  filtersPop.addEventListener("toggle", (e) => {
    const open = (e as { newState?: string }).newState === "open";
    if (open) {
      const place = (): void => placePopover(filtersBtn, filtersPop);
      place();
      repositionFilters = place;
      window.addEventListener("resize", place);
      window.addEventListener("scroll", place, true);
    } else if (repositionFilters) {
      window.removeEventListener("resize", repositionFilters);
      window.removeEventListener("scroll", repositionFilters, true);
      repositionFilters = null;
    }
  });

  const searchBtn = el("button", { class: "btn btn-primary", type: "submit", text: t("btn_search") });
  // A discreet, playful shortcut to a random city.
  const surpriseBtn = el("button", {
    class: "btn btn-ghost surprise-btn",
    type: "button",
    text: t("act_surprise"),
    on: { click: surpriseMe },
  });

  // The Airbnb-style search pill: mode-relevant fields as inline segments, with
  // the filters button + search + surprise grouped on the right.
  const searchBar = el("div", { class: "search-bar" }, [
    originField,
    destinationField,
    regionField,
    citiesField,
    dateField,
    cardField,
    el("div", { class: "search-bar-actions" }, [filtersBtn, searchBtn, surpriseBtn]),
  ]);

  // "How does it work?" — a large hover/focus card on the right of the tabs row
  // (replaces the old click-to-expand section that sat under the form).
  const howCard = el("div", { class: "how-card", attrs: { role: "note" } }, [
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
  const howTrigger = el("button", {
    class: "how-trigger",
    type: "button",
    attrs: { "aria-expanded": "false" },
    html: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>`,
  });
  howTrigger.append(el("span", { class: "how-trigger-label", text: t("how_title") }));
  const howWrap = el("div", { class: "how-card-wrap" }, [howTrigger, howCard]);
  // Touch has no hover — tapping the trigger toggles the card open.
  howTrigger.addEventListener("click", () => {
    const open = howWrap.classList.toggle("open");
    howTrigger.setAttribute("aria-expanded", String(open));
  });
  const tabsRow = el("div", { class: "tabs-row" }, [modeTabs, howWrap]);

  const form = el("form", { class: "search-form" }, [
    tabsRow,
    searchBar,
    modeDesc,
    filtersPop,
    stationList,
  ]);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    navStack = []; // a fresh search starts a new history
    query = readQueryFromForm();
    applyAndRun();
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
      card,
      date,
      returnDate,
      departAfter,
      departBefore,
      maxDuration,
      trainType,
      maxConnections,
      overnight,
      via,
      originField,
      destinationField,
      viaField,
      returnField,
      region,
      regionField,
      cities,
      citiesField,
      cityChips,
      stayDays,
      stayField,
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
          },
        },
      }),
    ]);
    refs.cityChips.append(chip);
  });
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

/** Pin a top-layer popover directly under (right-aligned to) an anchor button. */
function placePopover(anchor: HTMLElement, pop: HTMLElement): void {
  const r = anchor.getBoundingClientRect();
  const gap = 6;
  const margin = 8;
  pop.style.position = "fixed";
  pop.style.margin = "0";
  pop.style.right = "auto";
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  // Right-align to the button, clamped into the viewport.
  const left = Math.max(margin, Math.min(r.right - w, window.innerWidth - w - margin));
  // Below the button; flip above if there isn't room below.
  let top = r.bottom + gap;
  if (top + h > window.innerHeight - margin) top = Math.max(margin, r.top - gap - h);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
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
