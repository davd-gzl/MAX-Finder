import type { MaxTrain, Journey, SearchMode, CalendarDay, SortKey } from "../types";
import type { HiddenTrain } from "../core/hidden";
import type { StationGroup, WindowStat } from "../core/destinations";
import type { BestTrip } from "../core/best";
import type { Getaway } from "../core/getaways";
import type { Tour } from "../core/tour";
import type { RoundTrip } from "../types";
import type { RoutePair } from "../state/store";
import { el } from "./dom";
import { isNightTrain } from "../core/search";
import { isAirportStation } from "../data/stations";
import { formatDuration, dayIndex, addDays } from "../util/time";
import { t } from "../i18n";

// Monotonic id source for wiring aria-labelledby (a calendar's <h3> to its grid).
let uidSeq = 0;

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
  /** Open the step-by-step "book each train" modal for a connecting journey. */
  onBookSteps: (journey: Journey) => void;
  isFavorite: (route: RoutePair) => boolean;
  onToggleFavorite: (route: RoutePair) => void;
  /** Whether this trip (one-way, or a round trip with `inbound`) is saved. */
  isTripSaved: (outbound: Journey, inbound?: Journey) => boolean;
  /** Save the trip if absent, else remove it. */
  onToggleTrip: (outbound: Journey, inbound?: Journey) => void;
  /** Open the consolidated one-page view of a trip (round trip when `inbound` is set). */
  onShowTrip: (outbound: Journey, inbound?: Journey) => void;
  /** Whether this multi-city tour is saved. */
  isTourSaved: (tour: Tour) => boolean;
  /** Save the tour if absent, else remove it. */
  onToggleTour: (tour: Tour) => void;
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
  bookmark: '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/>',
  // A numbered/stepped list — used when "Book" opens the step-by-step modal (book
  // each train in turn) rather than a single deep link to a new tab.
  steps: '<path d="M9 6h11M9 12h11M9 18h11M4 5l1 1 1.5-1.5M4 11l1 1 1.5-1.5M4 17l1 1 1.5-1.5"/>',
  plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 4.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
};

/**
 * A Save button that toggles whether a trip is kept in "Saved trips". Used both on
 * a single journey card (one-way) and in the round-trip view (`inbound` set). Keeps
 * its own label/pressed state in sync on click.
 */
function tripSaveBtn(outbound: Journey, ctx: RenderCtx, inbound?: Journey): HTMLElement {
  const saved = (): boolean => ctx.isTripSaved(outbound, inbound);
  const lbl = el("span", { text: saved() ? t("act_saved") : t("act_save") });
  const btn = el(
    "button",
    {
      class: saved() ? "btn btn-ghost is-saved" : "btn btn-ghost",
      type: "button",
      attrs: { "aria-pressed": String(saved()), title: saved() ? t("act_unsave") : t("act_save") },
      on: {
        click: () => {
          ctx.onToggleTrip(outbound, inbound);
          const now = saved();
          btn.classList.toggle("is-saved", now);
          btn.setAttribute("aria-pressed", String(now));
          btn.title = now ? t("act_unsave") : t("act_save");
          lbl.textContent = now ? t("act_saved") : t("act_save");
        },
      },
    },
    [icon(I.bookmark), lbl],
  );
  return btn;
}

/** One train as a compact row. (Every shown train is MAX-reservable by definition.) */
export function trainRowEl(train: MaxTrain): HTMLElement {
  const time = el("span", { class: "train-time" }, [
    el("strong", { text: train.depart }),
    icon(I.arrow),
    el("strong", { text: train.arrive }),
    // Overnight train: the arrival time is past midnight (arriveMin ≥ 1440), so flag
    // the day offset — otherwise "23:00 → 00:50" reads as arriving the same morning.
    ...(train.arriveMin >= 1440
      ? [el("span", { class: "day-offset", text: t("lbl_dayoffset", { n: Math.floor(train.arriveMin / 1440) }) })]
      : []),
  ]);
  const meta = el("span", { class: "train-meta" }, [
    icon(I.clock),
    el("bdi", { text: formatDuration(train.durationMin) }),
    el("span", { class: "train-no", text: t("lbl_train", { no: train.trainNo }) }),
    ...(train.axe ? [el("span", { class: "train-axe", text: train.axe })] : []),
    // A little 🌙 so a sleeper (leaves late / arrives past midnight) is obvious at a
    // glance in the list, not only from the "+1d" time badge.
    ...(isNightTrain(train)
      ? [el("span", { class: "night-badge", text: "🌙", attrs: { title: t("field_night"), "aria-label": t("field_night") } })]
      : []),
  ]);
  return el("div", { class: "train-row" }, [time, meta]);
}

/**
 * A one-line summary of a chosen journey — its departure→arrival, total time, and a
 * direct/via chip — used as the collapsed "you picked this" line in the multi-city
 * stepper. Deliberately compact: it stands in for a whole journey card.
 */
export function journeySummaryEl(j: Journey, ctx: RenderCtx): HTMLElement {
  const first = j.legs[0];
  const last = j.legs[j.legs.length - 1];
  const via = j.legs.length > 1;
  return el("span", { class: "mc-pick" }, [
    el("span", { class: "mc-pick-time" }, [
      el("strong", { text: first?.depart ?? "" }),
      icon(I.arrow),
      el("strong", { text: last?.arrive ?? "" }),
    ]),
    el("span", { class: "mc-pick-dur muted" }, [icon(I.clock), el("bdi", { text: formatDuration(j.totalDurationMin) })]),
    via
      ? el("span", { class: "chip chip-via", text: t("lbl_via", { hub: j.hubs.map((h) => ctx.label(h)).join(", ") }) })
      : el("span", { class: "chip chip-direct", text: t("lbl_direct") }),
  ]);
}

/** External travel-guide link styled as a button (matches the Save button). */
export function guideButtonEl(ctx: RenderCtx, stationId: string): HTMLElement {
  return el(
    "a",
    {
      class: "btn btn-ghost",
      href: ctx.cityInfoUrl(stationId),
      attrs: { target: "_blank", rel: "noopener noreferrer" },
    },
    [icon(I.external), el("span", { text: t("act_guide") }), el("span", { class: "sr-only", text: t("link_newtab") })],
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

// Paris intra-muros is a single aggregate in the SNCF open data, but a train's axe
// pins which terminus gare it actually uses. Map the main TGV axes; other axes
// (Intercités, international, night) stay as the plain "Paris" — better a city than
// a wrong gare. The mapping only applies on a concrete journey leg (where the axe is
// known), never in browse lists (where many axes mix under one "Paris").
const PARIS_GARE_BY_AXE: Record<string, string> = {
  "SUD EST": "Paris Gare de Lyon",
  ATLANTIQUE: "Paris Montparnasse",
  NORD: "Paris Nord",
  EST: "Paris Est",
  // Every Intercités de Nuit from Paris departs Austerlitz. (IC ARO / INTERNATIONAL
  // aren't tied to one gare, so they stay the plain "Paris" aggregate.)
  "IC NUIT": "Paris Austerlitz",
};

/** Display name for one end of a leg: the specific Paris terminus gare — fixed by the
 *  train's axe — when that end is the Paris aggregate; otherwise the plain station /
 *  city label. We never guess a gare the data can't pin down (Lyon, Lille, …): if we
 *  don't know, we keep the city name. */
function legEndpointLabel(ctx: RenderCtx, leg: MaxTrain, end: "origin" | "destination"): string {
  const id = end === "origin" ? leg.origin : leg.destination;
  if (id === "PARIS (intramuros)") {
    return PARIS_GARE_BY_AXE[(leg.axe ?? "").toUpperCase().trim()] ?? ctx.label(id);
  }
  return ctx.label(id);
}

/** A small ✈ flag marking an airport station (Roissy-CDG, Lyon St-Exupéry, …). */
function airportBadge(): HTMLElement {
  return el(
    "span",
    { class: "airport-badge", attrs: { title: t("lbl_airport"), "aria-label": t("lbl_airport") } },
    [icon(I.plane)],
  );
}

/** A station-name span, with an ✈ badge appended when the station is an airport.
 *  For airports the name ellipsizes in an inner span so the flag is never clipped. */
function stationNameEl(cls: string, id: string, label: string): HTMLElement {
  if (!isAirportStation(id)) return el("span", { class: cls, text: label });
  return el("span", { class: `${cls} stn-airport`.trim() }, [
    el("span", { class: "stn-text", text: label }),
    airportBadge(),
  ]);
}

/**
 * A direct or connecting journey card. `opts.saveable` (default true) adds a Save
 * button to the actions; it's turned off inside the trip modal, where a single
 * whole-trip Save already covers both legs. `opts.onPick` makes a click on the card
 * select it (highlighting it among its siblings) and run the callback — used to
 * pick the outbound for a round trip, or open a return directly. `opts.selected`
 * pre-highlights the card.
 */
export function journeyEl(
  j: Journey,
  ctx: RenderCtx,
  opts: {
    saveable?: boolean;
    onPick?: (journey: Journey) => void;
    onArrow?: (journey: Journey) => void;
    selected?: boolean;
    /** Container within which the active/selected highlight is exclusive (defaults
     * to the card's parent). Use it when the cards aren't direct siblings — e.g. the
     * trip modal, where the two legs live in separate sections. */
    group?: HTMLElement;
    /** Hide the "Show on map" action (e.g. inside a modal, where the map is hidden). */
    hideMap?: boolean;
    /** Clicking the card body books the trip (deep link, or the step modal for a
     * connecting one) instead of just highlighting it — used for the one-way list,
     * where selecting a journey has no follow-up so the click may as well book. */
    bookOnClick?: boolean;
    /** A date chip in the card head — set when a flexible-date list mixes days, so
     * each proposition says which day it's for. */
    dateLabel?: string;
  } = {},
): HTMLElement {
  const saveable = opts.saveable !== false;
  const connecting = j.legs.length > 1;
  const book = (): void => {
    if (connecting) ctx.onBookSteps(j);
    else window.open(ctx.bookUrl(j.origin, j.destination, j.date, j.legs[0]?.depart), "_blank", "noopener,noreferrer");
  };

  // A through-ticket can't be pinned to the exact free trains in a single SNCF
  // Connect search (the connection time isn't settable from a deep link, so it
  // re-optimises to the earliest connection). So a connecting trip books train by
  // train via the step modal; a direct trip deep-links straight through.
  const bookBtn = opts.onArrow
    ? el(
        "button",
        {
          class: "book-arrow",
          type: "button",
          attrs: { "aria-label": t("act_next"), title: t("act_next") },
          on: {
            click: () => {
              select("is-selected");
              opts.onArrow!(j);
            },
          },
        },
        [icon(I.arrow)],
      )
    : connecting
    ? el(
        "button",
        {
          class: "book-arrow",
          type: "button",
          attrs: { "aria-label": t("act_book"), title: t("act_book") },
          on: { click: () => ctx.onBookSteps(j) },
        },
        [icon(I.arrow)],
      )
    : el(
        "a",
        {
          class: "book-arrow",
          href: ctx.bookUrl(j.origin, j.destination, j.date, j.legs[0]?.depart),
          attrs: {
            target: "_blank",
            rel: "noopener noreferrer",
            "aria-label": t("act_book"),
            title: t("act_book"),
          },
        },
        [icon(I.arrow), el("span", { class: "sr-only", text: t("link_newtab") })],
      );

  const article = el("article", { class: "journey is-clickable" }, [
    el("div", { class: "journey-main" }, [
      journeyBodyEl(j, ctx, undefined, opts.dateLabel),
      journeyActionsEl(j, ctx, { saveable, hideMap: opts.hideMap }),
    ]),
    el("div", { class: "journey-book" }, [bookBtn]),
  ]);
  if (opts.selected) article.classList.add("is-selected");

  const scope = (): HTMLElement | null => opts.group ?? article.parentElement;
  function select(cls: "is-active" | "is-selected"): void {
    scope()
      ?.querySelectorAll(".journey.is-active, .journey.is-selected")
      .forEach((x) => x.classList.remove("is-active", "is-selected"));
    article.classList.add(cls);
  }
  article.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("button, a")) return;
    if (opts.onPick) {
      select("is-selected");
      opts.onPick(j);
    } else if (opts.bookOnClick) {
      book();
    } else {
      select("is-active");
      ctx.onShowJourney(j);
    }
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
      stationNameEl("dest-name", group.station, ctx.label(group.station)),
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
      stationNameEl("dest-name", station, ctx.label(station)),
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


/**
 * A journey's detail: the direct/via chip with the total duration opposite it, then
 * each leg — the route, a rule, and the train row (times, "+1d", duration, number).
 * `label` names the leg (ALLER / RETOUR) when several journeys share one card, and
 * leads the head line beside the chip. Split out of journeyEl so the getaway card
 * can stack two of them in ONE ticket.
 */
function journeyBodyEl(j: Journey, ctx: RenderCtx, label?: string, dateLabel?: string): HTMLElement {
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
      stationNameEl("", leg.origin, legEndpointLabel(ctx, leg, "origin")),
      icon(I.arrow),
      stationNameEl("", leg.destination, legEndpointLabel(ctx, leg, "destination")),
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
    ...(label ? [el("h3", { class: "trip-leg-title", text: label })] : []),
    // With flexible dates the list spans several days, so each card carries its own
    // date (otherwise which day a proposition is for is lost). Leads the head.
    ...(dateLabel ? [el("span", { class: "chip chip-date", text: dateLabel })] : []),
    tag,
    el("span", { class: "journey-total" }, [icon(I.clock), el("span", { text: formatDuration(j.totalDurationMin) })]),
  ]);
  return el("div", { class: "journey-body" }, [head, legs]);
}

/**
 * The calendar / map / save row under a journey's legs. Split out of journeyEl so the
 * getaway card can close with ONE row for the round trip instead of one per leg.
 */
function journeyActionsEl(
  j: Journey,
  ctx: RenderCtx,
  opts: { saveable?: boolean; hideMap?: boolean } = {},
): HTMLElement {
  return el("div", { class: "journey-sub" }, [
    el("button", { class: "btn btn-ghost", type: "button", on: { click: () => ctx.onIcs(j) } }, [
      icon(I.cal),
      el("span", { text: t("act_ics") }),
    ]),
    ...(opts.hideMap
      ? []
      : [
          // btn-map so CSS can drop it in the mobile detail view, where the map is
          // hidden and the action would be a dead no-op.
          el("button", { class: "btn btn-ghost btn-map", type: "button", on: { click: () => ctx.onShowJourney(j) } }, [
            icon(I.pin),
            el("span", { text: t("act_map") }),
          ]),
        ]),
    ...(opts.saveable !== false ? [tripSaveBtn(j, ctx)] : []),
  ]);
}


/**
 * One destination in the duration search's LIST page: the city, how many start days
 * work (in the searched window and across the whole bookable one), the best
 * round-trip travel time, and an arrow into the city's own page — its calendar of
 * workable days plus every dated solution. Deliberately says nothing about times:
 * comparing places comes first, picking a day second.
 */
export function getawayCityRowEl(
  trip: Getaway,
  ctx: RenderCtx,
  stat: { days: number; windowDays: number },
  opts: { metric?: string } = {},
): HTMLElement {
  const origin = trip.outbound.origin;
  const route: RoutePair = { origin, destination: trip.destination };
  const summary = t("stat_day_month", { day: stat.days, month: stat.windowDays });
  const main = el(
    "button",
    {
      class: "dest-main",
      type: "button",
      attrs: { "aria-label": `${ctx.label(trip.destination)} — ${opts.metric ?? summary}` },
      on: { click: () => ctx.onOpenRoute(origin, trip.destination) },
    },
    [
      stationNameEl("dest-name", trip.destination, ctx.label(trip.destination)),
      el("span", { class: "dest-meta", attrs: { "aria-hidden": "true" } }, [
        // The mode's headline metric (hours on site / nights away) leads, so places
        // compare on what the mode is about; the days/window chip follows.
        ...(opts.metric ? [el("span", { class: "chip chip-onsite", text: opts.metric })] : []),
        el("span", {
          class: "stat-chip",
          text: summary,
          attrs: { title: t("getaway_days_hint", { n: stat.windowDays }) },
        }),
        el("bdi", { text: formatDuration(trip.travelMin) }),
      ]),
      el("span", { class: "chev", attrs: { "aria-hidden": "true" } }, [icon(I.arrow)]),
    ],
  );
  return el("article", { class: "group-card", dataset: { station: trip.destination } }, [
    el("div", { class: "dest-row" }, [favStarEl(route, ctx), main]),
  ]);
}

/**
 * One dated solution on a city's page: ONE ticket holding the whole round trip. The
 * head names the destination and how long you get there; below it each leg reads as
 * it does in the round-trip detail — its name and direct/via chip with the duration
 * opposite, the route, a rule, then the times / "+1d" / duration / train number. One
 * action row closes the card, for the trip as a whole; the stub's arrow opens it.
 */
export function getawayRowEl(trip: Getaway, ctx: RenderCtx, opts: { showDate?: boolean } = {}): HTMLElement {
  const origin = trip.outbound.origin;
  const route: RoutePair = { origin, destination: trip.destination };
  // The headline shows the figure that actually VARIES between rows: time on site
  // for same-day trips, round-trip travel time for N-night stays.
  const sameDay = trip.nights === 0;
  const headlineText = sameDay
    ? t("daytrip_onsite", { dur: formatDuration(trip.onSiteMin ?? 0) })
    : t("daytrip_travel", { dur: formatDuration(trip.travelMin) });
  const head = el("div", { class: "daytrip-head" }, [
    favStarEl(route, ctx),
    stationNameEl("dest-name", trip.destination, ctx.label(trip.destination)),
    // Rows on a city's page differ by start day, so it always leads.
    ...(opts.showDate
      ? [el("span", { class: "daytrip-date", text: ctx.formatDate(trip.outbound.date) })]
      : []),
    ...(sameDay
      ? []
      : [
          el("span", { class: "daytrip-travel muted" }, [
            el("bdi", { text: t("getaway_nights", { n: trip.nights }) }),
          ]),
        ]),
    el("span", {
      class: "chip chip-onsite",
      text: headlineText,
      attrs: { title: sameDay ? t("daytrip_onsite_hint") : t("getaway_nights_hint") },
    }),
  ]);
  // One action row for the whole card, after both legs. Every button therefore acts
  // on the round trip: the calendar export writes an event per leg, the map draws the
  // route (identical either way), and Save stores the pair as one trip.
  const actions = el("div", { class: "journey-sub daytrip-actions" }, [
    el(
      "button",
      {
        class: "btn btn-ghost",
        type: "button",
        on: {
          click: () => {
            ctx.onIcs(trip.outbound);
            ctx.onIcs(trip.back);
          },
        },
      },
      [icon(I.cal), el("span", { text: t("act_ics") })],
    ),
    el(
      "button",
      { class: "btn btn-ghost", type: "button", on: { click: () => ctx.onShowJourney(trip.outbound) } },
      [icon(I.pin), el("span", { text: t("act_map") })],
    ),
    tripSaveBtn(trip.outbound, ctx, trip.back),
  ]);
  const open = (): void => ctx.onShowTrip(trip.outbound, trip.back);
  const article = el(
    "article",
    { class: "journey daytrip-card is-clickable", dataset: { station: trip.destination } },
    [
      el("div", { class: "journey-main" }, [
        head,
        journeyBodyEl(trip.outbound, ctx, t("daytrip_out")),
        journeyBodyEl(trip.back, ctx, t("daytrip_back")),
        actions,
      ]),
      el("div", { class: "journey-book" }, [
        el(
          "button",
          {
            class: "book-arrow",
            type: "button",
            attrs: {
              "aria-label": `${ctx.label(trip.destination)} — ${headlineText}`,
              title: t("act_next"),
            },
            on: { click: open },
          },
          [icon(I.arrow)],
        ),
      ]),
    ],
  );
  article.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("button, a")) return;
    open();
  });
  return article;
}

/**
 * The header above a result list: the result count on the left, a "Sort" picker on
 * the right. Selecting a key calls `onSort`, which re-renders the list in place.
 */
export function listToolbarEl(
  count: string,
  current: SortKey,
  options: { value: SortKey; label: string }[],
  onSort: (key: SortKey) => void,
): HTMLElement {
  const sel = el(
    "select",
    { class: "sort-select", attrs: { "aria-label": t("sort_label") } },
    options.map((o) => el("option", { value: o.value, text: o.label })),
  ) as HTMLSelectElement;
  // The sort key is kept across modes, but each list offers a different subset. If
  // the carried-over key isn't one of these options, applySort no-ops it (natural
  // "rec" order), so show that — not a stale label the list isn't actually using.
  const offered = options.some((o) => o.value === current);
  sel.value = offered ? current : (options[0]?.value ?? "rec");
  sel.addEventListener("change", () => onSort(sel.value as SortKey));
  return el("div", { class: "list-toolbar" }, [
    el("span", { class: "muted count", text: count }),
    el("label", { class: "sort-field" }, [
      el("span", { class: "sort-label muted small", text: `${t("sort_label")}:` }),
      sel,
    ]),
  ]);
}

/**
 * A ranked best-trip row ("best" mode). Shows the month-long train count for the
 * destination (like the "Where to?" list) plus, in the all-days view, how many
 * days it's reachable.
 */
export function bestTripRowEl(trip: BestTrip, ctx: RenderCtx, trains?: number): HTMLElement {
  const chips: HTMLElement[] = [];
  if (trains != null && trains > 0) {
    chips.push(
      el("span", {
        class: "stat-chip",
        text: t("badge_trains", { n: trains }),
        attrs: { title: t("stat_window_hint", { trains, days: trip.days ?? 0 }) },
      }),
    );
  }
  if (trip.days != null) {
    chips.push(
      el("span", {
        class: "chip chip-soft month-chip",
        text: t("ideas_days", { n: trip.days }),
        attrs: { title: t("ideas_days_hint", { n: trip.days }) },
      }),
    );
  }
  const extra = chips.length ? el("span", { class: "row-chips" }, chips) : undefined;
  return reachTripRowEl(trip.destination, trip.journey, ctx, extra);
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
      stationNameEl("dest-name", station, ctx.label(station)),
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
 * A hidden-city ("hidden train") row: board at your origin, ride the free-MAX
 * ticket booked to a stop *past* your destination, and step off at your
 * destination. Shows your real origin → destination with the boarding and
 * calling-at times, tags the over-shoot stop you ticket to, and its Book link
 * deep-links the longer origin → beyond fare (the same départ).
 */
export function hiddenTrainRowEl(h: HiddenTrain, ctx: RenderCtx): HTMLElement {
  const b = h.book;
  const time = el("span", { class: "train-time" }, [
    el("strong", { text: b.depart }),
    icon(I.arrow),
    el("strong", { text: h.alight }),
    ...(h.alightMin >= 1440
      ? [el("span", { class: "day-offset", text: t("lbl_dayoffset", { n: Math.floor(h.alightMin / 1440) }) })]
      : []),
  ]);
  const route = el("div", { class: "leg-route" }, [
    stationNameEl("", h.origin, ctx.label(h.origin)),
    icon(I.arrow),
    stationNameEl("", h.destination, ctx.label(h.destination)),
  ]);
  const meta = el("span", { class: "train-meta" }, [
    icon(I.clock),
    el("bdi", { text: formatDuration(h.durationMin) }),
    el("span", { class: "train-no", text: t("lbl_train", { no: b.trainNo }) }),
    ...(b.axe ? [el("span", { class: "train-axe", text: b.axe })] : []),
  ]);
  const head = el("div", { class: "journey-head" }, [
    el("span", { class: "chip chip-hidden", text: t("hidden_chip") }),
    el("span", { class: "journey-total" }, [icon(I.clock), el("span", { text: formatDuration(h.durationMin) })]),
  ]);
  // The ticket you actually buy runs origin → beyond; you alight early at your
  // destination. Spell that out so the over-shoot is never a surprise.
  const note = el("p", {
    class: "hidden-note muted small",
    text: t("hidden_row_note", { beyond: ctx.label(h.beyond), stop: ctx.label(h.destination) }),
  });
  const actions = el("div", { class: "actions" }, [
    // Book the longer origin → beyond fare (the same départ time as your ride).
    el(
      "a",
      {
        class: "btn btn-book",
        href: ctx.bookUrl(h.origin, h.beyond, b.date, b.depart),
        attrs: { target: "_blank", rel: "noopener noreferrer" },
      },
      [
        el("span", { text: t("hidden_book", { beyond: ctx.label(h.beyond) }) }),
        icon(I.external),
        el("span", { class: "sr-only", text: t("link_newtab") }),
      ],
    ),
  ]);
  const legs = el("div", { class: "legs" }, [el("div", { class: "leg" }, [route, el("div", { class: "train-row" }, [time, meta])])]);
  return el("article", { class: "journey journey-hidden" }, [head, legs, note, actions]);
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
  opts?: { title?: string; count?: (n: number) => string; showCount?: boolean; countLegend?: string },
): HTMLElement {
  const countText = opts?.count ?? ((n: number) => t("badge_trains", { n }));
  const showCount = opts?.showCount !== false;
  // What the per-cell number means (trains on a route, or destinations per day).
  const countLegend = opts?.countLegend ?? t("cal_legend_count");
  const headingId = `cal-h-${++uidSeq}`;
  // role=grid + aria-labelledby ties the day cells to their heading so the widget
  // announces as a labelled date grid (mirrors the form's dp-grid, which is a single
  // Tab stop with roving arrow focus rather than ~30 individual Tab stops).
  const grid = el("div", { class: "cal-grid", attrs: { role: "grid", "aria-labelledby": headingId } });
  // Arrow-key navigation: move focus between day cells (←/→ a day, ↑/↓ a row,
  // Home/End to the ends). The grid is a linear sequence of days, so the row size
  // is read live from the layout (10 columns on desktop, 7 on phones). Focus roves
  // via tabindex so only the current cell is in the Tab order.
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
    const dest = cells[Math.max(0, Math.min(cells.length - 1, target))];
    if (!dest) return;
    for (const cell of cells) cell.setAttribute("tabindex", "-1");
    dest.setAttribute("tabindex", "0");
    dest.focus();
  });
  const first = days[0]?.date ?? "";
  const leading = first ? (new Date(`${first}T00:00:00`).getDay() + 6) % 7 : 0;
  for (let i = 0; i < leading; i++) grid.append(el("span", { class: "cal-blank", attrs: { "aria-hidden": "true" } }));
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
          // The per-cell metric (hours on site / nights / destinations) is the point of
          // the strip, so it must be IN the accessible name — the visual count badge is
          // aria-hidden, so an AT user would otherwise hear only "available" on every cell.
          "aria-label": `${ctx.formatDate(d.date)} — ${d.available ? countText(d.count) : status}`,
          role: "gridcell",
          tabindex: "-1",
          ...(sel ? { "aria-current": "date" } : {}),
        },
        on: { click: () => ctx.onSelectDay(d.date) },
      },
      [
        el("span", { class: "cal-day", text: d.date.slice(8, 10) }),
        // A tiny per-day count, shown only where it's exact (route / return strips).
        ...(showCount && d.available && d.count > 0
          ? [el("span", { class: "cal-count", text: String(d.count), attrs: { "aria-hidden": "true" } })]
          : []),
      ],
    );
    grid.append(cell);
  }
  // One Tab stop with roving focus inside (arrows): only the entry cell is tabbable —
  // the selected day, else the first available, else the first cell.
  (grid.querySelector<HTMLElement>(".cal-cell.sel") ??
    grid.querySelector<HTMLElement>(".cal-cell.ok") ??
    grid.querySelector<HTMLElement>(".cal-cell"))?.setAttribute("tabindex", "0");
  const legend = [
    t("cal_legend"),
    ...(showCount ? [countLegend] : []),
    ...(anyNearby ? [t("cal_legend_nearby")] : []),
    ...(anyBoth ? [t("cal_legend_nearby_both")] : []),
  ].join(" · ");
  const dowHead = el("div", { class: "cal-dow-head", attrs: { "aria-hidden": "true" } });
  const refMonday = first ? addDays(first, -leading) : "";
  for (let i = 0; i < 7; i++)
    dowHead.append(el("span", { class: "cal-dow-c", text: refMonday ? ctx.formatWeekday(addDays(refMonday, i)) : "" }));
  return el("section", { class: "calendar" }, [
    el("h3", { text: opts?.title ?? t("cal_title"), attrs: { id: headingId } }),
    dowHead,
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

/**
 * The whole trip on one page: a single journey (one-way) or a round trip
 * (outbound + inbound) with a title, a nights/total-travel summary, each leg as a
 * full bookable journey card, and a Save button. Used in the trip modal and shown
 * when a getaway row or a saved trip is opened.
 */
export function tripViewEl(outbound: Journey, ctx: RenderCtx, inbound?: Journey): HTMLElement {
  const round = Boolean(inbound);
  const title = `${ctx.label(outbound.origin)} ${round ? "⇄" : "→"} ${ctx.label(outbound.destination)}`;
  const totalTravel = outbound.totalDurationMin + (inbound?.totalDurationMin ?? 0);
  let summary: string;
  if (inbound) {
    const nights = dayIndex(inbound.date) - dayIndex(outbound.date);
    if (nights > 0) {
      summary = t("trip_summary", { n: nights, dur: formatDuration(totalTravel) });
    } else {
      // Same-day round trip: surface how long you actually get in the city. Use the
      // outbound's ABSOLUTE arrival (departMin + span), not the last leg's own-date
      // arriveMin, so a connecting outbound isn't credited with bogus extra hours.
      const onSite = Math.max(0, inbound.departMin - (outbound.departMin + outbound.totalDurationMin));
      summary = t("trip_summary_day", { onsite: formatDuration(onSite), dur: formatDuration(totalTravel) });
    }
  } else {
    summary = t("trip_summary_oneway", { date: ctx.formatDate(outbound.date), dur: formatDuration(totalTravel) });
  }
  // Build the container first so both legs can share it as their selection group:
  // clicking one leg highlights it and clears the other, even though they sit in
  // separate sections. `onPick` is a no-op — the highlight is the whole point, and
  // it avoids journeyEl's default click (which would scroll to the map behind the modal).
  // The trip's date(s) — important when the row that opened this came from a
  // flexible search (the start day varies). One-ways already show the date in the
  // summary, so this is just for round trips.
  const dateLine = inbound
    ? inbound.date !== outbound.date
      ? `${ctx.formatDate(outbound.date)} – ${ctx.formatDate(inbound.date)}`
      : ctx.formatDate(outbound.date)
    : null;
  const view = el("div", { class: "trip-view" });
  const pickOpts = { saveable: false, group: view, onPick: () => {}, hideMap: true };
  view.append(
    el("h2", { class: "modal-title trip-title", text: title }),
    ...(dateLine ? [el("p", { class: "trip-dates", text: dateLine })] : []),
    el("p", { class: "muted trip-summary", text: summary }),
    el("section", { class: "trip-leg" }, [
      ...(round ? [el("h3", { class: "trip-leg-title", text: t("rt_outbound") })] : []),
      journeyEl(outbound, ctx, pickOpts),
    ]),
    ...(inbound
      ? [
          el("section", { class: "trip-leg" }, [
            el("h3", { class: "trip-leg-title", text: t("rt_inbound") }),
            journeyEl(inbound, ctx, pickOpts),
          ]),
        ]
      : []),
    // Save the trip + a travel guide for the destination city (what to do once there).
    el("div", { class: "trip-view-actions" }, [
      tripSaveBtn(outbound, ctx, inbound),
      guideButtonEl(ctx, outbound.destination),
    ]),
  );
  return view;
}

/**
 * One leg of a multi-city recap: the requested hop plus the chosen journey, or
 * `null` when that hop has no free MAX seat. Carrying the null (instead of dropping
 * the leg) lets the recap show the trip honestly as incomplete.
 */
export interface RecapLeg {
  from: string;
  to: string;
  date: string;
  journey: Journey | null;
}

export function multiTripViewEl(legs: RecapLeg[], ctx: RenderCtx): HTMLElement {
  const stops = legs.length ? [legs[0]!.from, ...legs.map((l) => l.to)] : [];
  const title = stops.map((s) => ctx.label(s)).join(" → ");
  const totalTravel = legs.reduce((sum, l) => sum + (l.journey?.totalDurationMin ?? 0), 0);
  const incomplete = legs.some((l) => !l.journey);
  const view = el("div", { class: "trip-view" }, [
    el("h2", { class: "modal-title trip-title", text: title }),
    el("p", { class: "muted trip-summary" }, [
      icon(I.clock),
      el("span", { text: formatDuration(totalTravel) }),
    ]),
  ]);
  // A leg with no seat can't just vanish — call the whole itinerary out as incomplete
  // so an N-1-leg chain isn't presented as a finished trip.
  if (incomplete) view.append(el("p", { class: "notice trip-incomplete", text: t("multi_incomplete") }));
  legs.forEach((leg) => {
    view.append(
      el("section", { class: "trip-leg" }, [
        el("h3", { class: "trip-leg-title" }, [
          el("bdi", { text: ctx.label(leg.from) }),
          el("span", { class: "muted", text: " → " }),
          el("bdi", { text: ctx.label(leg.to) }),
        ]),
        leg.journey
          ? journeyEl(leg.journey, ctx, { saveable: false, hideMap: true })
          : emptyEl(`${t("res_none")} · ${ctx.formatDate(leg.date)}`),
      ]),
    );
  });
  return view;
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
  // Build the article first so each leg can share it as a selection group: clicking
  // a leg highlights only that one across the whole tour (not one per day band).
  const article = el("article", { class: "tour" });
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
      journeyEl(j, ctx, { group: article }),
    ]);
  });
  article.append(
    el("div", { class: "tour-top" }, [head, tourSaveBtn(tour, ctx)]),
    el("div", { class: "tour-legs" }, legs),
  );
  return article;
}

/** A Save button for a whole multi-city tour (mirrors the journey Save button). */
function tourSaveBtn(tour: Tour, ctx: RenderCtx): HTMLElement {
  const saved = (): boolean => ctx.isTourSaved(tour);
  const lbl = el("span", { text: saved() ? t("act_saved") : t("act_save") });
  const btn = el(
    "button",
    {
      class: saved() ? "btn btn-ghost tour-save is-saved" : "btn btn-ghost tour-save",
      type: "button",
      attrs: { "aria-pressed": String(saved()), title: saved() ? t("act_unsave") : t("act_save") },
      on: {
        click: () => {
          ctx.onToggleTour(tour);
          const now = saved();
          btn.classList.toggle("is-saved", now);
          btn.setAttribute("aria-pressed", String(now));
          btn.title = now ? t("act_unsave") : t("act_save");
          lbl.textContent = now ? t("act_saved") : t("act_save");
        },
      },
    },
    [icon(I.bookmark), lbl],
  );
  return btn;
}

export function emptyEl(message: string): HTMLElement {
  return el("p", { class: "empty", text: message });
}

/** A muted "things to try" hint shown under a no-results message. */
export function hintEl(text: string): HTMLElement {
  return el("p", { class: "empty-hint muted", text });
}
