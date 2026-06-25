import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { StationRegistry } from "../data/stations";

/** Small Leaflet wrapper that draws a hub connected to a set of stations. */
export class RouteMap {
  private map: L.Map | null = null;
  private layer: L.LayerGroup | null = null;

  constructor(
    private container: HTMLElement,
    private registry: StationRegistry,
  ) {}

  private ensure(): { map: L.Map; layer: L.LayerGroup } {
    if (!this.map) {
      this.map = L.map(this.container, { scrollWheelZoom: true }).setView([46.6, 2.4], 5);
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

  /** Render a hub station linked to each of `others`. Unknown coords are skipped. */
  show(hub: string, others: string[]): void {
    const { map, layer } = this.ensure();
    layer.clearLayers();
    const pts: L.LatLngExpression[] = [];

    const hubC = this.registry.coords(hub);
    if (hubC) {
      pts.push(hubC);
      L.circleMarker(hubC, {
        radius: 8,
        color: "#0f7a52",
        fillColor: "#0f7a52",
        fillOpacity: 1,
        weight: 2,
      })
        .bindTooltip(this.registry.label(hub), { direction: "top" })
        .addTo(layer);
    }

    for (const o of others) {
      const c = this.registry.coords(o);
      if (!c) continue;
      pts.push(c);
      if (hubC) {
        L.polyline([hubC, c], { color: "#34d399", weight: 1.5, opacity: 0.6 }).addTo(layer);
      }
      L.circleMarker(c, {
        radius: 6,
        color: "#0f7a52",
        fillColor: "#34d399",
        fillOpacity: 0.9,
        weight: 2,
      })
        .bindTooltip(this.registry.label(o), { direction: "top" })
        .addTo(layer);
    }

    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(0.25));
    else if (pts.length === 1) map.setView(pts[0]!, 6);
  }
}
