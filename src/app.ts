import type { Dataset } from "./data/dataset";
import { StationRegistry } from "./data/stations";
import type { SearchQuery, MaxTrain, Journey } from "./types";
import { reachableDestinations, reachableOrigins } from "./core/destinations";
import { bestTrips, stationsOnDate } from "./core/best";
import { planTours } from "./core/tour";
import { findJourneys } from "./core/connections";
import { availabilityCalendar, dateRange } from "./core/calendar";
import { findRoundTrips } from "./core/roundtrip";
import { el, clear } from "./ui/dom";
import { RouteMap } from "./ui/map";
import * as render from "./ui/render";
import type { RenderCtx } from "./ui/render";
import { journeyToIcs, downloadText } from "./ui/ics";
import { t, setLang, getLang } from "./i18n";
import * as store from "./state/store";
import { SNCF_CONNECT_URL, MAX_JEUNE_URL, MAX_SENIOR_URL } from "./config";
import { notify } from "./pwa/register";

interface Deps {
  trains: MaxTrain[];
  meta: Dataset["meta"];
  registry: StationRegistry;
}

interface Refs {
  modeTabs: HTMLElement;
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

export function initApp(root: HTMLElement, dataset: Dataset, registry: StationRegistry): void {
  deps = { trains: dataset.trains, meta: dataset.meta, registry };
  rootRef = root;
  settings = store.loadSettings();
  applyTheme(settings.theme);
  setLang(settings.lang);
  // Every station present in the dataset becomes searchable (the curated registry
  // only covers map coordinates for the major ones).
  registry.addMissing(dataset.trains.flatMap((t) => [t.origin, t.destination]));
  labelToId = new Map(registry.all().map((s) => [s.label.toLowerCase(), s.id]));

  const today = new Date().toISOString().slice(0, 10);
  query = store.urlHasQuery()
    ? store.queryFromParams(new URLSearchParams(location.search), today)
    : { mode: "from", date: today, card: settings.card, maxConnections: 1 };

  rebuild();
  checkWatchedRoutes();
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

function ctx(): RenderCtx {
  return {
    label: (id) => deps.registry.label(id),
    formatDate,
    bookUrl: () => SNCF_CONNECT_URL,
    onOpenRoute: (origin, destination) => {
      query = { ...query, mode: "od", origin, destination };
      syncFormFromQuery();
      applyAndRun();
      refs.title.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    onFocusStation: (id) => map?.focus(id),
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
  refs.origin.value = query.origin ? deps.registry.label(query.origin) : "";
  refs.destination.value = query.destination ? deps.registry.label(query.destination) : "";
  refs.date.value = query.date;
  refs.card.value = query.card;
  refs.departAfter.value = query.departAfter ?? "";
  refs.departBefore.value = query.departBefore ?? "";
  refs.maxDuration.value = query.maxDurationMin != null ? String(query.maxDurationMin) : "";
  refs.trainType.value = query.trainType ?? "";
  refs.maxConnections.value = String(query.maxConnections);
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
  requestAnimationFrame(() => {
    clear(refs.results);
    renderSearch();
  });
}

function renderSearch(): void {
  const c = ctx();
  const { trains, registry } = deps;

  // MAX SENIOR free tickets are weekday-only — flag a weekend date.
  if (query.card === "senior" && isWeekend(query.date)) {
    refs.results.append(el("p", { class: "notice", text: t("senior_weekend_warn") }));
  }

  if (query.mode === "from") {
    if (!query.origin) return showHint(refs.origin);
    const groups = reachableDestinations(trains, query.origin, query.date, filterOpts());
    refs.title.textContent = t("res_from_title", {
      station: registry.label(query.origin),
      date: formatDate(query.date),
    });
    if (groups.length === 0) {
      refs.results.append(render.emptyEl(t("res_none")));
    } else {
      refs.results.append(
        el("p", { class: "muted count", text: t("res_destinations", { n: groups.length }) }),
      );
      for (const g of groups) refs.results.append(render.groupCardEl(g, "from", query.origin, c));
    }
    showMap(query.origin, groups.map((g) => g.station));
  } else if (query.mode === "to") {
    if (!query.destination) return showHint(refs.destination);
    const groups = reachableOrigins(trains, query.destination, query.date, filterOpts());
    refs.title.textContent = t("res_to_title", {
      station: registry.label(query.destination),
      date: formatDate(query.date),
    });
    if (groups.length === 0) {
      refs.results.append(render.emptyEl(t("res_none")));
    } else {
      refs.results.append(
        el("p", { class: "muted count", text: t("res_origins", { n: groups.length }) }),
      );
      for (const g of groups) refs.results.append(render.groupCardEl(g, "to", query.destination, c));
    }
    showMap(query.destination, groups.map((g) => g.station));
  } else if (query.mode === "best") {
    runBestSearch(c);
  } else if (query.mode === "tour") {
    runTourSearch(c);
  } else {
    runOdSearch(c);
  }
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
  const journeys: Journey[] = findJourneys(trains, query.origin, query.destination, query.date, {
    ...filterOpts(),
    maxConnections: query.maxConnections,
  });
  if (journeys.length === 0) refs.results.append(render.emptyEl(t("res_none")));
  else for (const j of journeys) refs.results.append(render.journeyEl(j, c));

  // 30-day availability calendar (connection-aware, matching the journeys above)
  const cal = availabilityCalendar(trains, query.origin, query.destination, dateRange(query.date, 30), {
    ...filterOpts(),
    maxConnections: query.maxConnections,
  });
  refs.results.append(render.calendarEl(cal, c));

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

  showMap(query.origin, [query.destination, ...journeys.flatMap((j) => (j.hub ? [j.hub] : []))]);
}

function showHint(input: HTMLInputElement): void {
  refs.title.textContent = t("prompt_pick");
  input.focus();
}

function showMap(hub: string, others: string[]): void {
  if (!map) map = new RouteMap(refs.mapEl, deps.registry);
  map.show(hub, [...new Set(others)]);
  requestAnimationFrame(() => map?.invalidate());
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
  const langSel = el("select", { class: "ctl", attrs: { "aria-label": t("ctl_lang") } }, [
    optionEl("fr", "FR", settings.lang === "fr"),
    optionEl("en", "EN", settings.lang === "en"),
  ]) as HTMLSelectElement;
  langSel.addEventListener("change", () => {
    settings = { ...settings, lang: langSel.value === "en" ? "en" : "fr" };
    setLang(settings.lang);
    store.saveSettings(settings);
    rebuild();
  });

  const themeSel = el("select", { class: "ctl", attrs: { "aria-label": t("ctl_theme") } }, [
    optionEl("auto", "🌓", settings.theme === "auto"),
    optionEl("light", "☀️", settings.theme === "light"),
    optionEl("dark", "🌙", settings.theme === "dark"),
  ]) as HTMLSelectElement;
  themeSel.addEventListener("change", () => {
    settings = { ...settings, theme: themeSel.value as store.Theme };
    applyTheme(settings.theme);
    store.saveSettings(settings);
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
        el("p", { class: "updated", text: updated }),
      ]),
    ]),
    el("div", { class: "header-ctls" }, [langSel, themeSel]),
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
    el("p", { class: "muted small" }, [
      el("a", {
        text: "GitHub",
        href: "https://github.com/davd-gzl/MAX-Finder",
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
  };
  map = null;
  renderFavorites();
}

interface FormBuild {
  form: HTMLElement;
  refs: Omit<Refs, "title" | "results" | "mapEl" | "favList">;
}

function buildForm(): FormBuild {
  const stationList = el("datalist", { id: "station-list" });
  for (const s of deps.registry.all()) stationList.append(el("option", { value: s.label }));

  const modeTabs = el("div", { class: "mode-tabs", attrs: { role: "group", "aria-label": t("appName") } });
  for (const m of ["from", "to", "od", "best", "tour"] as const) {
    const btn = el("button", {
      class: "mode-tab",
      type: "button",
      text: t(`mode_${m}` as const),
      dataset: { mode: m },
      on: {
        click: () => {
          query = { ...readQueryFromForm(), mode: m };
          syncFormFromQuery();
          applyAndRun();
        },
      },
    });
    modeTabs.append(btn);
  }

  const origin = inputEl("text", "station-list");
  const destination = inputEl("text", "station-list");
  const date = inputEl("date");
  const returnDate = inputEl("date");
  const card = el("select", { class: "input" }, [
    optionEl("jeune", t("card_jeune"), settings.card === "jeune"),
    optionEl("senior", t("card_senior"), settings.card === "senior"),
  ]) as HTMLSelectElement;
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
  ]) as HTMLSelectElement;
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
    el("div", { class: "fields" }, [
      originField,
      destinationField,
      field(t("field_date"), date),
      returnField,
      field(t("field_card"), card),
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
    query = readQueryFromForm();
    applyAndRun();
  });

  return {
    form,
    refs: {
      modeTabs,
      origin,
      destination,
      date,
      returnDate,
      card,
      departAfter,
      departBefore,
      maxDuration,
      trainType,
      maxConnections,
      destinationField,
      returnField,
      region,
      regionField,
      cities,
      citiesField,
    },
  };
}

function renderFavorites(): void {
  clear(refs.favList);
  const favs = store.loadFavorites();
  if (favs.length === 0) {
    refs.favList.append(el("p", { class: "muted small", text: t("fav_none") }));
    return;
  }
  for (const f of favs) {
    const row = el("div", { class: "fav-row" }, [
      el("button", {
        class: "fav-open",
        type: "button",
        text: `${deps.registry.label(f.origin)} → ${deps.registry.label(f.destination)}`,
        on: { click: () => ctx().onOpenRoute(f.origin, f.destination) },
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
