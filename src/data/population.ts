import { normalizeText } from "./stations";

/**
 * Approximate commune populations (INSEE, latest legal populations rounded to
 * the nearest thousand) for the French cities the app commonly shows. Used only
 * as an informative statistic — population is NOT a popularity measure. Cities
 * absent here simply show no figure. Keyed by accent-folded city name.
 */
const POPULATION: Record<string, number> = {
  paris: 2_100_000, marseille: 873_000, lyon: 522_000, toulouse: 504_000,
  nice: 343_000, nantes: 323_000, montpellier: 302_000, strasbourg: 291_000,
  bordeaux: 261_000, lille: 236_000, rennes: 222_000, reims: 182_000,
  "le havre": 165_000, "saint-etienne": 173_000, toulon: 180_000,
  grenoble: 158_000, dijon: 160_000, angers: 155_000, nimes: 149_000,
  "clermont-ferrand": 147_000, "le mans": 145_000, "aix-en-provence": 145_000,
  brest: 140_000, tours: 137_000, amiens: 134_000, limoges: 130_000,
  annecy: 130_000, perpignan: 121_000, besancon: 119_000, metz: 117_000,
  orleans: 116_000, rouen: 114_000, mulhouse: 108_000, caen: 105_000,
  nancy: 104_000, avignon: 92_000, poitiers: 88_000, dunkerque: 86_000,
  beziers: 79_000, pau: 76_000, "la rochelle": 77_000, cannes: 74_000,
  antibes: 73_000, calais: 67_000, colmar: 69_000, bourges: 64_000,
  valence: 65_000, quimper: 63_000, montauban: 62_000, "chambery": 59_000,
  niort: 59_000, lorient: 57_000, narbonne: 56_000, vannes: 54_000,
  bayonne: 52_000, "saint-malo": 46_000, carcassonne: 46_000, arras: 42_000,
  tarbes: 41_000, angouleme: 41_000, biarritz: 25_000, lourdes: 13_000,
  bruxelles: 188_000, geneve: 203_000, lausanne: 140_000, luxembourg: 132_000,
};

/** Population (number) for a city, or null if unknown. */
export function cityPopulation(city: string): number | null {
  return POPULATION[normalizeText(city)] ?? null;
}
