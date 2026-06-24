import type { Dataset } from "./data/dataset";
import { StationRegistry } from "./data/stations";
import type { SearchQuery, MaxTrain, Journey } from "./types";
import { reachableDestinations, reachableOrigins } from "./core/destinations";
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
import { SNCF_CONNECT_URL } from "./config";
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
  allowConnections: HTMLInputElement;
  destinationField: HTMLElement;
  returnField: HTMLElement;
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
  labelToId = new Map(registry.all().map((s) => [s.label.toLowerCase(), s.id]));

  const today = new Date().toISOString().slice(0, 10);
  query = store.urlHasQuery()
    ? store.queryFromParams(new URLSearchParams(location.search), today)
    : { mode: "from", date: today, card: settings.card, allowConnections: true };

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
  refs.allowConnections.checked = query.allowConnections;
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
    allowConnections: refs.allowConnections.checked,
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
  const c = ctx();
  const { trains, registry } = deps;

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
  } else {
    runOdSearch(c);
  }
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
    hubs: query.allowConnections ? undefined : [],
  });
  if (journeys.length === 0) refs.results.append(render.emptyEl(t("res_none")));
  else for (const j of journeys) refs.results.append(render.journeyEl(j, c));

  // 30-day availability calendar
  const cal = availabilityCalendar(
    trains,
    query.origin,
    query.destination,
    dateRange(query.date, 30),
  );
  refs.results.append(render.calendarEl(cal, c));

  // optional round trips
  const ret = refs.returnDate.value;
  if (ret) {
    const trips = findRoundTrips(trains, query.origin, query.destination, query.date, ret, {
      ...filterOpts(),
      hubs: query.allowConnections ? undefined : [],
    });
    const section = el("section", { class: "roundtrips" }, [el("h3", { text: t("rt_title") })]);
    if (trips.length === 0) section.append(render.emptyEl(t("rt_none")));
    else for (const rt of trips.slice(0, 20)) section.append(render.roundTripEl(rt, c));
    refs.results.append(section);
  }

  showMap(query.origin, [query.destination, ...journeys.flatMap((j) => (j.hub ? [j.hub] : []))]);
}

function showHint(input: HTMLInputElement): void {
  refs.title.textContent = t("tagline");
  input.focus();
}

function showMap(hub: string, others: string[]): void {
  if (!map) map = new RouteMap(refs.mapEl, deps.registry);
  map.show(hub, [...new Set(others)]);
  requestAnimationFrame(() => map?.invalidate());
}

// --- surprise & watched -----------------------------------------------------

function surprise(): void {
  const origin = resolveStation(refs.origin.value) ?? "PARIS (intramuros)";
  const groups = reachableDestinations(deps.trains, origin, refs.date.value || query.date);
  if (groups.length === 0) {
    refs.title.textContent = t("surprise_none");
    return;
  }
  const pick = groups[Math.floor(Math.random() * groups.length)]!;
  query = { ...query, mode: "od", origin, destination: pick.station };
  syncFormFromQuery();
  applyAndRun();
}

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
}

function buildLayout(root: HTMLElement): void {
  clear(root);

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
      el("span", { class: "logo", attrs: { "aria-hidden": "true" }, text: "🚆" }),
      el("div", {}, [
        el("h1", { text: t("appName") }),
        el("p", { class: "tagline", text: t("tagline") }),
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

  const meta = deps.meta;
  const updated =
    meta.isSample || !meta.updatedAt
      ? t("foot_sample")
      : t("foot_updated", { date: new Date(meta.updatedAt).toLocaleString(getLang()) });
  const footer = el("footer", { class: "site-footer" }, [
    el("p", { text: updated }),
    el("p", { class: "muted", text: t("foot_source") }),
    el("p", { class: "muted small", text: t("foot_disclaimer") }),
    el("p", { class: "muted small" }, [
      el("a", {
        text: "GitHub",
        href: "https://github.com/davd-gzl/foss-maxjeune",
        attrs: { target: "_blank", rel: "noopener noreferrer" },
      }),
    ]),
  ]);

  const layout = el("div", { class: "layout" }, [
    el("div", { class: "main-col" }, [built.form, title, results, el("section", { class: "map-section" }, [el("h3", { text: t("map_title") }), mapEl])]),
    aside,
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
  for (const m of ["from", "to", "od"] as const) {
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
  const allowConnections = el("input", { type: "checkbox" }) as HTMLInputElement;
  allowConnections.checked = true;

  const originField = field(t("field_origin"), origin);
  const destinationField = field(t("field_destination"), destination);
  const returnField = field(t("field_return"), returnDate);

  const advanced = el("details", { class: "advanced" }, [
    el("summary", { text: t("field_advanced") }),
    el("div", { class: "advanced-grid" }, [
      field(t("field_departAfter"), departAfter),
      field(t("field_departBefore"), departBefore),
      field(t("field_maxDuration"), maxDuration),
      field(t("field_trainType"), trainType),
      el("label", { class: "check" }, [allowConnections, el("span", { text: t("field_allowConnections") })]),
    ]),
  ]);

  const searchBtn = el("button", { class: "btn btn-primary", type: "submit", text: t("btn_search") });
  const surpriseBtn = el("button", {
    class: "btn btn-ghost",
    type: "button",
    text: t("btn_surprise"),
    on: { click: surprise },
  });

  const form = el("form", { class: "search-form" }, [
    modeTabs,
    el("div", { class: "fields" }, [
      originField,
      destinationField,
      field(t("field_date"), date),
      returnField,
      field(t("field_card"), card),
    ]),
    advanced,
    el("div", { class: "form-actions" }, [searchBtn, surpriseBtn]),
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
      allowConnections,
      destinationField,
      returnField,
    },
  };
}

function renderFavorites(): void {
  clear(refs.favList);
  const favs = store.loadFavorites();
  if (favs.length === 0) {
    refs.favList.append(render.emptyEl(t("fav_none")));
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
