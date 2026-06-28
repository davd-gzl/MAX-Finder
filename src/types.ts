// Domain types for MAX Finder.

/** Which MAX subscription the user holds. */
export type CardType = "jeune" | "senior";

/** Search intent. */
export type SearchMode = "from" | "to" | "od" | "best" | "tour";

/**
 * A raw record as published by the SNCF `tgvmax` Open Data dataset.
 * One record ≈ one train, one origin→destination, one date.
 * Field names mirror the dataset (French) so the fetch script can map directly.
 */
export interface RawRecord {
  date: string; // "YYYY-MM-DD"
  origine: string;
  destination: string;
  heure_depart: string; // "HH:MM" or "HH:MM:SS"
  heure_arrivee: string;
  train_no: string;
  od_happy_card: string; // "OUI" => a MAX seat is reservable, "NON" => not
  axe?: string; // train axis / line, when present
}

/** A normalized train used throughout the app. */
export interface MaxTrain {
  date: string; // "YYYY-MM-DD"
  origin: string; // canonical station id (dataset label)
  destination: string;
  depart: string; // "HH:MM"
  arrive: string; // "HH:MM"
  departMin: number; // minutes from midnight (departure)
  arriveMin: number; // minutes from midnight (arrival, +1440 if past midnight)
  durationMin: number;
  trainNo: string;
  available: boolean; // od_happy_card === "OUI"
  axe?: string;
}

/** A station with coordinates for the map + autocomplete. */
export interface Station {
  id: string; // canonical key (matches dataset `origine`/`destination`)
  label: string; // display name
  city?: string;
  lat: number;
  lng: number;
  region?: string;
  aliases?: string[];
}

/** A fully-specified search. Serializable to/from the URL. */
export interface SearchQuery {
  mode: SearchMode;
  origin?: string;
  destination?: string;
  date: string; // "YYYY-MM-DD"
  card: CardType;
  departAfter?: string; // "HH:MM"
  departBefore?: string; // "HH:MM"
  maxDurationMin?: number;
  trainType?: string;
  /** Max changes allowed: 0 = direct only, 1 = one change, 2 = two changes. */
  maxConnections: number;
  /** Allow long overnight layovers at a hub (evening train → sleep → morning train). */
  overnight?: boolean;
  /** Exclude night trains (leave late / arrive past midnight) when true. */
  excludeNight?: boolean;
  /** Force the journey to pass through this station ("exact trip" mode only). */
  via?: string;
  /** Flexible dates: also search ±N days around `date` ("exact trip" mode). */
  flexDays?: number;
  /** Region filter, used by "best" mode. */
  region?: string;
  /** Cities to visit, used by "tour" mode. */
  cities?: string[];
  /** Min / max days spent in each city before the next hop ("tour" mode). */
  minDays?: number;
  maxDays?: number;
  /** Cap on the tour's total straight-line distance, in km ("tour" mode). */
  maxKm?: number;
  /** Cap on each hop's straight-line distance, in km ("tour" mode). */
  maxLegKm?: number;
  /** Cap on each hop's travel time, in minutes ("tour" mode — time over distance). */
  maxLegDurationMin?: number;
  /**
   * Cap on a journey's total day-span ("exact trip" mode). Overnight stopovers
   * can chain trains across several days; this limits how many calendar days the
   * whole trip may straddle (1 = same-day, 2 = arrives the next day, …).
   */
  maxSpanDays?: number;
  /** Finish the tour at the destination on or before this date ("tour" mode). */
  tourEndDate?: string;
  /**
   * Search radius in km around the endpoints ("exact trip" mode). When set, the
   * map draws a circle around the origin and destination and the results suggest
   * nearby stations with free MAX seats — so you can pay a short hop to/from a
   * station that does have a free train when the exact route has none.
   */
  radiusKm?: number;
  /**
   * "Day trip" toggle for "Where to?" mode: instead of the plain destinations
   * list, show same-day round trips from the origin (leave in the morning, home
   * the same evening — both free MAX), ranked by how long you get in each city.
   */
  dayTrip?: boolean;
  /** Minimum hours to spend in the city for a day trip to count (default 4). */
  dayTripMinHours?: number;
  /** Allow a day-trip return arriving up to ~02:00 the next morning (else by midnight). */
  lateReturn?: boolean;
}

/** A direct or multi-leg (1..3 legs) journey. */
export interface Journey {
  date: string;
  origin: string;
  destination: string;
  legs: MaxTrain[];
  departMin: number;
  arriveMin: number;
  totalDurationMin: number;
  connectionMin?: number; // single-change layover (back-compat convenience)
  hub?: string; // single-change hub (back-compat convenience)
  layovers: number[]; // layover before each leg after the first
  hubs: string[]; // interchange stations, in order
}

/** One day in the 30-day availability calendar for a route. */
export interface CalendarDay {
  date: string;
  available: boolean;
  count: number; // number of free-MAX trains that day
  /**
   * The exact route has no free seat this day, but substituting ONE endpoint for a
   * station within the search radius reaches it (radius search only) — still
   * reachable via a short paid hop. Rendered in a distinct calendar colour.
   */
  nearby?: boolean;
  /**
   * Reachable this day ONLY by substituting BOTH endpoints — leaving from a nearby
   * station AND arriving at a nearby one (radius search only). The most effort, so
   * it gets its own calendar colour, distinct from the single-substitution one.
   */
  nearbyBoth?: boolean;
}

/** A round-trip pairing (outbound + return both free-MAX). */
export interface RoundTrip {
  outbound: Journey;
  inbound: Journey;
  stayMinutes: number; // time between outbound arrival and inbound departure
}

/** Dataset freshness metadata. */
export interface DataMeta {
  updatedAt: string; // ISO timestamp of the last snapshot
  source: string;
  recordCount: number;
  isSample?: boolean;
}
