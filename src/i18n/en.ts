import type { Dict } from "./fr";

export const en: Dict = {
  appName: "MAX Finder",
  tagline: "MAX JEUNE / SENIOR seats open for reservation.",
  prompt_pick: "Choose a departure station.",
  mode_best: "Ideas",
  best_title: "Best trips from {station} — {date}",
  field_region: "Region",
  region_any: "All regions",
  mode_tour: "Tour",
  tour_title: "Tours from {station} — {date}",
  field_cities: "Cities to visit",
  field_cities_ph: "Lyon, Marseille, Nice",
  tour_hint: "Add cities to visit (comma-separated).",
  tour_none: "No MAX tour for these cities and dates.",
  tour_day: "Day {n} — {date}",

  mode_from: "Where to?",
  mode_to: "Who comes here?",
  mode_od: "Exact trip",

  field_origin: "From station",
  field_destination: "To station",
  field_date: "Date",
  field_return: "Return (optional)",
  field_card: "Pass",
  card_jeune: "MAX JEUNE",
  card_senior: "MAX SENIOR",
  field_advanced: "Advanced filters",
  field_departAfter: "Depart after",
  field_departBefore: "Depart before",
  field_maxDuration: "Max duration (min)",
  field_trainType: "Type / line",
  field_anyType: "Any",
  field_connections: "Connections",
  conn_0: "Direct only",
  conn_1: "1 change max",
  conn_2: "2 changes max",

  btn_search: "Search",

  res_from_title: "Departing {station} — {date}",
  res_to_title: "Arriving at {station} — {date}",
  res_od_title: "{origin} → {destination} — {date}",
  res_none: "No MAX seat for these criteria.",
  res_destinations: "{n} destination(s)",
  res_origins: "{n} origin(s)",
  badge_trains: "{n} train(s)",

  lbl_direct: "Direct",
  lbl_via: "via {hub}",
  lbl_connection: "{dur} connection at {hub}",
  lbl_train: "Train {no}",
  lbl_dayoffset: "+{n} d",

  act_book: "Book on SNCF Connect",
  act_ics: "Add to calendar",
  act_calendar: "Calendar",
  act_fav_add: "Add to favorites",
  act_fav_remove: "Remove from favorites",

  cal_title: "30-day availability",
  cal_legend: "green = MAX seat available",
  cal_available: "available",
  cal_unavailable: "unavailable",
  link_newtab: "(opens in new tab)",

  rt_title: "Round trips",
  rt_stay: "{dur} on site",
  rt_outbound: "Outbound",
  rt_inbound: "Return",
  rt_none: "No MAX round trip for these dates.",

  fav_title: "Favorites",
  fav_none: "No favorites.",

  map_title: "Map",

  foot_updated: "Data updated: {date}",
  foot_sample: "sample data",
  foot_source: "Source: SNCF Open Data — tgvmax (Open Licence)",
  foot_disclaimer:
    "Indicative availability, refreshed ~once a day. Verify and book on SNCF Connect. Independent FOSS project, not affiliated with SNCF.",

  ctl_theme: "Theme",
  ctl_lang: "Language",
};
