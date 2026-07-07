import "./styles.css";
import { loadDataset } from "./data/dataset";
import { StationRegistry } from "./data/stations";
import type { Station } from "./types";
import stationData from "../data/stations.json";
import { initApp } from "./app";
import { registerServiceWorker } from "./pwa/register";
import { el } from "./ui/dom";
import { t, setLang, detectLang } from "./i18n";

/** Centered spinner + label shown while the dataset loads. */
function loadingStateEl(): HTMLElement {
  return el("div", { class: "app-loading", attrs: { role: "status" } }, [
    el("span", { class: "spinner", attrs: { "aria-hidden": "true" } }),
    el("p", { class: "app-loading-label", text: t("loading") }),
  ]);
}

/** Clean error card with a retry action if the dataset fails to load. */
function errorStateEl(): HTMLElement {
  return el("div", { class: "error-state", attrs: { role: "alert" } }, [
    el("span", {
      class: "error-icon",
      attrs: { "aria-hidden": "true" },
      html: `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>`,
    }),
    el("p", { class: "error-title", text: t("err_load") }),
    el("button", {
      class: "btn btn-primary",
      type: "button",
      text: t("act_retry"),
      on: { click: () => location.reload() },
    }),
  ]);
}

const root = document.getElementById("app");
if (root) {
  // The boot UI (loading/error) renders before initApp picks up the saved
  // language, so localize it from the browser here.
  setLang(detectLang());
  root.replaceChildren(loadingStateEl());
  const registry = new StationRegistry(stationData as Station[]);
  loadDataset()
    .then((dataset) => initApp(root, dataset, registry))
    .catch((err: unknown) => {
      console.error(err);
      root.replaceChildren(errorStateEl());
    });
}

registerServiceWorker();
