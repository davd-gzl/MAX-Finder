import type { MaxTrain, Journey, SearchMode, CalendarDay } from "../types";
import type { StationGroup, WindowStat } from "../core/destinations";
import type { BestTrip } from "../core/best";
import type { Tour } from "../core/tour";
import type { RoundTrip } from "../types";
import type { RoutePair } from "../state/store";
import { el } from "./dom";
import { formatDuration, dayIndex } from "../util/time";
import { t } from "../i18n";

export interface RenderCtx {
  label: (id: string) => string;
  formatDate: (iso: string) => string;
  /** Narrow localized weekday name (e.g. "Sat"). */
  formatWeekday: (iso: string) => string;
  bookUrl: (origin: string, destination: string, date: string, time?: string) => string;
  /** External travel-guide (Wikivoyage) URL for a station's city. */
  cityInfoUrl: (id: string) => string;
  onOpenRoute: (origin: string, destination: string) => void;
  onFocusStation: (id: string) => void;
  /** Draw a specific journey (origin → interchanges → destination) on the map. */
  onShowJourney: (journey: Journey) => void;
  /** Draw a whole multi-city tour (every stop) on the map. */
  onShowTour: (tour: Tour) => void;
  /** Straight-line km between two stations (Infinity if either is unplotted). */
  distanceKm: (a: string, b: string) => number;
  onSelectDay: (date: string) => void;
  onIcs: (journey: Journey) => void;
  isFavorite: (route: RoutePair) => boolean;
  onToggleFavorite: (route: RoutePair) => void;
}

function icon(path: string): HTMLElement {
  return el("span", {
    class: "icon",
    attrs: { "aria-hidden": "true" },
    html: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`,
  });
}

const I = {
  train: '<rect x="4" y="3" width="16" height="13" rx="2"/><path d="M4 11h16M8 16l-2 4M16 16l2 4M8.5 8h.01M15.5 8h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cal: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
  star: '<path d="M12 2l3 6.5 7 .6-5.3 4.6 1.6 6.9L12 17.3 5.7 20.6l1.6-6.9L2 9.1l7-.6z"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M19 13v6H5V5h6"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  pin: '<path d="M12 21s-6-5.2-6-10a6 6 0 0 1 12 0c0 4.8-6 10-6 10z"/><circle cx="12" cy="11" r="2.2"/>',
};

/** One train as a compact row. (Every shown train is MAX-reservable by definition.) */
export function trainRowEl(train: MaxTrain): HTMLElement {
  const time = el("span", { class: "train-time" }, [
    el("strong", { text: train.depart }),
    icon(I.arrow),
    el("strong", { text: train.arrive }),
  ]);
  const meta = el("span", { class: "train-meta" }, [
    icon(I.clock),
    el("bdi", { text: formatDuration(train.durationMin) }),
    el("span", { class: "train-no", text: t("lbl_train", { no: train.trainNo }) }),
    ...(train.axe ? [el("span", { class: "train-axe", text: train.axe })] : []),
  ]);
  return el("div", { class: "train-row" }, [time, meta]);
}

function bookLink(
  ctx: RenderCtx,
  origin: string,
  destination: string,
  date: string,
  time?: string,
): HTMLElement {
  return el(
    "a",
    {
      class: "btn btn-book",
      href: ctx.bookUrl(origin, destination, date, time),
      attrs: { target: "_blank", rel: "noopener noreferrer" },
    },
    [
      el("span", { text: t("act_book") }),
      icon(I.external),
      el("span", { class: "sr-only", text: t("link_newtab") }),
    ],
  );
}

/** External travel-guide (Wikivoyage) link for a station's city. */
export function guideLinkEl(ctx: RenderCtx, stationId: string): HTMLElement {
  return el(
    "a",
    {
      class: "linklike",
      href: ctx.cityInfoUrl(stationId),
      attrs: { target: "_blank", rel: "noopener noreferrer" },
    },
    [
      el("span", { text: t("act_guide") }),
      icon(I.external),
      el("span", { class: "sr-only", text: t("link_newtab") }),
    ],
  );
}

/**
 * A compact "Book this train" link for one leg of a connecting journey — MAX seats
 * often can't be booked end-to-end, so each train is bookable on its own.
 */
function legBookLink(ctx: RenderCtx, leg: MaxTrain, n: number): HTMLElement {
  return el(
    "a",
    {
      class: "btn btn-book btn-leg-book",
      href: ctx.bookUrl(leg.origin, leg.destination, leg.date, leg.depart),
      attrs: {
        target: "_blank",
        rel: "noopener noreferrer",
        "aria-label": `${t("act_book_leg", { n })} — ${ctx.label(leg.origin)} → ${ctx.label(leg.destination)}`,
      },
    },
    [el("span", { text: t("act_book_leg", { n }) }), icon(I.external)],
  );
}

/** A direct or connecting journey card. */
export function journeyEl(j: Journey, ctx: RenderCtx): HTMLElement {
  const connecting = j.legs.length > 1;
  const legs = el("div", { class: "legs" });
  j.legs.forEach((leg, i) => {
    if (i > 0) {
      legs.append(
        el("div", { class: "layover" }, [
          icon(I.clock),
          el("span", {
            text: t("lbl_connection", {
              dur: formatDuration(j.layovers[i - 1] ?? 0),
              hub: ctx.label(j.hubs[i - 1] ?? leg.origin),
            }),
          }),
        ]),
      );
    }
    const route = el("div", { class: "leg-route" }, [
      el("span", { text: ctx.label(leg.origin) }),
      icon(I.arrow),
      el("span", { text: ctx.label(leg.destination) }),
      ...(leg.date !== j.date
        ? [
            el("span", {
              class: "day-badge",
              text: t("lbl_dayoffset", { n: dayIndex(leg.date) - dayIndex(j.date) }),
            }),
          ]
        : []),
    ]);
    // Connecting journeys book per-train (end-to-end MAX is often unavailable).
    const legChildren = [route, trainRowEl(leg)];
    if (connecting) legChildren.push(legBookLink(ctx, leg, i + 1));
    legs.append(el("div", { class: "leg" }, legChildren));
  });

  const tag =
    j.legs.length === 1
      ? el("span", { class: "chip chip-direct", text: t("lbl_direct") })
      : el("span", {
          class: "chip chip-via",
          text: t("lbl_via", { hub: j.hubs.map((h) => ctx.label(h)).join(", ") }),
        });

  const head = el("div", { class: "journey-head" }, [
    tag,
    el("span", { class: "journey-total" }, [
      icon(I.clock),
      el("span", { text: formatDuration(j.totalDurationMin) }),
    ]),
  ]);

  const actions = el("div", { class: "actions" }, [
    // Direct trips book in one tap; connecting ones book per-leg (buttons above).
    ...(connecting ? [] : [bookLink(ctx, j.origin, j.destination, j.date, j.legs[0]?.depart)]),
    el(
      "button",
      { class: "btn btn-ghost", type: "button", on: { click: () => ctx.onIcs(j) } },
      [icon(I.cal), el("span", { text: t("act_ics") })],
    ),
    el(
      "button",
      { class: "btn btn-ghost", type: "button", on: { click: () => showOnMap() } },
      [icon(I.pin), el("span", { text: t("act_map") })],
    ),
  ]);

  const article = el("article", { class: "journey is-clickable" }, [head, legs, actions]);

  // Clicking the card (anywhere but the action buttons) draws this journey on
  // the map and marks it active among its siblings.
  function showOnMap(): void {
    ctx.onShowJourney(j);
    article.parentElement
      ?.querySelectorAll(".journey.is-active")
      .forEach((x) => x.classList.remove("is-active"));
    article.classList.add("is-active");
  }
  article.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".actions")) return;
    showOnMap();
  });

  return article;
}

/** A favourite-toggle star button for a route, with live aria/label updates. */
function favStarEl(route: RoutePair, ctx: RenderCtx): HTMLElement {
  const favLabel = (): string => (ctx.isFavorite(route) ? t("act_fav_remove") : t("act_fav_add"));
  return el(
    "button",
    {
      class: ctx.isFavorite(route) ? "star is-fav" : "star",
      type: "button",
      title: favLabel(),
      attrs: { "aria-pressed": String(ctx.isFavorite(route)), "aria-label": favLabel() },
      on: {
        click: (e) => {
          ctx.onToggleFavorite(route);
          const b = e.currentTarget as HTMLElement;
          const now = ctx.isFavorite(route);
          b.classList.toggle("is-fav", now);
          b.setAttribute("aria-pressed", String(now));
          const lbl = now ? t("act_fav_remove") : t("act_fav_add");
          b.setAttribute("aria-label", lbl);
          b.title = lbl;
        },
      },
    },
    [icon(I.star)],
  );
}

/**
 * A destination/origin group card (for "from"/"to" modes). Clicking opens the
 * exact-trip ("trajet précis") view for the route, where the 30-day calendar
 * shows exactly which dates are bookable. `stat` shows total MAX availability
 * over the whole booking window so the list doubles as an availability ranking.
 */
export function groupCardEl(
  group: StationGroup,
  mode: SearchMode,
  anchor: string,
  ctx: RenderCtx,
  dayCount: number,
  stat?: WindowStat,
  flexDays = 0,
): HTMLElement {
  const origin = mode === "from" ? anchor : group.station;
  const destination = mode === "from" ? group.station : anchor;
  const route: RoutePair = { origin, destination };

  const star = favStarEl(route, ctx);

  // Two figures: trains on the chosen day (or, with flexible dates, within ±N days)
  // and the total over the whole month — so the list ranks places by availability.
  const month = stat?.trains ?? group.count;
  const dayPart =
    flexDays > 0 ? t("stat_flex_month", { day: dayCount, n: flexDays, month }) : t("stat_day_month", { day: dayCount, month });
  const summary = stat ? dayPart : t("badge_trains", { n: dayCount });

  const meta: HTMLElement[] = [];
  if (stat) {
    meta.push(
      el("span", {
        class: "stat-chip",
        text: summary,
        attrs: { title: t("stat_window_hint", { trains: stat.trains, days: stat.days }) },
      }),
    );
  } else {
    meta.push(el("span", { text: t("badge_trains", { n: group.count }) }));
  }
  meta.push(el("bdi", { text: formatDuration(group.minDurationMin) }));

  const main = el(
    "button",
    {
      class: "dest-main",
      type: "button",
      attrs: { "aria-label": `${ctx.label(group.station)} — ${summary}` },
      on: { click: () => ctx.onOpenRoute(origin, destination) },
    },
    [
      el("span", { class: "dest-name", text: ctx.label(group.station) }),
      el("span", { class: "dest-meta", attrs: { "aria-hidden": "true" } }, meta),
      el("span", { class: "chev", attrs: { "aria-hidden": "true" } }, [icon(I.arrow)]),
    ],
  );

  return el("article", { class: "group-card", dataset: { station: group.station } }, [
    el("div", { class: "dest-row" }, [star, main]),
  ]);
}

/**
 * A ranked journey row: the station of interest + best total time + direct/via.
 * Used by "best" mode and by the connection-aware "from"/"to" browse results.
 */
export function reachTripRowEl(
  station: string,
  j: Journey,
  ctx: RenderCtx,
  extra?: HTMLElement,
): HTMLElement {
  const route: RoutePair = { origin: j.origin, destination: j.destination };
  const via = j.legs.length > 1;
  // Connecting trips get a "via" chip so a correspondence is obvious in the list;
  // direct trips stay clean.
  const viaChip = via
    ? [
        el("span", {
          class: "chip chip-via",
          text: t("lbl_via", { hub: j.hubs.map((h) => ctx.label(h)).join(", ") }),
        }),
      ]
    : [];
  const aria = `${ctx.label(station)} — ${formatDuration(j.totalDurationMin)}${
    via ? ` (${t("lbl_via", { hub: j.hubs.map((h) => ctx.label(h)).join(", ") })})` : ""
  }`;
  const main = el(
    "button",
    {
      class: "dest-main",
      type: "button",
      attrs: { "aria-label": aria },
      on: { click: () => ctx.onOpenRoute(j.origin, j.destination) },
    },
    [
      el("span", { class: "dest-name", text: ctx.label(station) }),
      ...viaChip,
      ...(extra ? [extra] : []),
      el("span", { class: "dest-meta", attrs: { "aria-hidden": "true" } }, [
        el("bdi", { text: formatDuration(j.totalDurationMin) }),
      ]),
      el("span", { class: "chev", attrs: { "aria-hidden": "true" } }, [icon(I.arrow)]),
    ],
  );
  return el("article", { class: "group-card", dataset: { station } }, [
    el("div", { class: "dest-row" }, [favStarEl(route, ctx), main]),
  ]);
}

/** A ranked best-trip row ("best" mode); in all-days view it shows a month count. */
export function bestTripRowEl(trip: BestTrip, ctx: RenderCtx): HTMLElement {
  const badge =
    trip.days != null
      ? el("span", {
          class: "chip chip-soft month-chip",
          text: t("ideas_days", { n: trip.days }),
          attrs: { title: t("ideas_days_hint", { n: trip.days }) },
        })
      : undefined;
  return reachTripRowEl(trip.destination, trip.journey, ctx, badge);
}

/**
 * A nearby paid-connection alternative (radius search): the nearby station, how
 * far it is, and the free-MAX journey it offers. Clicking opens that free route;
 * the user covers the short hop to/from the exact endpoint themselves.
 */
export function nearbyTripRowEl(station: string, km: number, j: Journey, ctx: RenderCtx): HTMLElement {
  const via = j.legs.length > 1;
  const viaChip = via
    ? [el("span", { class: "chip chip-via", text: t("lbl_via", { hub: j.hubs.map((h) => ctx.label(h)).join(", ") }) })]
    : [];
  const main = el(
    "button",
    {
      class: "dest-main",
      type: "button",
      attrs: { "aria-label": `${ctx.label(station)} — ${t("nearby_km", { km })} — ${formatDuration(j.totalDurationMin)}` },
      on: { click: () => ctx.onOpenRoute(j.origin, j.destination) },
    },
    [
      el("span", { class: "dest-name", text: ctx.label(station) }),
      el("span", { class: "chip chip-soft km-chip", text: t("nearby_km", { km }) }),
      ...viaChip,
      el("span", { class: "dest-meta", attrs: { "aria-hidden": "true" } }, [
        el("bdi", { text: formatDuration(j.totalDurationMin) }),
      ]),
      el("span", { class: "chev", attrs: { "aria-hidden": "true" } }, [icon(I.arrow)]),
    ],
  );
  return el("article", { class: "group-card", dataset: { station } }, [
    el("div", { class: "dest-row" }, [favStarEl({ origin: j.origin, destination: j.destination }, ctx), main]),
  ]);
}

/**
 * A both-ends nearby alternative (radius search): leave from a nearby station AND
 * arrive at a nearby one. Shows both stations with their distances and the free
 * journey between them; clicking opens that route.
 */
export function nearbyBothRowEl(
  fromId: string,
  fromKm: number,
  toId: string,
  toKm: number,
  j: Journey,
  ctx: RenderCtx,
): HTMLElement {
  const main = el(
    "button",
    {
      class: "dest-main",
      type: "button",
      attrs: { "aria-label": `${ctx.label(fromId)} → ${ctx.label(toId)} — ${formatDuration(j.totalDurationMin)}` },
      on: { click: () => ctx.onOpenRoute(j.origin, j.destination) },
    },
    [
      el("span", { class: "dest-name" }, [
        el("bdi", { text: ctx.label(fromId) }),
        el("span", { class: "muted", text: " → " }),
        el("bdi", { text: ctx.label(toId) }),
      ]),
      el("span", { class: "chip chip-soft km-chip", text: t("nearby_km", { km: Math.max(fromKm, toKm) }) }),
      el("span", { class: "dest-meta", attrs: { "aria-hidden": "true" } }, [
        el("bdi", { text: formatDuration(j.totalDurationMin) }),
      ]),
      el("span", { class: "chev", attrs: { "aria-hidden": "true" } }, [icon(I.arrow)]),
    ],
  );
  return el("article", { class: "group-card", dataset: { station: fromId } }, [
    el("div", { class: "dest-row" }, [favStarEl({ origin: j.origin, destination: j.destination }, ctx), main]),
  ]);
}

/**
 * The 30-day strip with the selected day highlighted. Defaults to a route's
 * train-availability calendar; `opts` lets "best" mode relabel it as an
 * ideas-by-day strip (title + a "{n} destinations" count).
 */
export function calendarEl(
  days: CalendarDay[],
  ctx: RenderCtx,
  selected?: string,
  opts?: { title?: string; count?: (n: number) => string },
): HTMLElement {
  const countText = opts?.count ?? ((n: number) => t("badge_trains", { n }));
  const grid = el("div", { class: "cal-grid" });
  // Arrow-key navigation: move focus between day cells (←/→ a day, ↑/↓ a row,
  // Home/End to the ends). The grid is a linear sequence of days, so the row size
  // is read live from the layout (10 columns on desktop, 7 on phones).
  grid.addEventListener("keydown", (e) => {
    const keys = ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home", "End"];
    if (!keys.includes(e.key)) return;
    const cells = [...grid.querySelectorAll<HTMLButtonElement>(".cal-cell")];
    const i = cells.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    let cols = 1;
    const top = cells[0]?.offsetTop;
    for (let k = 1; k < cells.length; k++) {
      if (cells[k]?.offsetTop !== top) break;
      cols++;
    }
    const target =
      e.key === "ArrowRight" ? i + 1
      : e.key === "ArrowLeft" ? i - 1
      : e.key === "ArrowDown" ? i + cols
      : e.key === "ArrowUp" ? i - cols
      : e.key === "Home" ? 0
      : cells.length - 1;
    cells[Math.max(0, Math.min(cells.length - 1, target))]?.focus();
  });
  let anyNearby = false;
  let anyBoth = false;
  for (const d of days) {
    const sel = d.date === selected ? " sel" : "";
    // Four states: free seat on the exact route (ok); reachable by substituting one
    // endpoint with a nearby station (near); only by substituting both ends
    // (near-both); or nothing (no). The last two are radius-search only. NB: these
    // class names are calendar-local — "near" not "nearby", which is the results
    // section's class and would leak its margin onto the cells.
    const nearby = !d.available && Boolean(d.nearby);
    const both = !d.available && !d.nearby && Boolean(d.nearbyBoth);
    if (nearby) anyNearby = true;
    if (both) anyBoth = true;
    const state = d.available ? "ok" : nearby ? "near" : both ? "near-both" : "no";
    const status = d.available
      ? t("cal_available")
      : nearby
        ? t("cal_nearby")
        : both
          ? t("cal_nearby_both")
          : t("cal_unavailable");
    const cell = el(
      "button",
      {
        class: `cal-cell ${state}${sel}`,
        type: "button",
        title: `${ctx.formatDate(d.date)} — ${d.available ? countText(d.count) : status}`,
        attrs: {
          "aria-label": `${ctx.formatDate(d.date)} — ${status}`,
          ...(sel ? { "aria-current": "date" } : {}),
        },
        on: { click: () => ctx.onSelectDay(d.date) },
      },
      [
        // Weekday above the day number, so each cell reads as a real date.
        el("span", { class: "cal-dow", text: ctx.formatWeekday(d.date), attrs: { "aria-hidden": "true" } }),
        el("span", { class: "cal-day", text: d.date.slice(8, 10) }),
      ],
    );
    grid.append(cell);
  }
  const legend = [
    t("cal_legend"),
    ...(anyNearby ? [t("cal_legend_nearby")] : []),
    ...(anyBoth ? [t("cal_legend_nearby_both")] : []),
  ].join(" · ");
  return el("section", { class: "calendar" }, [
    el("h3", { text: opts?.title ?? t("cal_title") }),
    grid,
    el("p", { class: "cal-legend muted", text: legend }),
  ]);
}

/** One flexible-date row: the fastest trip for a nearby day; click to select it. */
export function flexDayEl(
  date: string,
  j: Journey,
  ctx: RenderCtx,
  selected: boolean,
  destLabel?: string,
): HTMLElement {
  const first = j.legs[0];
  const last = j.legs[j.legs.length - 1];
  const via = j.legs.length > 1;
  return el(
    "button",
    {
      class: `flex-day${selected ? " is-sel" : ""}`,
      type: "button",
      attrs: { "aria-pressed": String(selected) },
      on: { click: () => ctx.onSelectDay(date) },
    },
    [
      el("span", { class: "flex-date", text: ctx.formatDate(date) }),
      // In "best" mode the destination differs each day, so name it; in "od" the
      // route is fixed and shown in the page title, so this is omitted.
      ...(destLabel ? [el("span", { class: "flex-dest", text: destLabel })] : []),
      el("span", { class: "flex-time" }, [
        el("strong", { text: first?.depart ?? "" }),
        icon(I.arrow),
        el("strong", { text: last?.arrive ?? "" }),
      ]),
      el("span", { class: "flex-meta" }, [icon(I.clock), el("bdi", { text: formatDuration(j.totalDurationMin) })]),
      via
        ? el("span", {
            class: "chip chip-via",
            text: t("lbl_via", { hub: j.hubs.map((h) => ctx.label(h)).join(", ") }),
          })
        : el("span", { class: "chip chip-direct", text: t("lbl_direct") }),
    ],
  );
}

/** A round-trip card. */
export function roundTripEl(rt: RoundTrip, ctx: RenderCtx): HTMLElement {
  const out = el("div", { class: "rt-leg" }, [
    el("span", { class: "chip chip-soft", text: t("rt_outbound") }),
    journeyEl(rt.outbound, ctx),
  ]);
  const back = el("div", { class: "rt-leg" }, [
    el("span", { class: "chip chip-soft", text: t("rt_inbound") }),
    journeyEl(rt.inbound, ctx),
  ]);
  const stay = el("p", {
    class: "rt-stay muted",
    text: t("rt_stay", { dur: formatDuration(rt.stayMinutes) }),
  });
  return el("article", { class: "roundtrip" }, [out, stay, back]);
}

/** Straight-line km between a journey's endpoints, or null if unmeasurable. */
function legKm(j: Journey, ctx: RenderCtx): number | null {
  const d = ctx.distanceKm(j.origin, j.destination);
  return Number.isFinite(d) ? Math.round(d) : null;
}

/** A multi-city tour itinerary (tour mode). */
export function tourEl(tour: Tour, ctx: RenderCtx): HTMLElement {
  const first = tour.legs[0];
  const stops = first ? [first.origin, ...tour.legs.map((l) => l.destination)] : [];
  // Total straight-line distance across every hop ("as the crow flies").
  const totalKm = tour.legs.reduce((s, j) => s + (legKm(j, ctx) ?? 0), 0);
  // The header is a button: clicking it draws the whole tour (every stop) on the
  // map, so after inspecting a single leg you can get the overview back.
  const head = el("button", {
    class: "tour-head is-clickable",
    type: "button",
    attrs: { title: t("act_map"), "aria-label": t("act_map") },
    on: { click: () => ctx.onShowTour(tour) },
  }, [
    el("span", { class: "tour-route", text: stops.map((s) => ctx.label(s)).join(" → ") }),
    el("span", { class: "tour-totals" }, [
      ...(totalKm > 0
        ? [el("span", { class: "tour-km", attrs: { title: t("nearest_hint") }, text: `${totalKm} km` })]
        : []),
      el("span", { class: "journey-total" }, [
        icon(I.clock),
        el("span", { text: formatDuration(tour.totalDurationMin) }),
      ]),
    ]),
  ]);
  // "Day N" is the actual trip day of each hop, so a multi-day stay shows real
  // gaps (Day 1, Day 4, …) rather than a misleading 1-per-row count. Each leg is a
  // clear day band: a bold numbered badge + the date, so days are easy to scan.
  const base = first ? dayIndex(first.date) : 0;
  const legs = tour.legs.map((j) => {
    const km = legKm(j, ctx);
    const dayNum = dayIndex(j.date) - base + 1;
    const dayLabel = t("tour_day", { n: dayNum, date: ctx.formatDate(j.date) });
    return el("div", { class: "tour-leg" }, [
      el("div", { class: "tour-leg-head" }, [
        el("span", {
          class: "tour-day-badge",
          text: String(dayNum),
          attrs: { "aria-label": dayLabel, title: dayLabel },
        }),
        el("span", { class: "tour-day-date", text: ctx.formatDate(j.date) }),
        ...(km != null
          ? [el("span", { class: "leg-km muted", attrs: { title: t("nearest_hint") }, text: `${km} km` })]
          : []),
      ]),
      journeyEl(j, ctx),
    ]);
  });
  return el("article", { class: "tour" }, [head, el("div", { class: "tour-legs" }, legs)]);
}

export function emptyEl(message: string): HTMLElement {
  return el("p", { class: "empty", text: message });
}

/** A muted "things to try" hint shown under a no-results message. */
export function hintEl(text: string): HTMLElement {
  return el("p", { class: "empty-hint muted", text });
}
