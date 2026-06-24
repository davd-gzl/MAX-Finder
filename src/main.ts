import "./styles.css";
import { loadDataset } from "./data/dataset";
import { StationRegistry } from "./data/stations";
import type { Station } from "./types";
import stationData from "../data/stations.json";
import { initApp } from "./app";
import { registerServiceWorker } from "./pwa/register";

const root = document.getElementById("app");
if (root) {
  const registry = new StationRegistry(stationData as Station[]);
  loadDataset()
    .then((dataset) => initApp(root, dataset, registry))
    .catch((err: unknown) => {
      root.textContent = "Erreur de chargement des données.";
      console.error(err);
    });
}

registerServiceWorker();
