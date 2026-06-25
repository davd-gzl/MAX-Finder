export const fr = {
  appName: "MAX Finder",
  tagline: "Places MAX JEUNE / SENIOR ouvertes à la réservation.",
  prompt_pick: "Choisissez une gare de départ.",
  mode_best: "Idées",
  best_title: "Meilleurs trajets depuis {station} — {date}",
  field_region: "Région",
  region_any: "Toutes régions",
  mode_tour: "Tour",
  tour_title: "Itinéraires depuis {station} — {date}",
  field_cities: "Villes à visiter",
  field_cities_ph: "Lyon, Marseille, Nice",
  tour_hint: "Ajoutez des villes à visiter (séparées par des virgules).",
  tour_none: "Aucun itinéraire MAX pour ces villes et dates.",
  tour_day: "Jour {n} — {date}",

  mode_from: "Où partir ?",
  mode_to: "Qui vient ici ?",
  mode_od: "Trajet précis",

  field_origin: "Gare de départ",
  field_destination: "Gare d'arrivée",
  field_date: "Date",
  field_return: "Retour (optionnel)",
  field_card: "Carte",
  card_jeune: "MAX JEUNE",
  card_senior: "MAX SENIOR",
  field_advanced: "Filtres avancés",
  field_departAfter: "Départ après",
  field_departBefore: "Départ avant",
  field_maxDuration: "Durée max (min)",
  field_trainType: "Type / axe",
  field_anyType: "Tous",
  field_connections: "Correspondances",
  conn_0: "Directes uniquement",
  conn_1: "1 correspondance max",
  conn_2: "2 correspondances max",

  btn_search: "Rechercher",

  res_from_title: "Au départ de {station} — {date}",
  res_to_title: "Pour arriver à {station} — {date}",
  res_od_title: "{origin} → {destination} — {date}",
  res_none: "Aucune place MAX pour ces critères.",
  res_destinations: "{n} destination(s)",
  res_origins: "{n} origine(s)",
  badge_trains: "{n} train(s)",

  lbl_direct: "Direct",
  lbl_via: "via {hub}",
  lbl_connection: "Correspondance de {dur} à {hub}",
  lbl_train: "Train {no}",
  lbl_dayoffset: "+{n} j",

  act_book: "Réserver sur SNCF Connect",
  act_ics: "Ajouter au calendrier",
  act_calendar: "Calendrier",
  act_fav_add: "Ajouter aux favoris",
  act_fav_remove: "Retirer des favoris",

  cal_title: "Disponibilité sur 30 jours",
  cal_legend: "vert = place MAX dispo",
  cal_available: "disponible",
  cal_unavailable: "indisponible",
  link_newtab: "(nouvel onglet)",

  rt_title: "Allers-retours",
  rt_stay: "{dur} sur place",
  rt_outbound: "Aller",
  rt_inbound: "Retour",
  rt_none: "Aucun aller-retour MAX pour ces dates.",

  fav_title: "Favoris",
  fav_none: "Aucun favori.",

  map_title: "Carte",

  foot_updated: "Données mises à jour : {date}",
  foot_sample: "données d'exemple",
  foot_source: "Source : SNCF Open Data — tgvmax (Licence Ouverte)",
  foot_disclaimer:
    "Disponibilités indicatives, mises à jour ~1×/jour. Vérifiez et réservez sur SNCF Connect. Projet libre indépendant, non affilié à la SNCF.",

  ctl_theme: "Thème",
  ctl_lang: "Langue",
};

export type Dict = typeof fr;
