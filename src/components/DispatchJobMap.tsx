import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { DispatchStop } from "../lib/dispatch";

type Props = {
  stops: DispatchStop[];
  fitKey: string;
};

export function DispatchJobMap({ stops, fitKey }: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el || mapRef.current) return;
    const map = L.map(el, { scrollWheelZoom: true }).setView([-6.9, 107.6], 11);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const bounds: L.LatLngExpression[] = [];
    const withCoords = stops.filter(
      (s) => s.lat != null && s.lon != null && Number.isFinite(s.lat) && Number.isFinite(s.lon),
    );
    if (withCoords.length >= 2) {
      const line = L.polyline(
        withCoords.map((s) => [s.lat as number, s.lon as number] as L.LatLngExpression),
        { color: "#0b6b62", weight: 4, opacity: 0.85 },
      );
      line.addTo(layer);
    }
    withCoords.forEach((stop, i) => {
      const color =
        stop.status === "done" ? "#1e5c34" : stop.status === "skipped" ? "#5e584f" : "#3b4cb3";
      const icon = L.divIcon({
        className: "route-plan-marker",
        html: `<span class="route-plan-marker-dot" style="background:${color}">${i + 1}</span>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      const m = L.marker([stop.lat as number, stop.lon as number], { icon }).addTo(layer);
      m.bindPopup(
        `${stop.name}${stop.zone ? ` · ${stop.zone}` : ""}<br>${(stop.lat as number).toFixed(5)}, ${(stop.lon as number).toFixed(5)}`,
      );
      bounds.push([stop.lat as number, stop.lon as number]);
    });
    if (bounds.length && fitKey) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [36, 36], maxZoom: 14 });
    }
    setTimeout(() => map.invalidateSize(), 50);
  }, [stops, fitKey]);

  return <div ref={elRef} className="dispatch-job-map" role="img" aria-label="Job stops map" />;
}
