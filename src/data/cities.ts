/**
 * Supplementary city reference for the map.
 *
 * The curated `stations.json` holds the major hubs (with rich metadata); this
 * table adds approximate coordinates for the many smaller — and international —
 * stations that appear in the tgvmax dataset, so markers can be plotted and a
 * sensible city name resolved for travel-guide links.
 *
 * Coordinates are city/station centroids (accurate to a national-map zoom).
 * `aliases` carry alternate spellings the dataset may use (e.g. French exonyms
 * for foreign cities, or station-name variants), matched accent-insensitively.
 */
export interface CityRef {
  name: string;
  lat: number;
  lng: number;
  region?: string;
  aliases?: string[];
}

export const CITY_REFERENCE: CityRef[] = [
  // --- Hauts-de-France -------------------------------------------------------
  { name: "Arras", lat: 50.291, lng: 2.781, region: "Hauts-de-France" },
  { name: "Douai", lat: 50.38, lng: 3.083, region: "Hauts-de-France" },
  { name: "Valenciennes", lat: 50.358, lng: 3.516, region: "Hauts-de-France" },
  { name: "Dunkerque", lat: 51.035, lng: 2.371, region: "Hauts-de-France" },
  { name: "Calais", lat: 50.951, lng: 1.857, region: "Hauts-de-France", aliases: ["calais frethun"] },
  { name: "Béthune", lat: 50.53, lng: 2.641, region: "Hauts-de-France" },
  { name: "Lens", lat: 50.432, lng: 2.831, region: "Hauts-de-France" },
  { name: "Saint-Quentin", lat: 49.848, lng: 3.287, region: "Hauts-de-France" },
  { name: "Compiègne", lat: 49.418, lng: 2.826, region: "Hauts-de-France" },
  { name: "Amiens", lat: 49.894, lng: 2.296, region: "Hauts-de-France" },
  {
    name: "Haute-Picardie",
    lat: 49.857,
    lng: 2.832,
    region: "Hauts-de-France",
    aliases: ["tgv haute picardie", "haute picardie"],
  },
  // --- Grand Est -------------------------------------------------------------
  { name: "Colmar", lat: 48.078, lng: 7.358, region: "Grand Est" },
  { name: "Sélestat", lat: 48.26, lng: 7.453, region: "Grand Est" },
  { name: "Saverne", lat: 48.741, lng: 7.362, region: "Grand Est" },
  { name: "Thionville", lat: 49.358, lng: 6.169, region: "Grand Est" },
  { name: "Forbach", lat: 49.19, lng: 6.901, region: "Grand Est" },
  { name: "Sarrebourg", lat: 48.737, lng: 7.057, region: "Grand Est" },
  { name: "Épernay", lat: 49.044, lng: 3.959, region: "Grand Est" },
  { name: "Châlons-en-Champagne", lat: 48.957, lng: 4.365, region: "Grand Est" },
  { name: "Charleville-Mézières", lat: 49.772, lng: 4.726, region: "Grand Est" },
  { name: "Sedan", lat: 49.702, lng: 4.939, region: "Grand Est" },
  { name: "Épinal", lat: 48.18, lng: 6.453, region: "Grand Est" },
  { name: "Saint-Dié", lat: 48.288, lng: 6.951, region: "Grand Est", aliases: ["saint die des vosges"] },
  { name: "Bar-le-Duc", lat: 48.77, lng: 5.161, region: "Grand Est" },
  {
    name: "Champagne-Ardenne",
    lat: 49.215,
    lng: 4.015,
    region: "Grand Est",
    aliases: ["champagne ardenne tgv", "bezannes"],
  },
  { name: "Lorraine TGV", lat: 48.948, lng: 6.169, region: "Grand Est", aliases: ["lorraine tgv", "louvigny"] },
  { name: "Meuse", lat: 48.971, lng: 5.27, region: "Grand Est", aliases: ["meuse tgv"] },
  // --- Bourgogne-Franche-Comté ----------------------------------------------
  { name: "Chalon-sur-Saône", lat: 46.781, lng: 4.853, region: "Bourgogne-Franche-Comté" },
  { name: "Mâcon", lat: 46.307, lng: 4.829, region: "Bourgogne-Franche-Comté", aliases: ["macon loche", "macon ville"] },
  { name: "Montbard", lat: 47.622, lng: 4.337, region: "Bourgogne-Franche-Comté" },
  { name: "Dole", lat: 47.092, lng: 5.49, region: "Bourgogne-Franche-Comté" },
  { name: "Vesoul", lat: 47.621, lng: 6.155, region: "Bourgogne-Franche-Comté" },
  { name: "Lons-le-Saunier", lat: 46.675, lng: 5.555, region: "Bourgogne-Franche-Comté" },
  { name: "Auxerre", lat: 47.798, lng: 3.573, region: "Bourgogne-Franche-Comté" },
  { name: "Sens", lat: 48.197, lng: 3.282, region: "Bourgogne-Franche-Comté" },
  { name: "Nevers", lat: 46.989, lng: 3.159, region: "Bourgogne-Franche-Comté" },
  // --- Auvergne-Rhône-Alpes --------------------------------------------------
  { name: "Saint-Étienne", lat: 45.44, lng: 4.388, region: "Auvergne-Rhône-Alpes", aliases: ["saint etienne chateaucreux"] },
  { name: "Clermont-Ferrand", lat: 45.778, lng: 3.087, region: "Auvergne-Rhône-Alpes" },
  { name: "Vichy", lat: 46.127, lng: 3.426, region: "Auvergne-Rhône-Alpes" },
  { name: "Roanne", lat: 46.034, lng: 4.069, region: "Auvergne-Rhône-Alpes" },
  { name: "Aix-les-Bains", lat: 45.688, lng: 5.91, region: "Auvergne-Rhône-Alpes", aliases: ["aix les bains le revard"] },
  { name: "Bourg-en-Bresse", lat: 46.205, lng: 5.228, region: "Auvergne-Rhône-Alpes" },
  { name: "Bourg-Saint-Maurice", lat: 45.618, lng: 6.769, region: "Auvergne-Rhône-Alpes" },
  { name: "Moûtiers", lat: 45.486, lng: 6.531, region: "Auvergne-Rhône-Alpes", aliases: ["moutiers salins brides"] },
  { name: "Albertville", lat: 45.676, lng: 6.392, region: "Auvergne-Rhône-Alpes" },
  { name: "Modane", lat: 45.198, lng: 6.658, region: "Auvergne-Rhône-Alpes" },
  { name: "Bellegarde", lat: 46.108, lng: 5.825, region: "Auvergne-Rhône-Alpes" },
  { name: "Vienne", lat: 45.525, lng: 4.875, region: "Auvergne-Rhône-Alpes" },
  { name: "Montélimar", lat: 44.558, lng: 4.751, region: "Auvergne-Rhône-Alpes" },
  // --- Provence-Alpes-Côte d'Azur -------------------------------------------
  { name: "Cannes", lat: 43.553, lng: 7.017, region: "Provence-Alpes-Côte d'Azur" },
  { name: "Antibes", lat: 43.581, lng: 7.123, region: "Provence-Alpes-Côte d'Azur" },
  { name: "Saint-Raphaël", lat: 43.425, lng: 6.768, region: "Provence-Alpes-Côte d'Azur", aliases: ["saint raphael valescure"] },
  { name: "Hyères", lat: 43.121, lng: 6.144, region: "Provence-Alpes-Côte d'Azur" },
  { name: "Menton", lat: 43.775, lng: 7.503, region: "Provence-Alpes-Côte d'Azur" },
  { name: "Gap", lat: 44.559, lng: 6.079, region: "Provence-Alpes-Côte d'Azur" },
  { name: "Orange", lat: 44.138, lng: 4.808, region: "Provence-Alpes-Côte d'Azur" },
  // --- Occitanie -------------------------------------------------------------
  { name: "Narbonne", lat: 43.184, lng: 3.004, region: "Occitanie" },
  { name: "Béziers", lat: 43.345, lng: 3.219, region: "Occitanie" },
  { name: "Sète", lat: 43.403, lng: 3.697, region: "Occitanie" },
  { name: "Carcassonne", lat: 43.213, lng: 2.351, region: "Occitanie" },
  { name: "Agde", lat: 43.31, lng: 3.476, region: "Occitanie" },
  { name: "Montauban", lat: 44.018, lng: 1.355, region: "Occitanie" },
  { name: "Agen", lat: 44.203, lng: 0.62, region: "Occitanie" },
  { name: "Lourdes", lat: 43.094, lng: -0.045, region: "Occitanie" },
  { name: "Tarbes", lat: 43.233, lng: 0.071, region: "Occitanie" },
  // --- Nouvelle-Aquitaine ----------------------------------------------------
  { name: "Limoges", lat: 45.835, lng: 1.261, region: "Nouvelle-Aquitaine", aliases: ["limoges benedictins"] },
  { name: "Brive-la-Gaillarde", lat: 45.158, lng: 1.533, region: "Nouvelle-Aquitaine" },
  { name: "Périgueux", lat: 45.184, lng: 0.721, region: "Nouvelle-Aquitaine" },
  { name: "Bergerac", lat: 44.851, lng: 0.482, region: "Nouvelle-Aquitaine" },
  { name: "Dax", lat: 43.709, lng: -1.053, region: "Nouvelle-Aquitaine" },
  { name: "Saint-Jean-de-Luz", lat: 43.388, lng: -1.659, region: "Nouvelle-Aquitaine", aliases: ["saint jean de luz ciboure"] },
  { name: "Hendaye", lat: 43.359, lng: -1.774, region: "Nouvelle-Aquitaine" },
  { name: "Niort", lat: 46.323, lng: -0.459, region: "Nouvelle-Aquitaine" },
  { name: "Saintes", lat: 45.746, lng: -0.633, region: "Nouvelle-Aquitaine" },
  { name: "Royan", lat: 45.627, lng: -1.028, region: "Nouvelle-Aquitaine" },
  { name: "Cognac", lat: 45.696, lng: -0.328, region: "Nouvelle-Aquitaine" },
  { name: "Libourne", lat: 44.913, lng: -0.243, region: "Nouvelle-Aquitaine" },
  { name: "Châtellerault", lat: 46.817, lng: 0.546, region: "Nouvelle-Aquitaine" },
  // --- Pays de la Loire ------------------------------------------------------
  { name: "La Roche-sur-Yon", lat: 46.67, lng: -1.43, region: "Pays de la Loire" },
  { name: "Les Sables-d'Olonne", lat: 46.497, lng: -1.783, region: "Pays de la Loire" },
  { name: "Cholet", lat: 47.06, lng: -0.879, region: "Pays de la Loire" },
  { name: "Saumur", lat: 47.26, lng: -0.077, region: "Pays de la Loire" },
  { name: "Laval", lat: 48.074, lng: -0.77, region: "Pays de la Loire" },
  // --- Bretagne --------------------------------------------------------------
  { name: "Saint-Brieuc", lat: 48.514, lng: -2.765, region: "Bretagne" },
  { name: "Guingamp", lat: 48.56, lng: -3.15, region: "Bretagne" },
  { name: "Morlaix", lat: 48.578, lng: -3.828, region: "Bretagne" },
  { name: "Vitré", lat: 48.124, lng: -1.21, region: "Bretagne" },
  { name: "Redon", lat: 47.651, lng: -2.085, region: "Bretagne" },
  { name: "Auray", lat: 47.668, lng: -2.985, region: "Bretagne" },
  // --- Centre-Val de Loire ---------------------------------------------------
  { name: "Orléans", lat: 47.902, lng: 1.905, region: "Centre-Val de Loire" },
  { name: "Blois", lat: 47.587, lng: 1.333, region: "Centre-Val de Loire", aliases: ["blois chambord"] },
  { name: "Bourges", lat: 47.084, lng: 2.396, region: "Centre-Val de Loire" },
  { name: "Châteauroux", lat: 46.811, lng: 1.69, region: "Centre-Val de Loire" },
  { name: "Vierzon", lat: 47.221, lng: 2.069, region: "Centre-Val de Loire" },
  { name: "Vendôme", lat: 47.823, lng: 1.02, region: "Centre-Val de Loire", aliases: ["vendome villiers sur loir"] },
  { name: "Chartres", lat: 48.444, lng: 1.489, region: "Centre-Val de Loire" },
  // --- Normandie -------------------------------------------------------------
  { name: "Rouen", lat: 49.443, lng: 1.099, region: "Normandie", aliases: ["rouen rive droite"] },
  { name: "Le Havre", lat: 49.494, lng: 0.107, region: "Normandie" },
  { name: "Caen", lat: 49.183, lng: -0.37, region: "Normandie" },
  { name: "Cherbourg", lat: 49.639, lng: -1.622, region: "Normandie" },
  { name: "Évreux", lat: 49.024, lng: 1.151, region: "Normandie" },
  { name: "Lisieux", lat: 49.146, lng: 0.231, region: "Normandie" },
  // --- International ---------------------------------------------------------
  { name: "Bruxelles", lat: 50.846, lng: 4.357, region: "Belgique", aliases: ["bruxelles midi", "bruxelles nord", "brussels", "bruxelles zuid"] },
  { name: "Antwerpen", lat: 51.217, lng: 4.421, region: "Belgique", aliases: ["anvers", "antwerp"] },
  { name: "Luxembourg", lat: 49.6, lng: 6.134, region: "Luxembourg" },
  { name: "Genève", lat: 46.21, lng: 6.143, region: "Suisse", aliases: ["geneve", "geneva"] },
  { name: "Lausanne", lat: 46.517, lng: 6.629, region: "Suisse" },
  { name: "Zürich", lat: 47.378, lng: 8.54, region: "Suisse", aliases: ["zurich", "zurich hb"] },
  { name: "Bâle", lat: 47.547, lng: 7.589, region: "Suisse", aliases: ["bale", "basel", "basel sbb", "bale sbb"] },
  { name: "Bern", lat: 46.948, lng: 7.439, region: "Suisse", aliases: ["berne"] },
  { name: "Frankfurt", lat: 50.107, lng: 8.663, region: "Allemagne", aliases: ["francfort", "frankfurt main"] },
  { name: "Karlsruhe", lat: 49.009, lng: 8.4, region: "Allemagne" },
  { name: "Mannheim", lat: 49.479, lng: 8.469, region: "Allemagne" },
  { name: "Stuttgart", lat: 48.784, lng: 9.182, region: "Allemagne" },
  { name: "München", lat: 48.14, lng: 11.56, region: "Allemagne", aliases: ["munich", "muenchen"] },
  { name: "Köln", lat: 50.943, lng: 6.959, region: "Allemagne", aliases: ["cologne", "koln"] },
  { name: "Freiburg", lat: 47.996, lng: 7.842, region: "Allemagne", aliases: ["fribourg en brisgau", "freiburg breisgau"] },
  { name: "Saarbrücken", lat: 49.24, lng: 6.991, region: "Allemagne", aliases: ["sarrebruck", "saarbrucken"] },
  { name: "Barcelona", lat: 41.379, lng: 2.14, region: "España", aliases: ["barcelone", "barcelona sants"] },
  { name: "Girona", lat: 41.979, lng: 2.816, region: "España", aliases: ["gerone"] },
  { name: "Figueres", lat: 42.267, lng: 2.962, region: "España", aliases: ["figueres vilafant"] },
  { name: "Madrid", lat: 40.407, lng: -3.691, region: "España", aliases: ["madrid atocha"] },
  { name: "Zaragoza", lat: 41.659, lng: -0.911, region: "España", aliases: ["saragosse", "zaragoza delicias"] },
  { name: "Milano", lat: 45.486, lng: 9.204, region: "Italia", aliases: ["milan", "milano centrale"] },
  { name: "Torino", lat: 45.063, lng: 7.678, region: "Italia", aliases: ["turin", "torino porta susa"] },
];
