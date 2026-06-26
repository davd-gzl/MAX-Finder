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
  bookUrl: (origin: string, destination: string, date: string) => string;
  /** External travel-guide (Wikivoyage) URL for a station's city. */
  cityInfoUrl: (id: string) => string;
  onOpenRoute: (origin: string, destination: string) => void;
  onFocusStation: (id: string) => void;
  /** Draw a specific journey (origin → interchanges → destination) on the map. */
  onShowJourney: (journey: Journey) => void;
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

function bookLink(ctx: RenderCtx, origin: string, destination: string, date: string): HTMLElement {
  return el(
    "a",
    {
      class: "btn btn-book",
      href: ctx.bookUrl(origin, destination, date),
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

/** A direct or connecting journey card. */
export function journeyEl(j: Journey, ctx: RenderCtx): HTMLElement {
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
    legs.append(el("div", { class: "leg" }, [route, trainRowEl(leg)]));
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
    bookLink(ctx, j.origin, j.destination, j.date),
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
  stat?: WindowStat,
): HTMLElement {
  const origin = mode === "from" ? anchor : group.station;
  const destination = mode === "from" ? group.station : anchor;
  const route: RoutePair = { origin, destination };

  const star = favStarEl(route, ctx);

  // Two figures: trains on the selected day, and the total over the whole month
  // (every reservable MAX train to this place, not just the chosen day).
  const summary = stat
    ? t("stat_day_month", { day: group.count, month: stat.trains })
    : t("badge_trains", { n: group.count });

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
export function reachTripRowEl(station: string, j: Journey, ctx: RenderCtx): HTMLElement {
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

/** A ranked best-trip row ("best" mode). */
export function bestTripRowEl(trip: BestTrip, ctx: RenderCtx): HTMLElement {
  return reachTripRowEl(trip.destination, trip.journey, ctx);
}

/** The 30-day availability strip for a route, with the selected day highlighted. */
export function calendarEl(days: CalendarDay[], ctx: RenderCtx, selected?: string): HTMLElement {
  const grid = el("div", { class: "cal-grid" });
  for (const d of days) {
    const sel = d.date === selected ? " sel" : "";
    const cell = el("button", {
      class: `cal-cell ${d.available ? "ok" : "no"}${sel}`,
      type: "button",
      title: `${ctx.formatDate(d.date)} — ${d.available ? t("badge_trains", { n: d.count }) : "—"}`,
      attrs: {
        "aria-label": `${ctx.formatDate(d.date)} — ${d.available ? t("cal_available") : t("cal_unavailable")}`,
        ...(sel ? { "aria-current": "date" } : {}),
      },
      text: d.date.slice(8, 10),
      on: { click: () => ctx.onSelectDay(d.date) },
    });
    grid.append(cell);
  }
  return el("section", { class: "calendar" }, [
    el("h3", { text: t("cal_title") }),
    grid,
    el("p", { class: "cal-legend muted", text: t("cal_legend") }),
  ]);
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

/** A multi-city tour itinerary (tour mode). */
export function tourEl(tour: Tour, ctx: RenderCtx): HTMLElement {
  const first = tour.legs[0];
  const stops = first ? [first.origin, ...tour.legs.map((l) => l.destination)] : [];
  const head = el("div", { class: "tour-head" }, [
    el("span", { class: "tour-route", text: stops.map((s) => ctx.label(s)).join(" → ") }),
    el("span", { class: "journey-total" }, [
      icon(I.clock),
      el("span", { text: formatDuration(tour.totalDurationMin) }),
    ]),
  ]);
  // "Day N" is the actual trip day of each hop, so a multi-day stay shows real
  // gaps (Day 1, Day 4, …) rather than a misleading 1-per-row count.
  const base = first ? dayIndex(first.date) : 0;
  const legs = tour.legs.map((j) =>
    el("div", { class: "tour-leg" }, [
      el("span", {
        class: "chip chip-soft",
        text: t("tour_day", { n: dayIndex(j.date) - base + 1, date: ctx.formatDate(j.date) }),
      }),
      journeyEl(j, ctx),
    ]),
  );
  return el("article", { class: "tour" }, [head, ...legs]);
}

/** A clean empty state: a soft icon, the message, and an optional hint line. */
export function emptyEl(message: string, hint?: string): HTMLElement {
  const children: (Node | string)[] = [
    el("span", {
      class: "empty-icon",
      attrs: { "aria-hidden": "true" },
      html: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.2-4.2"/></svg>`,
    }),
    el("p", { class: "empty-msg", text: message }),
  ];
  if (hint) children.push(el("p", { class: "empty-hint", text: hint }));
  return el("div", { class: "empty", attrs: { role: "status" } }, children);
}

/** Shimmer placeholder rows shown while a search computes (clean loading state). */
export function skeletonEl(rows = 5): HTMLElement {
  const wrap = el("div", { class: "skeleton", attrs: { role: "status", "aria-label": t("loading") } });
  for (let i = 0; i < rows; i++) {
    wrap.append(
      el("div", { class: "skeleton-row" }, [
        el("span", { class: "sk sk-dot" }),
        el("span", { class: "sk sk-line" }),
        el("span", { class: "sk sk-chip" }),
      ]),
    );
  }
  return wrap;
}
