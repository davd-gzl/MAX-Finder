import type { Dict } from "./fr";

export const en: Dict = {
  appName: "MAX JEUNE",
  tagline: "Every reservable MAX JEUNE / SENIOR seat, at a glance.",

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
  field_allowConnections: "Include connections",

  btn_search: "Search",
  btn_surprise: "Surprise me",
  btn_reset: "Reset",

  res_from_title: "Departing {station} — {date}",
  res_to_title: "Arriving at {station} — {date}",
  res_od_title: "{origin} → {destination} — {date}",
  res_none: "No MAX seat found. Try another date or enable connections.",
  res_destinations: "{n} destination(s)",
  res_origins: "{n} origin(s)",
  badge_trains: "{n} train(s)",

  lbl_direct: "Direct",
  lbl_via: "via {hub}",
  lbl_connection: "{dur} connection at {hub}",
  lbl_train: "Train {no}",
  lbl_arrow: "→",

  act_book: "Book on SNCF Connect",
  act_ics: "Add to calendar",
  act_calendar: "Calendar",
  act_open: "Show trains",
  act_fav_add: "Add to favorites",
  act_fav_remove: "Remove from favorites",
  act_details: "Details",

  cal_title: "30-day availability",
  cal_legend: "green = MAX seat available",

  rt_title: "Round trips",
  rt_stay: "{dur} on site",
  rt_outbound: "Outbound",
  rt_inbound: "Return",
  rt_none: "No MAX round trip for these dates.",

  fav_title: "Favorites",
  fav_none: "No favorites yet. Add a trip to find it here.",

  map_title: "Map",

  foot_updated: "Data updated: {date}",
  foot_sample: "sample data",
  foot_source: "Source: SNCF Open Data — tgvmax (Open Licence)",
  foot_disclaimer:
    "Indicative availability, refreshed ~once a day. Verify and book on SNCF Connect. Independent FOSS project, not affiliated with SNCF.",

  ctl_theme: "Theme",
  ctl_lang: "Language",

  loading: "Loading data…",
  surprise_none: "No available destination found.",
};
