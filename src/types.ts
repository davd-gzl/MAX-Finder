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
  /** Force the journey to pass through this station ("exact trip" mode only). */
  via?: string;
  /** Region filter, used by "best" mode. */
  region?: string;
  /** Cities to visit, used by "tour" mode. */
  cities?: string[];
  /** Minimum days spent in each city before the next hop ("tour" mode). Default 1. */
  stayDays?: number;
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
