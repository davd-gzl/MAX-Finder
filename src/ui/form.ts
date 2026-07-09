import type { SearchMode } from "../types";
import type { ConnectionOptions } from "../core/connections";
import { el, clear, optionEl, isTouch } from "./dom";
import { t, getLang } from "../i18n";
import { addDays, dayIndex } from "../util/time";

export type TripType = "simple" | "return" | "multi" | "ideas";

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
  modeDesc: HTMLElement;
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
  trainType: HTMLSelectElement;
  maxConnections: HTMLSelectElement;
  connGroupField: HTMLElement;
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
  setActiveTab(trip: TripType): void;
  updateFieldVisibility(trip: TripType): void;
  refreshTourEndDate(): void;
  setSurpriseMsg(text: string): void;
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
  return el("label", { class: "field" }, [el("span", { class: "field-label", text: label }), control]);
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
    const pop = el("div", { class: "datepop", attrs: { role: "dialog", hidden: "" } }, [marginRow, dow, grid, legend]);
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
      if (range) {
        if (awaitReturn && date >= input.value) {
          retDate = date;
          awaitReturn = false;
          setLabel();
          paint();
          input.dispatchEvent(new Event("change", { bubbles: true }));
          close();
          return;
        }
        input.value = date;
        retDate = "";
        awaitReturn = true;
        setLabel();
        input.dispatchEvent(new Event("change", { bubbles: true }));
        refresh();
        return;
      }
      input.value = date;
      setLabel();
      paint();
      input.dispatchEvent(new Event("change", { bubbles: true }));
      close();
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
            attrs: { "aria-label": props.formatDate(date), "data-date": date, ...(isSel ? { "aria-current": "date" } : {}) },
            on: { click: () => pick(date) },
          }),
        );
      }
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
    };
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      isOpen ? close() : openPop();
    });
    pop.addEventListener("click", (e) => e.stopPropagation());
    pop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        close();
        trigger.focus();
      }
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
    renderLegs();
  }

  function clearTripLegs(): void {
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

  function setActiveTab(trip: TripType): void {
    for (const btn of [...Array.from(modeTabs.children), ideasBtn]) {
      const active = (btn as HTMLElement).dataset.trip === trip;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    }
  }

  function refreshTourEndDate(): void {
    endDateField.style.display = "none";
  }

  function updateFieldVisibility(trip: TripType): void {
    const ret = trip === "return";
    const multi = trip === "multi";
    const ideas = trip === "ideas";
    const single = trip === "simple" || ret;

    originField.style.display = multi ? "none" : "";
    destinationField.style.display = ideas || multi ? "none" : "";
    dateField.style.display = multi ? "none" : "";
    legsBlock.style.display = multi ? "" : "none";
    origin.placeholder = single ? t("ph_anywhere") : "";
    destination.placeholder = single ? t("ph_anywhere") : "";
    departDate.setRange(ret);
    refreshTourEndDate();

    viaField.style.display = single ? "" : "none";
    onlyNightField.style.display = night.checked ? "" : "none";
    surpriseBtn.style.display = multi ? "none" : "";

    maxDurationField.style.display = multi ? "none" : "";
    maxLegDurationField.style.display = "none";
    minLegDurationField.style.display = "none";

    regionField.style.display = ideas ? "" : "none";
    citiesField.style.display = "none";
    tourCountField.style.display = "none";
    stayField.style.display = "none";
    maxKmField.style.display = "none";
    maxSpanDaysField.style.display = single ? "" : "none";
    radiusField.style.display = single ? "" : "none";
    nearestBtn.style.display = "none";
  }

  const stationList = el("datalist", { id: "station-list" });
  for (const label of props.stationLabels) stationList.append(el("option", { value: label }));

  const modeTabs = el("div", { class: "mode-tabs", attrs: { role: "group", "aria-label": t("appName") } });
  (["simple", "return", "multi"] as const).forEach((trip, i) => {
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
  const ideasBtn = el("button", {
    class: "mode-tab ideas-tab",
    type: "button",
    text: t("tab_ideas"),
    dataset: { trip: "ideas" },
    on: { click: () => props.onSwitchTab("ideas") },
  });
  withShortcut(ideasBtn, "4");
  const modeBar = el("div", { class: "mode-bar" }, [modeTabs, ideasBtn]);
  const modeDesc = el("p", { class: "mode-desc" });

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
  const radiusField = field(t("field_radius"), radius);
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
  const night = el("input", { type: "checkbox" }) as HTMLInputElement;
  const nightField = el("label", { class: "field field-check" }, [
    night,
    el("span", { class: "field-label", text: t("field_night") }),
  ]);
  const onlyNight = el("input", { type: "checkbox" }) as HTMLInputElement;
  const onlyNightField = el("label", { class: "field field-check field-sub" }, [
    onlyNight,
    el("span", { class: "field-label", text: t("night_only") }),
  ]);
  const syncNightOpts = (): void => {
    onlyNightField.style.display = night.checked ? "" : "none";
    if (!night.checked) onlyNight.checked = false;
  };
  night.addEventListener("change", syncNightOpts);
  const roundTrip = el("input", { type: "checkbox" }) as HTMLInputElement;
  const roundTripToggle = el("label", { class: "field field-check daytrip-toggle" }, [
    roundTrip,
    el("span", { class: "field-label", text: t("field_roundtrip") }),
  ]);
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
  const lateReturnField = el("label", { class: "field field-check" }, [
    lateReturn,
    el("span", { class: "field-label", text: t("field_late_return") }),
  ]);
  const roundTripOpts = el("div", { class: "daytrip-opts" }, [nightsField, stayHoursField, lateReturnField]);
  const roundTripField = el("div", { class: "field daytrip-group" }, [roundTripToggle, roundTripOpts]);
  const syncRoundTripOpts = (): void => {
    roundTripOpts.style.display = roundTrip.checked ? "" : "none";
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
  const tourCount = inputEl("number");
  tourCount.min = "1";
  tourCount.max = String(props.maxTourFill);
  tourCount.placeholder = "1";
  tourCount.setAttribute("aria-label", t("field_tour_count"));
  const tourCountField = field(t("field_tour_count"), tourCount);
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
  const connGroupField = el("div", { class: "conn-group" }, [
    field(t("field_connections"), maxConnections),
    overnightField,
    nightField,
    onlyNightField,
  ]);

  const advanced = el("details", { class: "advanced" }, [
    el("summary", { text: t("field_advanced") }),
    el("div", { class: "advanced-grid" }, [
      connGroupField,
      viaField,
      field(t("field_departAfter"), departAfter),
      field(t("field_departBefore"), departBefore),
      field(t("field_arriveBefore"), arriveBefore),
      maxDurationField,
      minLegDurationField,
      maxLegDurationField,
      maxSpanDaysField,
      radiusField,
      maxKmField,
      trainTypeField,
    ]),
  ]);

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

  const form = el("form", { class: "search-form" }, [
    el("div", { class: "form-body" }, [
      modeBar,
      modeDesc,
      el("div", { class: "fields" }, [
        originField,
        destinationField,
        dateField,
        endDateField,
        regionField,
        legsBlock,
        citiesField,
        stayField,
        tourCountField,
      ]),
      advanced,
    ]),
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
    modeDesc,
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
    trainType,
    maxConnections,
    connGroupField,
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
      legRows = legs.map((l) => makeLeg(l.from, l.to, l.date));
      renderLegs();
    },
    setActiveTab,
    updateFieldVisibility,
    refreshTourEndDate,
    setSurpriseMsg: (text) => {
      surpriseMsg.textContent = text;
    },
  };
}
