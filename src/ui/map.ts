import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { StationRegistry } from "../data/stations";

const EMERALD = "#0f7a52";

/** Small Leaflet wrapper that draws routes between stations on a map of France. */
export class RouteMap {
  private map: L.Map | null = null;
  private layer: L.LayerGroup | null = null;
  /** Called with a station id when its marker is clicked. */
  onSelect: ((id: string) => void) | null = null;

  constructor(
    private container: HTMLElement,
    private registry: StationRegistry,
  ) {}

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
    const style =
      role === "anchor"
        ? { radius: 8, color: "#ffffff", fillColor: EMERALD, weight: 2.5 }
        : role === "via"
          ? { radius: 5, color: EMERALD, fillColor: "#ffffff", weight: 2 }
          : { radius: 6, color: EMERALD, fillColor: EMERALD, weight: 1.5 };
    const m = L.circleMarker(c, { ...style, fillOpacity: 1 }).bindTooltip(this.registry.label(id), {
      direction: "top",
    });
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
        L.polyline([hubC, c], { color: EMERALD, weight: 1.5, opacity: 0.45 }).addTo(layer);
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

  /**
   * Overlay search-radius circles around `centers` and mark the `nearby` stations
   * found inside them. Drawn on top of the current layer (call after `route`), and
   * the view is widened so the whole radius is visible.
   */
  radius(centers: { id: string; km: number }[], nearby: string[]): void {
    const { map, layer } = this.ensure();
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
