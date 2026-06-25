/**
 * scripts/audit-coords.ts — list dataset stations that resolve to NO map
 * coordinate, using the exact app resolution (stations.json + cities.ts).
 *   npx tsx scripts/audit-coords.ts
 */
import * as fs from "fs";
import * as path from "path";
import { StationRegistry } from "../src/data/stations";
import type { Station } from "../src/types";

const root = process.cwd();
const data = JSON.parse(
  fs.readFileSync(path.resolve(root, "public/data/tgvmax.json"), "utf-8"),
) as Array<{ origine?: string; destination?: string; od_happy_card?: string }>;
const stations = JSON.parse(
  fs.readFileSync(path.resolve(root, "data/stations.json"), "utf-8"),
) as Station[];

const ids = new Set<string>();
for (const r of data) {
  if (String(r.od_happy_card ?? "").toUpperCase() !== "OUI") continue;
  if (r.origine) ids.add(r.origine.trim());
  if (r.destination) ids.add(r.destination.trim());
}

const reg = new StationRegistry(stations);
reg.addMissing(ids);

const missing = [...ids].filter((id) => !reg.coords(id)).sort();
console.log(`Dataset stations (OUI): ${ids.size}`);
console.log(`Without coordinates: ${missing.length}`);
for (const id of missing) console.log("  -", id);
