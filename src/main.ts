import "./styles.css";
import { loadDataset } from "./data/dataset";
import { StationRegistry } from "./data/stations";
import type { Station } from "./types";
import stationData from "../data/stations.json";
import { initApp } from "./app";
import { registerServiceWorker } from "./pwa/register";

(window as unknown as { __mfBoot?: boolean }).__mfBoot = true;

const root = document.getElementById("app");
if (root) {
  // The SEO build prerenders the home shell into #app. When present, keep that
  // static markup painted while the dataset loads (initApp rebuilds #app anyway)
  // instead of flashing it away to a spinner; only show the spinner when #app is
  // empty — a normal, non-prerendered build.
  const prerendered = root.querySelector(".mode-tabs") != null;
  if (!prerendered) {
    root.innerHTML = '<div class="app-loading"><span class="spinner" aria-hidden="true"></span></div>';
  }
  const registry = new StationRegistry(stationData as Station[]);
  loadDataset()
    .then((dataset) => initApp(root, dataset, registry))
    .catch((err: unknown) => {
      root.textContent = "Erreur de chargement des données.";
      console.error(err);
    });
}

registerServiceWorker();
