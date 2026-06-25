import type { MaxTrain, Journey, SearchMode, CalendarDay } from "../types";
import type { StationGroup } from "../core/destinations";
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
  onOpenRoute: (origin: string, destination: string) => void;
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
    el("span", { text: formatDuration(train.durationMin) }),
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
  ]);

  return el("article", { class: "journey" }, [head, legs, actions]);
}

/** A destination/origin group card (for "from"/"to" modes). */
export function groupCardEl(
  group: StationGroup,
  mode: SearchMode,
  anchor: string,
  ctx: RenderCtx,
): HTMLElement {
  const origin = mode === "from" ? anchor : group.station;
  const destination = mode === "from" ? group.station : anchor;
  const route: RoutePair = { origin, destination };

  const favLabel = (): string => (ctx.isFavorite(route) ? t("act_fav_remove") : t("act_fav_add"));
  const star = el(
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

  // Expandable panel: trains + a calendar drill-down and the booking handoff.
  const panel = el("div", { class: "dest-panel", attrs: { hidden: "" } }, [
    el("div", { class: "dest-trains" }, group.trains.map((tr) => trainRowEl(tr))),
    el("div", { class: "dest-links" }, [
      el(
        "button",
        { class: "linklike", type: "button", on: { click: () => ctx.onOpenRoute(origin, destination) } },
        [el("span", { text: t("act_calendar") }), icon(I.cal)],
      ),
      el(
        "a",
        {
          class: "linklike",
          href: ctx.bookUrl(origin, destination, ""),
          attrs: { target: "_blank", rel: "noopener noreferrer" },
        },
        [el("span", { text: t("act_book") }), icon(I.external), el("span", { class: "sr-only", text: t("link_newtab") })],
      ),
    ]),
  ]);

  const main = el(
    "button",
    {
      class: "dest-main",
      type: "button",
      attrs: {
        "aria-expanded": "false",
        "aria-label": `${ctx.label(group.station)} — ${t("badge_trains", { n: group.count })}`,
      },
      on: {
        click: (e) => {
          const open = panel.hasAttribute("hidden");
          panel.toggleAttribute("hidden", !open);
          (e.currentTarget as HTMLElement).setAttribute("aria-expanded", String(open));
        },
      },
    },
    [
      el("span", { class: "dest-name", text: ctx.label(group.station) }),
      el("span", {
        class: "dest-meta",
        attrs: { "aria-hidden": "true" },
        text: `${t("badge_trains", { n: group.count })} · ${formatDuration(group.minDurationMin)}`,
      }),
      el("span", { class: "chev", attrs: { "aria-hidden": "true" } }, [icon(I.arrow)]),
    ],
  );

  return el("article", { class: "group-card" }, [el("div", { class: "dest-row" }, [star, main]), panel]);
}

/** A ranked best-trip row ("best" mode): destination + best total time + direct/via. */
export function bestTripRowEl(trip: BestTrip, ctx: RenderCtx): HTMLElement {
  const j = trip.journey;
  const tag =
    j.legs.length === 1
      ? t("lbl_direct")
      : t("lbl_via", { hub: j.hubs.map((h) => ctx.label(h)).join(", ") });
  const main = el(
    "button",
    {
      class: "dest-main",
      type: "button",
      attrs: { "aria-label": `${ctx.label(trip.destination)} — ${formatDuration(j.totalDurationMin)}` },
      on: { click: () => ctx.onOpenRoute(j.origin, trip.destination) },
    },
    [
      el("span", { class: "dest-name", text: ctx.label(trip.destination) }),
      el("span", {
        class: "dest-meta",
        attrs: { "aria-hidden": "true" },
        text: `${formatDuration(j.totalDurationMin)} · ${tag}`,
      }),
      el("span", { class: "chev", attrs: { "aria-hidden": "true" } }, [icon(I.arrow)]),
    ],
  );
  return el("article", { class: "group-card" }, [el("div", { class: "dest-row" }, [main])]);
}

/** The 30-day availability strip for a route. */
export function calendarEl(days: CalendarDay[], ctx: RenderCtx): HTMLElement {
  const grid = el("div", { class: "cal-grid" });
  for (const d of days) {
    const cell = el("button", {
      class: `cal-cell ${d.available ? "ok" : "no"}`,
      type: "button",
      title: `${ctx.formatDate(d.date)} — ${d.available ? t("badge_trains", { n: d.count }) : "—"}`,
      attrs: {
        "aria-label": `${ctx.formatDate(d.date)} — ${d.available ? t("cal_available") : t("cal_unavailable")}`,
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
  const legs = tour.legs.map((j, i) =>
    el("div", { class: "tour-leg" }, [
      el("span", {
        class: "chip chip-soft",
        text: t("tour_day", { n: i + 1, date: ctx.formatDate(j.date) }),
      }),
      journeyEl(j, ctx),
    ]),
  );
  return el("article", { class: "tour" }, [head, ...legs]);
}

export function emptyEl(message: string): HTMLElement {
  return el("p", { class: "empty", text: message });
}
