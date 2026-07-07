import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { StationRegistry } from "../data/stations";

const EMERALD = "#0f7a52";

/**
 * Reachability tint: direct (0 changes) reads green, and each extra connection
 * pushes the hue toward red (capped at 2) — so the map doubles as a heat map of
 * how easy each destination is to reach.
 */
function reachColor(connections: number): string {
  // Direct = green, 1 change = orange, 2+ changes = red. Capped at 2 so the
  // gradient stays legible for realistic data (which rarely needs >2 changes).
  const tNorm = Math.min(Math.max(connections, 0), 2) / 2;
  const hue = 150 - 150 * tNorm; // 150° green → 0° red
  // Deep, saturated fills read clearly against the basemap and, paired with the
  // white pin outline, stay distinct where destinations cluster together.
  return `hsl(${Math.round(hue)}, 75%, 34%)`;
}

/** Optional rich detail for a station marker (hover tooltip + click popup). */
export interface MarkerInfo {
  title: string;
  meta?: string;
  /** Number of changes to reach this station — drives the pin's red-ness. */
  connections?: number;
  /** A primary action surfaced as a button in the click popup. */
  action?: { label: string; run: () => void };
}

/** Small Leaflet wrapper that draws routes between stations on a map of France. */
export class RouteMap {
  private map: L.Map | null = null;
  private layer: L.LayerGroup | null = null;
  private info: Map<string, MarkerInfo> = new Map();
  /** Called with a station id when its marker is clicked. */
  onSelect: ((id: string) => void) | null = null;

  constructor(
    private container: HTMLElement,
    private registry: StationRegistry,
  ) {}

  /** Supply per-station detail used for marker hover tooltips and click popups. */
  setInfo(info: Map<string, MarkerInfo>): void {
    this.info = info;
  }

  private ensure(): { map: L.Map; layer: L.LayerGroup } | null {
    if (this.map && this.layer) return { map: this.map, layer: this.layer };
    try {
      this.map = L.map(this.container, { scrollWheelZoom: true }).setView([46.6, 2.4], 5);
      this.map.attributionControl.setPrefix(false); // drop the default "Leaflet" + flag prefix
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
        maxZoom: 18,
      }).addTo(this.map);
      this.layer = L.layerGroup().addTo(this.map);
      return { map: this.map, layer: this.layer };
    } catch {
      // Leaflet needs a laid-out DOM; in environments without one (e.g. jsdom
      // unit tests) it throws. Degrade to a no-op map rather than crash the app.
      this.map = null;
      this.layer = null;
      return null;
    }
  }

  invalidate(): void {
    this.map?.invalidateSize();
  }

  /**
   * Show the bare basemap of France with no markers — the resting state before a
   * search has run, so the map reads as "ready" instead of an empty grey box.
   */
  base(): void {
    const e = this.ensure();
    if (!e) return;
    e.layer.clearLayers();
    this.info = new Map();
    e.map.setView([46.6, 2.4], 5);
  }

  /** Pan/zoom to a station (if its coordinates are known). */
  focus(id: string): void {
    const c = this.registry.coords(id);
    if (c && this.map) this.map.setView(c, 8, { animate: true });
  }

  // Three single-hue marker roles so the hub/origin reads at a glance:
  //  anchor — origin/centre (larger, white-ringed solid)
  //  dest   — a destination/endpoint (solid)
  //  via    — an interchange (smaller, hollow)
  private marker(id: string, c: [number, number], role: "anchor" | "dest" | "via"): L.CircleMarker {
    const inf = this.info.get(id);
    // Destinations are tinted by how many changes they take; origin/interchange
    // keep the brand emerald.
    const tint = role === "dest" && inf?.connections != null ? reachColor(inf.connections) : EMERALD;
    const style =
      role === "anchor"
        ? { radius: 8, color: "#ffffff", fillColor: EMERALD, weight: 2.5 }
        : role === "via"
          ? { radius: 5, color: EMERALD, fillColor: "#ffffff", weight: 2 }
          : // A white ring around each destination pin keeps clustered pins
            // readable — without it, same-coloured fills merge into one blob.
            { radius: 6, color: "#ffffff", fillColor: tint, weight: 2 };
    const m = L.circleMarker(c, { ...style, fillOpacity: 1 });
    const title = inf?.title ?? this.registry.label(id);

    // Hover card: title + a concise trip summary (built with textContent — never
    // innerHTML — so station labels can't inject markup).
    const tip = document.createElement("div");
    tip.className = "map-tip";
    const tipTitle = document.createElement("strong");
    tipTitle.textContent = title;
    tip.append(tipTitle);
    if (inf?.meta) {
      const meta = document.createElement("span");
      meta.className = "map-tip-meta";
      meta.textContent = inf.meta;
      tip.append(meta);
    }
    m.bindTooltip(tip, { direction: "top", offset: [0, -6], className: "map-tooltip", opacity: 1 });

    // Click card: same detail plus a primary action (e.g. open the exact trip).
    if (inf?.meta || inf?.action) {
      const pop = document.createElement("div");
      pop.className = "map-pop";
      const popTitle = document.createElement("strong");
      popTitle.className = "map-pop-title";
      popTitle.textContent = title;
      pop.append(popTitle);
      if (inf?.meta) {
        const meta = document.createElement("div");
        meta.className = "map-pop-meta";
        meta.textContent = inf.meta;
        pop.append(meta);
      }
      if (inf?.action) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "map-pop-btn";
        btn.textContent = inf.action.label;
        const action = inf.action;
        btn.addEventListener("click", () => {
          m.closePopup();
          action.run();
        });
        pop.append(btn);
      }
      m.bindPopup(pop, { closeButton: false, className: "map-popup", offset: [0, -4] });
    }

    if (this.onSelect) m.on("click", () => this.onSelect?.(id));
    return m;
  }

  /** Render a hub station linked to each of `others`. Unknown coords are skipped. */
  show(hub: string, others: string[]): void {
    const e = this.ensure();
    if (!e) return;
    const { map, layer } = e;
    layer.clearLayers();
    const pts: L.LatLngExpression[] = [];

    const hubC = this.registry.coords(hub);

    for (const o of others) {
      const c = this.registry.coords(o);
      if (!c) continue;
      pts.push(c);
      if (hubC) {
        const conn = this.info.get(o)?.connections;
        const spoke = conn != null ? reachColor(conn) : EMERALD;
        L.polyline([hubC, c], { color: spoke, weight: 1.5, opacity: 0.5 }).addTo(layer);
      }
      this.marker(o, c, "dest").addTo(layer);
    }

    // Draw the hub last so it sits on top of the spokes.
    if (hubC) {
      pts.push(hubC);
      this.marker(hub, hubC, "anchor").addTo(layer);
    }

    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(0.25));
    else if (pts.length === 1) map.setView(pts[0]!, 6);
  }

  /**
   * Draw an ordered journey path: origin → interchange(s) → destination.
   * Endpoints are solid markers; interchanges are smaller hollow markers so a
   * "via Paris" stop is visible as a secondary point along the line.
   */
  route(stations: string[]): void {
    const e = this.ensure();
    if (!e) return;
    const { map, layer } = e;
    layer.clearLayers();
    // Drop any connection-count tints left over from a previous browse (showMap):
    // an exact-trip/route destination is a plain endpoint, not a heat-map pin, so
    // it must read emerald rather than a stale reachColor() from the earlier view.
    this.info = new Map();
    const known = stations
      .map((id) => ({ id, c: this.registry.coords(id) }))
      .filter((s): s is { id: string; c: [number, number] } => Boolean(s.c));

    if (known.length > 1) {
      L.polyline(
        known.map((s) => s.c),
        { color: EMERALD, weight: 2, opacity: 0.6 },
      ).addTo(layer);
    }
    const lastIdx = known.length - 1;
    known.forEach((s, i) => {
      const role = i === 0 ? "anchor" : i === lastIdx ? "dest" : "via";
      this.marker(s.id, s.c, role).addTo(layer);
    });

    const pts = known.map((s) => s.c);
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(0.3));
    else if (pts.length === 1) map.setView(pts[0]!, 6);
  }

  /**
   * Overlay search-radius circles around `centers` and mark the `nearby` stations
   * found inside them. Drawn on top of the current layer (call after `route`), and
   * the view is widened so the whole radius is visible.
   */
  radius(centers: { id: string; km: number }[], nearby: string[]): void {
    const e = this.ensure();
    if (!e) return;
    const { map, layer } = e;
    let bounds: L.LatLngBounds | null = null;
    for (const { id, km } of centers) {
      const c = this.registry.coords(id);
      if (!c) continue;
      const circle = L.circle(c, {
        radius: km * 1000,
        color: EMERALD,
        weight: 1,
        opacity: 0.5,
        fillColor: EMERALD,
        fillOpacity: 0.06,
      }).addTo(layer);
      bounds = bounds ? bounds.extend(circle.getBounds()) : circle.getBounds();
    }
    for (const id of nearby) {
      const c = this.registry.coords(id);
      if (!c) continue;
      this.marker(id, c, "via").addTo(layer);
    }
    if (bounds) map.fitBounds(bounds.pad(0.1));
  }
}
