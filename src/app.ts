import type { Dataset } from "./data/dataset";
import { StationRegistry } from "./data/stations";
import type { SearchQuery, MaxTrain, Journey } from "./types";
import { reachableDestinations, reachableOrigins } from "./core/destinations";
import { bestTrips, stationsOnDate, reachableBest } from "./core/best";
import { planTours } from "./core/tour";
import { findJourneys } from "./core/connections";
import { availabilityCalendar, dateRange } from "./core/calendar";
import { findRoundTrips } from "./core/roundtrip";
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
  originField: HTMLElement;
  destinationField: HTMLElement;
  returnField: HTMLElement;
  region: HTMLSelectElement;
  regionField: HTMLElement;
  cities: HTMLInputElement;
  citiesField: HTMLElement;
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

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e as InstallPromptEvent;
    refreshInstallBtn();
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    refreshInstallBtn();
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
      refs.title.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    onFocusStation: (id) => map?.focus(id),
    onShowJourney: (j) => {
      showRoute([j.origin, ...j.hubs, j.destination]);
      refs.mapEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
    onSelectDay: (date) => {
      query = { ...query, date };
      syncFormFromQuery();
      applyAndRun();
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
  refs.date.value = query.date;
  refs.card.value = query.card;
  refs.departAfter.value = query.departAfter ?? "";
  refs.departBefore.value = query.departBefore ?? "";
  refs.maxDuration.value = query.maxDurationMin != null ? String(query.maxDurationMin) : "";
  refs.trainType.value = query.trainType ?? "";
  refs.maxConnections.value = String(query.maxConnections);
  refs.overnight.checked = Boolean(query.overnight);
  refs.region.value = query.region ?? "";
  refs.cities.value = (query.cities ?? []).map((id) => deps.registry.label(id)).join(", ");
  updateFieldVisibility();
}

function readQueryFromForm(): SearchQuery {
  const maxDur = Number(refs.maxDuration.value.trim());
  return {
    mode: query.mode,
    origin: resolveStation(refs.origin.value),
    destination: resolveStation(refs.destination.value),
    date: refs.date.value || query.date,
    card: refs.card.value === "senior" ? "senior" : "jeune",
    departAfter: refs.departAfter.value || undefined,
    departBefore: refs.departBefore.value || undefined,
    maxDurationMin: Number.isFinite(maxDur) && maxDur > 0 ? maxDur : undefined,
    trainType: refs.trainType.value || undefined,
    maxConnections: Number(refs.maxConnections.value),
    overnight: refs.overnight.checked || undefined,
    region: refs.region.value || undefined,
    cities:
      query.mode === "tour"
        ? refs.cities.value
            .split(",")
            .map((s) => resolveStation(s))
            .filter((s): s is string => Boolean(s))
        : query.cities,
  };
}

function applyAndRun(): void {
  store.updateUrl(query);
  settings = { ...settings, card: query.card };
  store.saveSettings(settings);
  runSearch();
  // Move focus to the results heading so screen-reader users hear the new context.
  refs.title.focus();
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

  const groups =
    dir === "from"
      ? reachableDestinations(trains, anchor, query.date, filterOpts())
      : reachableOrigins(trains, anchor, query.date, filterOpts());
  const directStations = new Set(groups.map((g) => g.station));

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
    refs.results.append(render.emptyEl(t("res_none")));
    showMap(anchor, []);
    return;
  }
  refs.results.append(el("p", { class: "muted count", text: t(countKey, { n: total }) }));
  for (const g of groups) refs.results.append(render.groupCardEl(g, dir, anchor, c));
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
  const tours = planTours(trains, query.origin, cities, query.date, {
    maxConnections: query.maxConnections,
  });
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
  let trips = bestTrips(trains, query.origin, query.date, stationsOnDate(trains, query.date), {
    ...filterOpts(),
    maxConnections: query.maxConnections,
  });
  if (query.region) {
    trips = trips.filter((tr) => registry.get(tr.destination)?.region === query.region);
  }
  if (trips.length === 0) {
    refs.results.append(render.emptyEl(t("res_none")));
    return;
  }
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
  refs.title.textContent = t("res_od_title", {
    origin: registry.label(query.origin),
    destination: registry.label(query.destination),
    date: formatDate(query.date),
  });
  refs.results.append(el("p", { class: "od-guide" }, [render.guideLinkEl(c, query.destination)]));

  // 30-day availability calendar, anchored to today's bookable window (not the
  // selected date) so clicking a day doesn't shift the strip. The chosen date is
  // highlighted in place.
  const cal = availabilityCalendar(
    trains,
    query.origin,
    query.destination,
    dateRange(today, BOOKING_WINDOW_DAYS),
    { ...filterOpts(), maxConnections: query.maxConnections },
  );
  refs.results.append(render.calendarEl(cal, c, query.date));

  const journeys: Journey[] = findJourneys(trains, query.origin, query.destination, query.date, {
    ...filterOpts(),
    maxConnections: query.maxConnections,
  });
  if (journeys.length === 0) refs.results.append(render.emptyEl(t("res_none")));
  else for (const j of journeys) refs.results.append(render.journeyEl(j, c));

  // optional round trips
  const ret = refs.returnDate.value;
  if (ret) {
    const trips = findRoundTrips(trains, query.origin, query.destination, query.date, ret, {
      ...filterOpts(),
      maxConnections: query.maxConnections,
    });
    const section = el("section", { class: "roundtrips" }, [el("h3", { text: t("rt_title") })]);
    if (trips.length === 0) section.append(render.emptyEl(t("rt_none")));
    else for (const rt of trips.slice(0, 20)) section.append(render.roundTripEl(rt, c));
    refs.results.append(section);
  }

  // Draw the most relevant journey as an ordered path (origin → via → destination),
  // so a correspondence shows up as a secondary point on the line.
  const display = journeys.length
    ? journeys.reduce((a, b) => (b.totalDurationMin < a.totalDurationMin ? b : a))
    : null;
  showRoute(display ? [display.origin, ...display.hubs, display.destination] : [query.origin, query.destination]);
}

function showHint(input: HTMLInputElement): void {
  // Empty state: no nagging prompt — just a blank heading and a ready cursor.
  refs.title.textContent = "";
  input.focus({ preventScroll: true });
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
  refs.returnField.style.display = query.mode === "od" ? "" : "none";
  refs.regionField.style.display = query.mode === "best" ? "" : "none";
  refs.citiesField.style.display = query.mode === "tour" ? "" : "none";
}

function buildLayout(root: HTMLElement): void {
  clear(root);

  const meta = deps.meta;
  const when = meta.updatedAt
    ? new Date(meta.updatedAt).toLocaleString(getLang(), { dateStyle: "medium", timeStyle: "short" })
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

  const header = el("header", { class: "site-header" }, [
    el("div", { class: "brand" }, [
      el("span", {
        class: "logo",
        attrs: { "aria-hidden": "true" },
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
    el("div", { class: "header-ctls" }, [ghLink, cardSel, langSel, themeBtn, installBtn]),
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
  refreshInstallBtn();
}

interface FormBuild {
  form: HTMLElement;
  refs: Omit<Refs, "title" | "results" | "mapEl" | "favList" | "card">;
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
  const cities = inputEl("text");
  cities.placeholder = t("field_cities_ph");

  const originField = field(t("field_origin"), origin);
  const destinationField = field(t("field_destination"), destination);
  const returnField = field(t("field_return"), returnDate);
  const regionField = field(t("field_region"), region);
  const citiesField = field(t("field_cities"), cities);

  const advanced = el("details", { class: "advanced" }, [
    el("summary", { text: t("field_advanced") }),
    el("div", { class: "advanced-grid" }, [
      field(t("field_departAfter"), departAfter),
      field(t("field_departBefore"), departBefore),
      field(t("field_maxDuration"), maxDuration),
      field(t("field_trainType"), trainType),
      field(t("field_connections"), maxConnections),
      overnightField,
    ]),
  ]);

  const searchBtn = el("button", { class: "btn btn-primary", type: "submit", text: t("btn_search") });

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
      field(t("field_date"), date),
      returnField,
      regionField,
      citiesField,
    ]),
    advanced,
    el("div", { class: "form-actions" }, [searchBtn]),
    howto,
    stationList,
  ]);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    navStack = []; // a fresh search starts a new history
    query = readQueryFromForm();
    applyAndRun();
  });

  return {
    form,
    refs: {
      modeTabs,
      modeDesc,
      origin,
      destination,
      date,
      returnDate,
      departAfter,
      departBefore,
      maxDuration,
      trainType,
      maxConnections,
      overnight,
      originField,
      destinationField,
      returnField,
      region,
      regionField,
      cities,
      citiesField,
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
  refs.origin.focus({ preventScroll: true });
  refs.modeTabs.scrollIntoView({ behavior: "smooth", block: "start" });
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
