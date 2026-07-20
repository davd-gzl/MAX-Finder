import type { SearchMode } from "../types";
import type { ConnectionOptions } from "../core/connections";
import { el, clear, optionEl, isTouch } from "./dom";
import { t, getLang } from "../i18n";
import { addDays, dayIndex } from "../util/time";

export type TripType = "simple" | "multi" | "ideas";

/** The date-picker control returned by makeDateField. */
export interface DateFieldCtl {
  root: HTMLElement;
  input: HTMLInputElement;
  getMargin(): number;
  setMargin(n: number): void;
  setRange(on: boolean): void;
  setDate(date: string): void;
  setDates(out: string, ret: string): void;
  getReturn(): string;
  refresh(): void;
  /** Close the popover, drop its document/window listeners, and remove it from the DOM. */
  destroy(): void;
}

/** One multi-city leg row. */
export interface LegCtl {
  from: HTMLInputElement;
  to: HTMLInputElement;
  dateCtl: DateFieldCtl;
  row: HTMLElement;
  remove: HTMLElement;
}

/** Raw text values of a leg row, resolved by the controller. */
export interface LegValues {
  from: string;
  to: string;
  date: string;
}

/** Every form-bound element the controller reads from / writes to. */
export interface FormRefs {
  modeTabs: HTMLElement;
  ideasBtn: HTMLElement;
  origin: HTMLInputElement;
  destination: HTMLInputElement;
  date: HTMLInputElement;
  dateField: HTMLElement;
  departDate: DateFieldCtl;
  legsBlock: HTMLElement;
  surpriseBtn: HTMLElement;
  endDate: HTMLInputElement;
  endDateField: HTMLElement;
  departAfter: HTMLInputElement;
  departBefore: HTMLInputElement;
  arriveBefore: HTMLInputElement;
  maxDuration: HTMLInputElement;
  maxSpanDays: HTMLInputElement;
  maxSpanDaysField: HTMLElement;
  radius: HTMLInputElement;
  radiusField: HTMLElement;
  hidden: HTMLInputElement;
  hiddenField: HTMLElement;
  trainType: HTMLSelectElement;
  maxConnections: HTMLSelectElement;
  overnight: HTMLInputElement;
  night: HTMLInputElement;
  onlyNight: HTMLInputElement;
  onlyNightField: HTMLElement;
  roundTrip: HTMLInputElement;
  nights: HTMLSelectElement;
  stayHours: HTMLInputElement;
  stayHoursField: HTMLElement;
  lateReturn: HTMLInputElement;
  roundTripField: HTMLElement;
  roundTripOpts: HTMLElement;
  via: HTMLInputElement;
  originField: HTMLElement;
  destinationField: HTMLElement;
  viaField: HTMLElement;
  maxDurationField: HTMLElement;
  trainTypeField: HTMLElement;
  region: HTMLSelectElement;
  regionField: HTMLElement;
  cities: HTMLInputElement;
  citiesField: HTMLElement;
  tourCount: HTMLInputElement;
  tourCountField: HTMLElement;
  cityChips: HTMLElement;
  minDays: HTMLInputElement;
  maxDays: HTMLInputElement;
  stayField: HTMLElement;
  maxKm: HTMLInputElement;
  maxLegKm: HTMLInputElement;
  maxKmField: HTMLElement;
  maxLegDuration: HTMLInputElement;
  maxLegDurationField: HTMLElement;
  minLegDuration: HTMLInputElement;
  minLegDurationField: HTMLElement;
}

/** Data providers and action callbacks; the form holds no app logic of its own. */
export interface FormProps {
  stationLabels: string[];
  regions: string[];
  today: string;
  bookingWindowDays: number;
  maxTourFill: number;
  overnightMaxConnectionMin: number;
  jeuneUrl: string;
  seniorUrl: string;
  resolveStation: (text: string) => string | undefined;
  stationLabel: (id: string) => string;
  mode: () => SearchMode;
  formatDate: (iso: string) => string;
  formatWeekday: (iso: string) => string;
  availabilityFor: (
    o: string | undefined,
    d: string | undefined,
    kind: "out" | "ret",
    dates: string[],
    opts: ConnectionOptions,
  ) => Map<string, number>;
  onSwitchTab: (trip: TripType) => void;
  onMultiMode: (mode: "plan" | "legs") => void;
  onSubmit: () => void;
  onSurprise: () => void;
  onNearest: () => void;
}

/** The form element plus the imperative surface the controller drives. */
export interface FormHandle {
  form: HTMLElement;
  refs: FormRefs;
  getTourCities(): string[];
  setTourCities(ids: string[]): void;
  clearCities(): void;
  getLegValues(): LegValues[];
  setLegs(legs: LegValues[]): void;
  /** Set one leg row's date (used when a date is picked from the results calendar). */
  setLegDate(index: number, date: string): void;
  setActiveTab(trip: TripType): void;
  getMultiMode(): "plan" | "legs";
  setMultiMode(mode: "plan" | "legs"): void;
  updateFieldVisibility(trip: TripType): void;
  refreshTourEndDate(): void;
  setSurpriseMsg(text: string): void;
  /** Tear down date-picker popovers (which live in <body>) before the form is discarded. */
  destroy(): void;
}

const FLEX_MAX = 7;

/**
 * A bare form <input> (accessible name comes from the wrapping field label).
 * @param type the input type.
 * @param list optional datalist id.
 * @returns the input element.
 */
function inputEl(type: string, list?: string): HTMLInputElement {
  const i = el("input", { class: "input", type }) as HTMLInputElement;
  if (list) i.setAttribute("list", list);
  return i;
}

/**
 * Wrap a control in a labelled field.
 * @param label the field label.
 * @param control the control element.
 * @returns the labelled field element.
 */
function field(label: string, control: HTMLElement): HTMLElement {
  return el("label", { class: "field" }, [
    el("span", { class: "field-label", text: label, attrs: { title: label } }),
    control,
  ]);
}

/**
 * A text field with a clear "×" button (shown only when there is text). Clearing
 * fires input+change so validation and dependent fields re-sync.
 * @param label the field label.
 * @param input the text input to wrap.
 * @returns the labelled field element.
 */
function clearableField(label: string, input: HTMLInputElement): HTMLElement {
  input.classList.add("has-clear");
  const clearBtn = el("button", {
    class: "input-clear",
    type: "button",
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
 * Append a hover/focus-revealed keyboard-shortcut badge to a button.
 * @param btn the button to badge.
 * @param key the shortcut key label.
 * @returns the same button.
 */
function withShortcut(btn: HTMLElement, key: string): HTMLElement {
  btn.classList.add("has-kbd");
  btn.append(el("kbd", { class: "kbd-hint", text: key, attrs: { "aria-hidden": "true" } }));
  return btn;
}

/**
 * Build the search form and its imperative control surface.
 * @param props data providers and action callbacks.
 * @returns the form element plus the handle the controller drives.
 */
export function createForm(props: FormProps): FormHandle {
  const { today, bookingWindowDays } = props;
  const lastBookable = addDays(today, bookingWindowDays - 1);
  const bookableDays = (): string[] => Array.from({ length: bookingWindowDays }, (_, i) => addDays(today, i));

  let tourCities: string[] = [];
  let legRows: LegCtl[] = [];
  let legsContainer: HTMLElement | null = null;
  let bodyAnim: Animation | null = null;
  let firstViz = true;
  // The Multi-city tab hosts two surfaces: "plan" (pick cities, auto-order + date
  // them, Surprise / Nearest) and "legs" (spell out each hop). Tracked here so the
  // controller can read which one is active and lay the fields out for it.
  let multiMode: "plan" | "legs" = "legs";
  let currentTrip: TripType = "simple";

  /** Availability search options taken from the current form inputs. */
  function popoverOpts(): ConnectionOptions {
    return {
      maxConnections: Number(maxConnections.value) || 0,
      departAfter: departAfter.value || undefined,
      departBefore: departBefore.value || undefined,
      arriveBefore: arriveBefore.value || undefined,
      ...(night.checked ? {} : { excludeNight: true }),
      ...(night.checked && onlyNight.checked ? { onlyNight: true } : {}),
      ...(overnight.checked ? { maxConnectionMin: props.overnightMaxConnectionMin } : {}),
    };
  }

  /**
   * A calendar-backed date field (single date, or a departure→return range).
   * @param label the field label.
   * @param routeFn resolves the current origin/destination for availability.
   * @param bare omit the field label wrapper (used inside a leg row).
   * @returns the date-picker control.
   */
  function makeDateField(label: string, routeFn?: () => { o?: string; d?: string }, bare = false): DateFieldCtl {
    const route = routeFn ?? (() => ({ o: props.resolveStation(origin.value), d: props.resolveStation(destination.value) }));
    const days = bookableDays();
    const input = inputEl("date");
    input.min = today;
    input.max = lastBookable;
    input.classList.add("dp-native");

    let margin = 0;
    let isOpen = false;
    let range = false;
    let retDate = "";
    let awaitReturn = false;
    let avail = new Map<string, number>();
    const fmtShort = (d: string): string =>
      new Intl.DateTimeFormat(getLang(), { day: "numeric", month: "short" }).format(new Date(`${d}T00:00:00`));
    const phase = (): "out" | "ret" => (range && awaitReturn ? "ret" : "out");

    const valueText = el("span", { class: "dp-value-text" });
    const valueBadge = el("span", { class: "dp-value-badge", attrs: { hidden: "" } });
    const trigger = el(
      "button",
      { class: "dp-trigger input", type: "button", attrs: { "aria-haspopup": "dialog", "aria-expanded": "false" } },
      [valueText, valueBadge],
    );

    const marginVal = el("span", { class: "dp-margin-val", text: "0" });
    const marginMinus = el("button", { class: "dp-step", type: "button", text: "−", attrs: { "aria-label": "−1" } });
    const marginPlus = el("button", { class: "dp-step", type: "button", text: "+", attrs: { "aria-label": "+1" } });
    const marginRow = el("div", { class: "dp-margin" }, [
      el("span", { class: "dp-margin-label muted", text: t("field_flex") }),
      el("div", { class: "dp-margin-ctl" }, [
        marginMinus,
        el("span", { class: "dp-margin-box" }, [
          el("span", { class: "muted", text: "±" }),
          marginVal,
          el("span", { class: "muted", text: ` ${t("flex_days")}` }),
        ]),
        marginPlus,
      ]),
    ]);

    const dow = el("div", { class: "dp-dow" });
    const grid = el("div", { class: "dp-grid" });
    const legend = el("p", { class: "dp-legend muted" });
    const pop = el("div", {
      class: "datepop",
      // A named, modal dialog so assistive tech announces it; focus is moved inside
      // on open (below) since, appended at the end of <body>, it's outside the
      // trigger's natural Tab order.
      attrs: { role: "dialog", "aria-modal": "true", "aria-label": label, hidden: "" },
    }, [marginRow, dow, grid, legend]);
    const wrap = el("div", { class: "datefield" }, [trigger, input]);
    const root = bare ? wrap : field(label, wrap);
    document.body.append(pop);

    const leading = (new Date(`${today}T00:00:00`).getDay() + 6) % 7;
    const refMonday = addDays(today, -leading);
    for (let i = 0; i < 7; i++) dow.append(el("span", { class: "dp-dow-c", text: props.formatWeekday(addDays(refMonday, i)) }));

    const setLabel = (): void => {
      if (range) {
        const a = input.value ? fmtShort(input.value) : t("field_depart");
        const b = retDate ? fmtShort(retDate) : t("field_ret");
        valueText.textContent = `${a} → ${b}`;
      } else {
        valueText.textContent = input.value ? props.formatDate(input.value) : t("field_date");
      }
      if (margin > 0) {
        valueBadge.textContent = `±${margin}`;
        valueBadge.removeAttribute("hidden");
      } else {
        valueBadge.setAttribute("hidden", "");
      }
    };

    const pick = (date: string): void => {
      // paint()/refresh() rebuild every cell, so a keyboard user's focus would fall to
      // <body>. Put it back: on the day just picked while the popover stays open, on
      // the trigger once it closes. Only when focus was inside — a mouse pick must not
      // steal it.
      const hadFocus = pop.contains(document.activeElement);
      if (range) {
        if (awaitReturn && date >= input.value) {
          retDate = date;
          awaitReturn = false;
          setLabel();
          paint();
          input.dispatchEvent(new Event("change", { bubbles: true }));
          close();
          if (hadFocus) trigger.focus();
          return;
        }
        input.value = date;
        retDate = "";
        awaitReturn = true;
        setLabel();
        input.dispatchEvent(new Event("change", { bubbles: true }));
        refresh();
        if (hadFocus) focusDay(date);
        return;
      }
      input.value = date;
      setLabel();
      paint();
      input.dispatchEvent(new Event("change", { bubbles: true }));
      close();
      if (hadFocus) trigger.focus();
    };

    const paint = (): void => {
      clear(grid);
      for (let i = 0; i < leading; i++) grid.append(el("span", { class: "dp-cell dp-blank" }));
      const out = input.value;
      const outIdx = out ? dayIndex(out) : -1;
      const retIdx = retDate ? dayIndex(retDate) : -1;
      const picking = range && awaitReturn;
      const known = avail.size > 0;
      let anyOk = false;
      for (const date of days) {
        const di = dayIndex(date);
        const before = picking && di < outIdx;
        const ok = !before && (avail.get(date) ?? 0) > 0;
        if (ok) anyOk = true;
        const isSel = date === out || (range && date === retDate);
        const inRange = range && outIdx >= 0 && retIdx >= 0 && di > outIdx && di < retIdx;
        const nearOut = margin > 0 && outIdx >= 0 && Math.abs(di - outIdx) <= margin;
        const nearRet = range && margin > 0 && retIdx >= 0 && Math.abs(di - retIdx) <= margin;
        const inWin = !isSel && !inRange && (nearOut || nearRet);
        const cls = [
          "dp-cell",
          ok ? "ok" : before || known ? "no" : "",
          isSel ? "sel" : "",
          inRange ? "range" : "",
          inWin ? "win" : "",
        ]
          .filter(Boolean)
          .join(" ");
        grid.append(
          el("button", {
            class: cls,
            type: "button",
            text: date.slice(8, 10),
            attrs: {
              "aria-label": props.formatDate(date),
              "data-date": date,
              tabindex: "-1",
              ...(isSel ? { "aria-current": "date" } : {}),
            },
            on: { click: () => pick(date) },
          }),
        );
      }
      // The grid is one Tab stop with roving focus inside (arrows), so Tab doesn't have
      // to walk ~90 day cells: only the entry cell is tabbable.
      (grid.querySelector<HTMLElement>(".dp-cell.sel") ??
        grid.querySelector<HTMLElement>(".dp-cell.ok") ??
        grid.querySelector<HTMLElement>("button.dp-cell"))?.setAttribute("tabindex", "0");
      legend.textContent = margin > 0 ? t("datepick_window") : anyOk ? t("cal_legend") : "";
    };

    const refresh = (): void => {
      const r = route();
      avail = props.availabilityFor(r.o, r.d, phase(), days, popoverOpts());
      paint();
    };

    const onDocClick = (e: MouseEvent): void => {
      const n = e.target as Node;
      if (!wrap.contains(n) && !pop.contains(n)) close();
    };
    const place = (): void => {
      const r = trigger.getBoundingClientRect();
      const w = pop.offsetWidth;
      let left = r.left;
      if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - w);
      pop.style.top = `${Math.round(r.bottom + 6)}px`;
      pop.style.left = `${Math.round(left)}px`;
    };
    function close(): void {
      if (!isOpen) return;
      isOpen = false;
      pop.setAttribute("hidden", "");
      trigger.setAttribute("aria-expanded", "false");
      document.removeEventListener("click", onDocClick, true);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    }
    const openPop = (): void => {
      isOpen = true;
      refresh();
      pop.removeAttribute("hidden");
      place();
      trigger.setAttribute("aria-expanded", "true");
      document.addEventListener("click", onDocClick, true);
      window.addEventListener("scroll", place, true);
      window.addEventListener("resize", place);
      // Move focus inside so keyboard users land on the calendar (it sits outside the
      // trigger's Tab order): the selected day, else the first bookable one, else the
      // first cell. Escape returns focus to the trigger.
      const cells = Array.from(grid.querySelectorAll<HTMLElement>("button.dp-cell"));
      (grid.querySelector<HTMLElement>(".dp-cell.sel") ??
        grid.querySelector<HTMLElement>(".dp-cell.ok") ??
        cells[0])?.focus();
    };
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      isOpen ? close() : openPop();
    });
    pop.addEventListener("click", (e) => e.stopPropagation());
    // Roving focus across the day grid: arrows move a day at a time (±7 for a week),
    // Home/End jump to the ends. Enter/Space activate the focused cell (native button
    // behaviour). Escape closes and returns focus to the trigger.
    const dayCells = (): HTMLElement[] => Array.from(grid.querySelectorAll<HTMLElement>("button.dp-cell"));
    const focusCell = (cells: HTMLElement[], i: number): void => {
      const clamped = Math.max(0, Math.min(cells.length - 1, i));
      const target = cells[clamped];
      if (!target) return;
      for (const c of cells) c.setAttribute("tabindex", "-1");
      target.setAttribute("tabindex", "0");
      target.focus();
    };
    function focusDay(date: string): void {
      const cells = dayCells();
      const i = cells.findIndex((c) => c.getAttribute("data-date") === date);
      if (i >= 0) focusCell(cells, i);
    }
    pop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        close();
        trigger.focus();
        return;
      }
      // aria-modal hides the rest of the page from assistive tech, so Tab must not be
      // able to leave the dialog (it sits last in <body>, i.e. Tab would exit the page).
      if (e.key === "Tab") {
        const stops = Array.from(pop.querySelectorAll<HTMLElement>("button:not([disabled])")).filter(
          (b) => !b.classList.contains("dp-cell") || b.getAttribute("tabindex") === "0",
        );
        if (stops.length === 0) return;
        const first = stops[0]!;
        const last = stops[stops.length - 1]!;
        const active = document.activeElement as HTMLElement | null;
        const leavingBack = e.shiftKey && (active === first || !pop.contains(active));
        const leavingFwd = !e.shiftKey && (active === last || !pop.contains(active));
        if (leavingBack || leavingFwd) {
          e.preventDefault();
          (leavingBack ? last : first).focus();
        }
        return;
      }
      const nav: Record<string, number | "home" | "end"> = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -7,
        ArrowDown: 7,
        Home: "home",
        End: "end",
      };
      if (!(e.key in nav)) return;
      const cells = dayCells();
      if (cells.length === 0) return;
      const cur = cells.indexOf(document.activeElement as HTMLElement);
      const step = nav[e.key]!;
      e.preventDefault();
      if (step === "home") focusCell(cells, 0);
      else if (step === "end") focusCell(cells, cells.length - 1);
      else focusCell(cells, (cur < 0 ? 0 : cur) + step);
    });
    grid.addEventListener("mouseover", (e) => {
      if (!range || !awaitReturn) return;
      const cell = (e.target as HTMLElement).closest<HTMLElement>(".dp-cell");
      const hover = cell?.getAttribute("data-date");
      if (!hover) return;
      const outIdx = dayIndex(input.value);
      const hi = dayIndex(hover);
      for (const c of Array.from(grid.children) as HTMLElement[]) {
        const cd = c.getAttribute("data-date");
        c.classList.toggle("preview", Boolean(cd) && hi >= outIdx && dayIndex(cd!) > outIdx && dayIndex(cd!) <= hi);
      }
    });
    grid.addEventListener("mouseleave", () => {
      for (const c of Array.from(grid.children) as HTMLElement[]) c.classList.remove("preview");
    });

    const setMarginVal = (n: number): void => {
      margin = Math.max(0, Math.min(FLEX_MAX, Math.floor(Number.isFinite(n) ? n : 0)));
      marginVal.textContent = String(margin);
      setLabel();
      if (isOpen) paint();
    };
    marginMinus.addEventListener("click", (e) => {
      e.stopPropagation();
      setMarginVal(margin - 1);
    });
    marginPlus.addEventListener("click", (e) => {
      e.stopPropagation();
      setMarginVal(margin + 1);
    });

    setLabel();

    return {
      root,
      input,
      getMargin: () => margin,
      setMargin: (n) => setMarginVal(n),
      setRange: (on) => {
        range = on;
        if (!on) retDate = "";
        awaitReturn = false;
        setLabel();
        if (isOpen) refresh();
      },
      setDate: (d) => {
        input.value = d;
        setLabel();
        if (isOpen) paint();
      },
      setDates: (out, ret) => {
        input.value = out;
        retDate = range ? ret : "";
        awaitReturn = false;
        setLabel();
        if (isOpen) refresh();
      },
      getReturn: () => retDate,
      refresh,
      destroy: () => {
        close(); // detaches the document-click + window scroll/resize listeners
        pop.remove(); // and take the popover out of <body> so it can't leak
      },
    };
  }

  /**
   * Build one multi-city leg row.
   * @param fromVal initial origin label.
   * @param toVal initial destination label.
   * @param dateVal initial date (YYYY-MM-DD).
   * @returns the leg control.
   */
  function makeLeg(fromVal = "", toVal = "", dateVal = ""): LegCtl {
    const from = inputEl("text", "station-list");
    const to = inputEl("text", "station-list");
    from.value = fromVal;
    to.value = toVal;
    from.placeholder = t("field_origin");
    to.placeholder = t("field_destination");
    for (const inp of [from, to]) {
      inp.addEventListener("input", () => inp.classList.remove("is-invalid"));
      inp.addEventListener("change", () => {
        const v = inp.value.trim();
        inp.classList.toggle("is-invalid", v !== "" && !props.resolveStation(v));
      });
    }
    const dateCtl = makeDateField(
      t("field_date"),
      () => ({ o: props.resolveStation(from.value), d: props.resolveStation(to.value) }),
      true,
    );
    if (dateVal) dateCtl.setDate(dateVal);
    const remove = el("button", {
      class: "mc-remove",
      type: "button",
      text: "×",
      attrs: { "aria-label": t("leg_remove"), title: t("leg_remove") },
    });
    const row = el("div", { class: "mc-leg" }, [from, to, dateCtl.root, remove]);
    const ctl: LegCtl = { from, to, dateCtl, row, remove };
    remove.addEventListener("click", () => removeLeg(ctl));
    to.addEventListener("change", () => {
      const id = props.resolveStation(to.value);
      const next = legRows[legRows.indexOf(ctl) + 1];
      if (next && id && !next.from.value.trim()) next.from.value = props.stationLabel(id);
    });
    return ctl;
  }

  function renderLegs(): void {
    if (!legsContainer) return;
    clear(legsContainer);
    const removable = legRows.length > 2;
    legRows.forEach((l) => {
      l.remove.style.display = removable ? "" : "none";
      legsContainer!.append(l.row);
    });
  }

  function addLeg(): void {
    const prev = legRows[legRows.length - 1];
    const id = prev ? props.resolveStation(prev.to.value) : undefined;
    legRows.push(makeLeg(id ? props.stationLabel(id) : ""));
    renderLegs();
  }

  function removeLeg(ctl: LegCtl): void {
    if (legRows.length <= 2) return;
    legRows = legRows.filter((l) => l !== ctl);
    ctl.dateCtl.destroy(); // its popover lives in <body>; drop it so it can't leak
    renderLegs();
  }

  function clearTripLegs(): void {
    for (const l of legRows) l.dateCtl.destroy();
    legRows = [makeLeg(), makeLeg()];
    renderLegs();
  }

  /** Render the tour "cities to visit" chips from the current selection. */
  function renderCityChips(): void {
    clear(cityChips);
    tourCities.forEach((id, i) => {
      const chip = el("span", { class: "city-chip" }, [
        el("span", { text: props.stationLabel(id) }),
        el("button", {
          class: "chip-x",
          type: "button",
          text: "×",
          attrs: { "aria-label": `${t("act_fav_remove")} — ${props.stationLabel(id)}` },
          on: {
            click: () => {
              tourCities.splice(i, 1);
              renderCityChips();
            },
          },
        }),
      ]);
      cityChips.append(chip);
    });
    clearCitiesBtn.toggleAttribute("hidden", tourCities.length === 0);
  }

  function clearCities(): void {
    if (tourCities.length === 0) return;
    tourCities = [];
    renderCityChips();
  }

  /** Box observers keeping each segmented control's pill placed; dropped on destroy. */
  const thumbObservers: ResizeObserver[] = [];

  /**
   * Give a segmented control the sliding pill the main trip tabs use: a thumb behind
   * the buttons that moves to whichever is active. Returns the resync function to
   * call when the active button changes. Measuring a hidden or detached control
   * yields zeros, so the thumb stays hidden until it can be placed, and the
   * transition is only armed once it has been.
   *
   * Visibility changes are watched rather than pushed: the form is display:none while
   * a drill-down is open, so syncFormFromQuery on Back measures zeros and the pill
   * would stay gone once the form came back. The same applies to the mobile form
   * sheet and to plain resizes — too many callers to notify reliably, so observe the
   * box instead.
   */
  function makeThumb(container: HTMLElement): () => void {
    const thumbEl = el("span", { class: "mode-tab-thumb", attrs: { "aria-hidden": "true" } });
    container.append(thumbEl);
    let animated = false;
    const sync = (): void => {
      const active = container.querySelector<HTMLElement>("button.active");
      if (!active?.offsetWidth) {
        container.classList.remove("has-thumb");
        return;
      }
      thumbEl.style.width = `${active.offsetWidth}px`;
      thumbEl.style.height = `${active.offsetHeight}px`;
      thumbEl.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
      container.classList.add("has-thumb");
      if (animated) return;
      animated = true;
      requestAnimationFrame(() => container.classList.add("animate-thumb"));
    };
    // The thumb is absolutely positioned, so resizing it can't feed back into the
    // container's box — no observer loop.
    if (typeof ResizeObserver === "function") {
      const ro = new ResizeObserver(() => sync());
      ro.observe(container);
      thumbObservers.push(ro);
    }
    return sync;
  }

  /** Resync of every switch control, replayed when `.checked` is set from outside. */
  const yesNoSyncs: (() => void)[] = [];
  function syncYesNoFields(): void {
    for (const s of yesNoSyncs) s();
  }
  let switchSeq = 0;

  /**
   * A boolean field as a compact toggle switch (role="switch"). It replaces the older
   * Yes/No pill pair: one control instead of two words, so it takes far less room. The
   * state is shown by the knob's POSITION (and a ✓/✕ glyph on it), never by colour
   * alone, so it stays legible without relying on the green/red accent. The backing
   * <input type="checkbox"> stays in the DOM as the value, so the controller keeps
   * reading `.checked` and every existing `change` listener keeps firing.
   */
  function yesNoField(label: string, input: HTMLInputElement, extraClass = ""): HTMLElement {
    // The checkbox is the value, never the control: the switch button carries the
    // semantics (role="switch" + aria-checked), so the checkbox is taken out of the
    // tab order and hidden from assistive tech rather than being announced twice.
    input.classList.add("switch-state");
    input.tabIndex = -1;
    input.setAttribute("aria-hidden", "true");
    const labelId = `sw-${(switchSeq += 1)}`;
    const knob = el("span", { class: "switch-knob", attrs: { "aria-hidden": "true" } });
    const track = el("span", { class: "switch-track", attrs: { "aria-hidden": "true" } }, [knob]);
    const toggle = el("button", {
      class: "switch",
      type: "button",
      attrs: { role: "switch", "aria-checked": "false", "aria-labelledby": labelId },
      on: {
        click: () => {
          if (input.disabled) return;
          input.checked = !input.checked;
          input.dispatchEvent(new Event("change", { bubbles: true }));
          sync();
        },
      },
    }, [track]);
    const root = el("div", { class: `field field-switch ${extraClass}`.trim() }, [
      el("span", { class: "field-label", text: label, attrs: { id: labelId, title: label } }),
      toggle,
      input,
    ]);
    // A control whose dependency is off stays on screen but inert: set `.disabled`
    // on the backing checkbox and the next resync greys the whole field out.
    function sync(): void {
      const on = input.checked;
      toggle.classList.toggle("is-on", on);
      toggle.setAttribute("aria-checked", String(on));
      (toggle as HTMLButtonElement).disabled = input.disabled;
      root.classList.toggle("is-disabled", input.disabled);
    }
    yesNoSyncs.push(sync);
    sync();
    return root;
  }

  function setActiveTab(trip: TripType): void {
    for (const btn of [...Array.from(modeTabs.children), ideasBtn] as HTMLElement[]) {
      if (!btn.dataset.trip) continue;
      const active = btn.dataset.trip === trip;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    }
    syncTabThumb();
  }

  /**
   * The tour "finish by" date only makes sense once the planner has a fixed finish,
   * so it appears the moment a destination is filled on the tour-plan surface, and
   * its lower bound tracks the start date (you can't arrive before you leave).
   */
  function refreshTourEndDate(): void {
    const show =
      currentTrip === "multi" && multiMode === "plan" && Boolean(props.resolveStation(destination.value));
    endDateField.style.display = show ? "" : "none";
    endDate.min = date.value || today; // can't finish before you leave
  }

  /** Reflect the active Multi-city sub-mode on its segmented toggle. */
  function setMultiMode(mode: "plan" | "legs"): void {
    multiMode = mode;
    for (const [btn, m] of [
      [legsTabBtn, "legs"],
      [planTabBtn, "plan"],
    ] as const) {
      const active = m === mode;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    }
    syncMultiThumb();
  }

  /** Whether the form currently names a full origin→destination route (both filled). */
  function hasOdRoute(): boolean {
    return Boolean(props.resolveStation(origin.value) && props.resolveStation(destination.value));
  }

  /**
   * Show/hide the fields for a trip type, morphing the white form body's height so
   * switching modes reshapes the card smoothly instead of jumping. The first call
   * (initial restore) and reduced-motion skip the animation.
   * @param trip the trip type to lay the form out for.
   */
  function updateFieldVisibility(trip: TripType): void {
    const animate =
      !firstViz &&
      formBody.isConnected &&
      typeof formBody.animate === "function" &&
      !(typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
    firstViz = false;
    if (!animate) {
      applyFieldVisibility(trip);
      return;
    }
    const first = formBody.getBoundingClientRect().height;
    applyFieldVisibility(trip);
    const last = formBody.getBoundingClientRect().height;
    if (Math.abs(first - last) < 1) return;
    bodyAnim?.cancel();
    formBody.style.overflow = "hidden";
    bodyAnim = formBody.animate([{ height: `${first}px` }, { height: `${last}px` }], {
      duration: 260,
      easing: "cubic-bezier(0.4, 0, 0.2, 1)",
    });
    const done = (): void => {
      formBody.style.overflow = "";
      bodyAnim = null;
    };
    void bodyAnim.finished.then(done, done);
  }

  function applyFieldVisibility(trip: TripType): void {
    currentTrip = trip;
    const multi = trip === "multi";
    const ideas = trip === "ideas";
    const simple = trip === "simple";
    const single = simple;
    // The Multi tab's two surfaces: "plan" the tour (cities) vs edit "legs" by hand.
    const plan = multi && multiMode === "plan";
    const legs = multi && multiMode === "legs";
    // Round trip is now a toggle on the Trip tab (and Ideas), not a separate tab; its
    // getaway options only apply while discovering (see syncRoundTripOpts).

    // A one-line description of what the active mode does, under the tabs.
    const descKey = multi
      ? plan
        ? "desc_multi_plan"
        : "desc_multi_legs"
      : ideas
        ? "desc_ideas"
        : "desc_simple";
    modeDesc.textContent = t(descKey);

    // The departure and start date belong to every surface except the legs editor,
    // where each leg row carries its own origin and date. Hide the whole départ/arrivée
    // wrapper in legs mode too, so its empty grid cell doesn't leave a phantom row-gap.
    odFields.style.display = legs ? "none" : "";
    originField.style.display = legs ? "none" : "";
    dateField.style.display = legs ? "none" : "";
    // Destination is an endpoint in single trips and the optional finish in a tour plan.
    destinationField.style.display = single || plan ? "" : "none";
    destination.placeholder = plan ? t("tour_end_ph") : single ? t("ph_anywhere") : "";
    origin.placeholder = single ? t("ph_anywhere") : "";
    // Swap only makes sense with two real endpoints (single trips). The "you can fill
    // just one" hint only applies to the simple tab, where a lone endpoint browses.
    swapBtn.style.display = single ? "" : "none";
    odHint.style.display = simple ? "" : "none";
    // A single outbound date now — the return day is picked from the results calendar
    // (od round trip) or derived from the stay length (getaway), never a range picker.
    departDate.setRange(false);

    // Sub-mode toggle + its two panels.
    multiSwitch.style.display = multi ? "" : "none";
    legsBlock.style.display = legs ? "" : "none";
    citiesField.style.display = plan ? "" : "none";
    stayField.style.display = plan ? "" : "none";
    maxKmField.style.display = plan ? "" : "none";
    maxLegDurationField.style.display = plan ? "" : "none";
    minLegDurationField.style.display = plan ? "" : "none";
    nearestBtn.style.display = plan ? "" : "none";
    refreshTourEndDate();

    viaField.style.display = single ? "" : "none";
    syncNightOpts();
    // Surprise randomizes a city/route; it means nothing in the manual legs editor.
    surpriseBtn.style.display = legs ? "none" : "";

    // A single journey caps its TOTAL time; a tour caps each hop instead (above).
    maxDurationField.style.display = multi ? "none" : "";

    // Region filters "Ideas" and focuses a tour plan ("visit Bretagne").
    regionField.style.display = ideas || plan ? "" : "none";
    maxSpanDaysField.style.display = single ? "" : "none";
    // Radius (nearby-station reach) applies to the single trip tabs. (The hidden-train
    // toggle lives in Advanced and shows on every tab, so it isn't gated here.)
    radiusField.style.display = single ? "" : "none";
    scopeField.style.display = single ? "" : "none";

    // The "Round trip" toggle rides the Trip tab and Ideas. Its getaway options only
    // show while discovering (no fixed destination); a known route uses the results
    // calendars, so they'd be redundant there. `discover`/`roundOn` gate that inside
    // syncRoundTripOpts.
    roundTripField.style.display = simple || ideas ? "" : "none";
    syncRoundTripOpts();
    // A hidden control measures as zero, so the pills can only be placed once their
    // control is on screen — reposition them after the display flags above. This is
    // also where a query-driven `.checked` (set without a `change` event) lands.
    syncMultiThumb();
    syncYesNoFields();
  }

  const stationList = el("datalist", { id: "station-list" });
  for (const label of props.stationLabels) stationList.append(el("option", { value: label }));

  const modeTabs = el("div", { class: "mode-tabs", attrs: { role: "group", "aria-label": t("appName") } });
  (["simple", "multi"] as const).forEach((trip, i) => {
    const btn = el("button", {
      class: "mode-tab",
      type: "button",
      text: t(`tab_${trip}` as const),
      dataset: { trip },
      on: { click: () => props.onSwitchTab(trip) },
    });
    withShortcut(btn, String(i + 1));
    modeTabs.append(btn);
  });
  const syncTabThumb = makeThumb(modeTabs);
  const ideasBtn = el("button", {
    class: "mode-tab ideas-tab",
    type: "button",
    text: t("tab_ideas"),
    dataset: { trip: "ideas" },
    on: { click: () => props.onSwitchTab("ideas") },
  });
  withShortcut(ideasBtn, "3");
  const modeBar = el("div", { class: "mode-bar" }, [modeTabs, ideasBtn]);

  const origin = inputEl("text", "station-list");
  const destination = inputEl("text", "station-list");
  const via = inputEl("text", "station-list");
  for (const input of [origin, destination, via]) {
    input.addEventListener("input", () => input.classList.remove("is-invalid"));
    input.addEventListener("change", () => {
      const v = input.value.trim();
      input.classList.toggle("is-invalid", v !== "" && !props.resolveStation(v));
    });
  }
  // Filling / clearing a destination flips whether the round-trip getaway options
  // apply (a known route picks its return from the results calendars instead), so
  // re-sync them whenever an endpoint changes.
  for (const input of [origin, destination]) {
    input.addEventListener("change", () => syncRoundTripOpts());
  }
  origin.addEventListener("change", () => {
    if (!isTouch() || props.mode() !== "od") return;
    if (props.resolveStation(origin.value) && !destination.value.trim()) {
      destination.focus();
    }
  });
  const departDate = makeDateField(t("field_date"));
  const date = departDate.input;
  const dateField = departDate.root;
  const endDate = inputEl("date");
  endDate.min = today;
  endDate.max = lastBookable;
  endDate.setAttribute("aria-label", t("field_end_date"));
  const endDateField = field(t("field_end_date"), endDate);
  const departAfter = inputEl("time");
  const departBefore = inputEl("time");
  const arriveBefore = inputEl("time");
  const maxDuration = inputEl("number");
  const maxSpanDays = inputEl("number");
  maxSpanDays.min = "1";
  maxSpanDays.max = "14";
  maxSpanDays.placeholder = "2";
  maxSpanDays.setAttribute("aria-label", t("field_maxSpanDays"));
  const radius = inputEl("number");
  radius.min = "10";
  radius.step = "10";
  radius.placeholder = "100";
  radius.setAttribute("aria-label", t("field_radius"));
  // The search radius is one of the most useful but least obvious options, so it
  // gets a full field with an explaining hint and lives in the main form (not buried
  // in Advanced): widen the search to nearby stations to surface more free seats.
  const radiusField = el("label", { class: "field field-radius" }, [
    el("span", { class: "field-label", text: t("field_radius"), attrs: { title: t("field_radius") } }),
    radius,
    el("span", { class: "field-hint muted small", text: t("radius_hint") }),
  ]);
  // "Hidden train" (hidden-city ticketing): also surface trains that call at your
  // destination on the way to a stop past it — book the longer ticket (same départ),
  // step off early. A global preference in Advanced (on by default, present on every
  // tab); only the exact trip actually acts on it. `checked` so it defaults on even
  // before a query syncs.
  const hidden = el("input", { type: "checkbox" }) as HTMLInputElement;
  hidden.checked = true;
  const hiddenField = yesNoField(t("field_hidden"), hidden);
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
  const overnightField = yesNoField(t("field_overnight"), overnight);
  const night = el("input", { type: "checkbox" }) as HTMLInputElement;
  const nightField = yesNoField(t("field_night"), night);
  const onlyNight = el("input", { type: "checkbox" }) as HTMLInputElement;
  const onlyNightField = yesNoField(t("night_only"), onlyNight, "field-sub");
  const syncNightOpts = (): void => {
    // "Only night trains" narrows the night-train option, so it has no meaning while
    // night trains are excluded. It stays in place — the panel's row rhythm shouldn't
    // shift under the pointer — but goes inert, and loses any answer it held.
    onlyNight.disabled = !night.checked;
    if (!night.checked) onlyNight.checked = false;
    syncYesNoFields(); // the lines above bypass `change`
  };
  night.addEventListener("change", syncNightOpts);
  const roundTrip = el("input", { type: "checkbox" }) as HTMLInputElement;
  const roundTripToggle = yesNoField(t("field_roundtrip"), roundTrip, "daytrip-toggle");
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
  const lateReturnField = yesNoField(t("field_late_return"), lateReturn);
  const roundTripOpts = el("div", { class: "daytrip-opts" }, [nightsField, stayHoursField, lateReturnField]);
  const roundTripField = el("div", { class: "field daytrip-group" }, [roundTripToggle, roundTripOpts]);
  const syncRoundTripOpts = (): void => {
    // Getaway options (nights / time on site) apply while DISCOVERING — Ideas, or the
    // Trip tab without a fixed destination ("where can I round-trip to?"). With a known
    // od route the results calendars pick the return, so the options would be redundant.
    const discover = currentTrip === "ideas" || (currentTrip === "simple" && !hasOdRoute());
    roundTripOpts.style.display = roundTrip.checked && discover ? "" : "none";
    stayHoursField.style.display = nights.value === "0" ? "" : "none";
  };
  roundTrip.addEventListener("change", syncRoundTripOpts);
  nights.addEventListener("change", syncRoundTripOpts);
  const region = el("select", { class: "input" }, [
    optionEl("", t("region_any"), true),
    ...props.regions.map((r) => optionEl(r, r, false)),
  ]) as HTMLSelectElement;
  const cities = inputEl("text", "station-list");
  cities.placeholder = t("cities_add");
  const cityChips = el("div", { class: "city-chips" });
  const citiesBox = el("div", { class: "cities-input" }, [cityChips, cities]);
  const commitCities = (raw: string): void => {
    let added = false;
    for (const part of raw.split(",")) {
      const id = props.resolveStation(part);
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
    if (cities.value.trim()) {
      commitCities(cities.value);
      cities.value = "";
    }
  });

  const originField = clearableField(t("field_origin"), origin);
  const destinationField = clearableField(t("field_destination"), destination);
  // Swap départ ⇄ arrivée in one tap, so reversing a route is trivial. Swapping the
  // raw text (then re-firing input/change) keeps validity flags and dependent fields
  // — the date picker's availability, the tour end date — in step.
  const swapBtn = el("button", {
    class: "swap-btn",
    type: "button",
    attrs: { "aria-label": t("act_swap"), title: t("act_swap") },
    html:
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4 3 8l4 4"/><path d="M3 8h13"/><path d="m17 20 4-4-4-4"/><path d="M21 16H8"/></svg>',
    on: {
      click: () => {
        const o = origin.value;
        origin.value = destination.value;
        destination.value = o;
        for (const inp of [origin, destination]) {
          inp.dispatchEvent(new Event("input", { bubbles: true }));
          inp.dispatchEvent(new Event("change", { bubbles: true }));
        }
      },
    },
  });
  // Browse-by-one-end hint: on the simple tab you can fill only the départ (→ "where
  // to?"), only the arrivée (→ "where from?"), or both (an exact trip). Spell that out
  // so the two fields don't read as both-required.
  const odHint = el("p", { class: "od-hint muted small", text: t("hint_od_optional") });
  const odFields = el("div", { class: "od-fields" }, [originField, swapBtn, destinationField]);
  const viaField = clearableField(t("field_via"), via);
  const regionField = field(t("field_region"), region);
  const clearCitiesBtn = el("button", {
    class: "linklike cities-clear",
    type: "button",
    text: t("cities_clear"),
    attrs: { hidden: "" },
    on: { click: () => clearCities() },
  });
  withShortcut(clearCitiesBtn, "C");
  const nearestBtn = el("button", {
    class: "btn btn-ghost nearest-btn",
    type: "button",
    text: t("act_nearest"),
    attrs: { title: t("nearest_hint") },
    on: { click: () => props.onNearest() },
  });
  withShortcut(nearestBtn, "N");
  nearestBtn.style.display = "none";
  const citiesField = field(
    t("field_cities"),
    el("div", { class: "cities-wrap" }, [citiesBox, el("div", { class: "cities-actions" }, [clearCitiesBtn])]),
  );
  citiesField.classList.add("cities-field");
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
  const tourCount = inputEl("number");
  tourCount.min = "1";
  tourCount.max = String(props.maxTourFill);
  tourCount.placeholder = "1";
  tourCount.setAttribute("aria-label", t("field_tour_count"));
  const tourCountField = field(t("field_tour_count"), tourCount);
  // Min/max days in each city read as ONE setting ("how long per city"), so they
  // share a single control — a min–max pair — instead of two separate number fields.
  minDays.classList.add("days-end");
  maxDays.classList.add("days-end");
  const daysRange = el("div", { class: "days-range" }, [
    minDays,
    el("span", { class: "days-range-sep muted", text: "–", attrs: { "aria-hidden": "true" } }),
    maxDays,
  ]);
  const daysRangeField = field(t("field_stay_range"), daysRange);
  // The planner's numbers read as one setting ("how many cities, how long in each"),
  // so they share a row instead of scattering across the auto-fit grid.
  const stayField = el("div", { class: "stay-fields" }, [tourCountField, daysRangeField]);
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
  const maxLegDuration = inputEl("number");
  maxLegDuration.min = "30";
  maxLegDuration.step = "15";
  maxLegDuration.placeholder = "240";
  maxLegDuration.setAttribute("aria-label", t("field_maxLegDuration"));
  const maxLegDurationField = field(t("field_maxLegDuration"), maxLegDuration);
  const minLegDuration = inputEl("number");
  minLegDuration.min = "0";
  minLegDuration.step = "15";
  minLegDuration.placeholder = "0";
  minLegDuration.setAttribute("aria-label", t("field_minLegDuration"));
  const minLegDurationField = field(t("field_minLegDuration"), minLegDuration);

  const maxDurationField = field(t("field_maxDuration"), maxDuration);
  const maxSpanDaysField = field(t("field_maxSpanDays"), maxSpanDays);
  const trainTypeField = field(t("field_trainType"), trainType);
  // The yes/no answers lead the panel as their own band; everything below is a
  // value to fill in, laid out three per row.
  const advancedToggles = el("div", { class: "advanced-toggles" }, [
    overnightField,
    nightField,
    onlyNightField,
    hiddenField,
  ]);

  const advanced = el("details", { class: "advanced" }, [
    el("summary", { text: t("field_advanced") }),
    advancedToggles,
    el("div", { class: "advanced-grid" }, [
      field(t("field_connections"), maxConnections),
      viaField,
      field(t("field_departAfter"), departAfter),
      field(t("field_departBefore"), departBefore),
      field(t("field_arriveBefore"), arriveBefore),
      maxDurationField,
      minLegDurationField,
      maxLegDurationField,
      maxSpanDaysField,
      maxKmField,
      trainTypeField,
    ]),
  ]);
  // Radius sits in its own band in the main form (not Advanced), so this "reach more
  // free seats" option is visible without unfolding a panel. (The hidden-train toggle
  // lives in Advanced — it's a global preference that only the exact trip acts on.)
  const scopeField = el("div", { class: "field scope-field" }, [radiusField]);

  const searchBtn = el("button", { class: "btn btn-primary", type: "submit", text: t("btn_search") });
  withShortcut(searchBtn, "G");
  const surpriseBtn = el("button", {
    class: "btn btn-ghost surprise-btn",
    type: "button",
    text: t("act_surprise"),
    on: { click: () => props.onSurprise() },
  });
  withShortcut(surpriseBtn, "S");
  const surpriseMsg = el("p", { class: "surprise-msg", attrs: { role: "status" } });

  const addLegBtn = el("button", { class: "linklike mc-add", type: "button", text: t("leg_add"), on: { click: () => addLeg() } });
  const clearLegsBtn = el("button", { class: "linklike mc-clear", type: "button", text: t("cities_clear"), on: { click: () => clearTripLegs() } });
  const legsHead = el("div", { class: "mc-head" }, [
    el("span", { class: "field-label", text: t("field_origin") }),
    el("span", { class: "field-label", text: t("field_destination") }),
    el("span", { class: "field-label", text: t("field_date") }),
    el("span", {}),
  ]);
  const legsBlock = el("div", { class: "mc-block" }, [
    legsHead,
    el("div", { class: "mc-legs" }),
    el("div", { class: "mc-actions" }, [addLegBtn, clearLegsBtn]),
  ]);
  legsContainer = legsBlock.querySelector(".mc-legs");
  legRows = [makeLeg(), makeLeg()];
  renderLegs();

  const howto = el("details", { class: "howto" }, [
    el("summary", { text: t("how_title") }),
    el("ul", { class: "howto-list" }, [
      el("li", { text: t("how_jeune") }),
      el("li", { text: t("how_senior") }),
    ]),
    el("p", { class: "howto-links" }, [
      el("span", { class: "muted", text: `${t("how_more")} ` }),
      el("a", { text: "MAX JEUNE", href: props.jeuneUrl, attrs: { target: "_blank", rel: "noopener noreferrer" } }),
      el("span", { class: "muted", text: " · " }),
      el("a", { text: "MAX SENIOR", href: props.seniorUrl, attrs: { target: "_blank", rel: "noopener noreferrer" } }),
    ]),
    el("p", { class: "muted small", text: t("how_note") }),
  ]);

  // Multi-city sub-mode toggle: "Custom legs" (hand-typed hops) leads, then "Plan a
  // tour" (cities). Shown only on the Multi tab; switching re-lays the form via the
  // controller.
  const legsTabBtn = el("button", {
    class: "multi-tab active",
    type: "button",
    text: t("multi_legs"),
    attrs: { "aria-pressed": "true" },
    on: { click: () => props.onMultiMode("legs") },
  });
  const planTabBtn = el("button", {
    class: "multi-tab",
    type: "button",
    text: t("multi_plan"),
    attrs: { "aria-pressed": "false" },
    on: { click: () => props.onMultiMode("plan") },
  });
  const multiSwitch = el(
    "div",
    { class: "multi-switch", attrs: { role: "group", "aria-label": t("tab_multi") } },
    [legsTabBtn, planTabBtn],
  );
  const syncMultiThumb = makeThumb(multiSwitch);

  const fields = el("div", { class: "fields" }, [
    multiSwitch,
    // The cities to visit are what a tour plan is ABOUT, so they lead the form (and
    // the tab order) on that surface; every other tab hides the field entirely.
    citiesField,
    odFields,
    odHint,
    dateField,
    endDateField,
    roundTripField,
    regionField,
    legsBlock,
    stayField,
    scopeField,
  ]);
  // A one-line description under the tabs telling you what the current mode does,
  // updated by applyFieldVisibility for the active trip (and sub-mode).
  const modeDesc = el("p", { class: "mode-desc muted small", attrs: { "aria-live": "polite" } });
  const formBody = el("div", { class: "form-body" }, [modeBar, modeDesc, fields, advanced]);
  const form = el("form", { class: "search-form" }, [
    formBody,
    el("div", { class: "form-stub" }, [
      el("div", { class: "form-actions" }, [searchBtn, surpriseBtn, nearestBtn]),
      surpriseMsg,
      howto,
    ]),
    stationList,
  ]);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    props.onSubmit();
  });
  form.addEventListener("change", () => refreshTourEndDate());

  const refs: FormRefs = {
    modeTabs,
    ideasBtn,
    origin,
    destination,
    date,
    dateField,
    departDate,
    legsBlock,
    surpriseBtn,
    endDate,
    endDateField,
    departAfter,
    departBefore,
    arriveBefore,
    maxDuration,
    maxSpanDays,
    maxSpanDaysField,
    radius,
    radiusField,
    hidden,
    hiddenField,
    trainType,
    maxConnections,
    overnight,
    night,
    onlyNight,
    onlyNightField,
    roundTrip,
    nights,
    stayHours,
    stayHoursField,
    lateReturn,
    roundTripField,
    roundTripOpts,
    via,
    originField,
    destinationField,
    viaField,
    maxDurationField,
    trainTypeField,
    region,
    regionField,
    cities,
    citiesField,
    tourCount,
    tourCountField,
    cityChips,
    minDays,
    maxDays,
    stayField,
    maxKm,
    maxLegKm,
    maxKmField,
    maxLegDuration,
    maxLegDurationField,
    minLegDuration,
    minLegDurationField,
  };

  return {
    form,
    refs,
    getTourCities: () => [...tourCities],
    setTourCities: (ids) => {
      tourCities = [...ids];
      renderCityChips();
    },
    clearCities,
    getLegValues: () => legRows.map((l) => ({ from: l.from.value, to: l.to.value, date: l.dateCtl.input.value })),
    setLegs: (legs) => {
      for (const l of legRows) l.dateCtl.destroy(); // discard the replaced rows' popovers
      legRows = legs.map((l) => makeLeg(l.from, l.to, l.date));
      renderLegs();
    },
    setLegDate: (index, date) => {
      legRows[index]?.dateCtl.setDate(date);
    },
    setActiveTab,
    getMultiMode: () => multiMode,
    setMultiMode,
    updateFieldVisibility,
    refreshTourEndDate,
    setSurpriseMsg: (text) => {
      surpriseMsg.textContent = text;
    },
    destroy: () => {
      departDate.destroy();
      for (const l of legRows) l.dateCtl.destroy();
      for (const ro of thumbObservers) ro.disconnect();
    },
  };
}
