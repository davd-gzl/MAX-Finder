import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { StationRegistry } from "../data/stations";

const EMERALD = "#0f7a52";

/**
 * Reachability tint: direct (0 changes) reads green, and each extra connection
 * pushes the hue toward red (capped at 3) — so the map doubles as a heat map of
 * how easy each destination is to reach.
 */
function reachColor(connections: number): string {
  // Direct = green, 1 change = orange, 2+ changes = red. Capped at 2 so the
  // gradient stays legible for realistic data (which rarely needs >2 changes).
  const tNorm = Math.min(Math.max(connections, 0), 2) / 2;
  const hue = 150 - 150 * tNorm; // 150° green → 0° red
  return `hsl(${Math.round(hue)}, 70%, 45%)`;
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

  private ensure(): { map: L.Map; layer: L.LayerGroup } {
    if (!this.map) {
      this.map = L.map(this.container, { scrollWheelZoom: true }).setView([46.6, 2.4], 5);
      this.map.attributionControl.setPrefix(false); // drop the default "Leaflet" + flag prefix
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
        maxZoom: 18,
      }).addTo(this.map);
      this.layer = L.layerGroup().addTo(this.map);
    }
    return { map: this.map, layer: this.layer as L.LayerGroup };
  }

  invalidate(): void {
    this.map?.invalidateSize();
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
          : { radius: 6, color: tint, fillColor: tint, weight: 1.5 };
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
    const { map, layer } = this.ensure();
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
    const { map, layer } = this.ensure();
    layer.clearLayers();
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
}
