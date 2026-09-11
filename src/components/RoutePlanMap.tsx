import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { STREET_TILE, streetTileOptions } from "../lib/mapTiles";
import type { RouteOrderedStop, RoutePoint } from "../lib/routePlan";

type Props = {
  start: RoutePoint | null;
  draftStops: RoutePoint[];
  ordered: RouteOrderedStop[] | null;
  geometry: [number, number][];
  onMapClick: (lat: number, lon: number) => void;
  fitKey: string;
};

export function RoutePlanMap({ start, draftStops, ordered, geometry, onMapClick, fitKey }: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;

  useEffect(() => {
    const el = elRef.current;
    if (!el || mapRef.current) return;
    const map = L.map(el, { scrollWheelZoom: true }).setView([-2.5, 118], 5);
    L.tileLayer(STREET_TILE.url, streetTileOptions()).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    map.on("click", (e) => {
      clickRef.current(e.latlng.lat, e.latlng.lng);
    });
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

    if (geometry.length >= 2) {
      const line = L.polyline(geometry, { color: "#0b6b62", weight: 4, opacity: 0.85 });
      line.addTo(layer);
      for (const p of geometry) bounds.push(p);
    }

    const marks = ordered?.length
      ? ordered
      : [
          ...(start ? [{ ...start, seq: 0, role: "start" as const }] : []),
          ...draftStops.map((s, i) => ({ ...s, seq: i + 1, role: "stop" as const })),
        ];

    for (const stop of marks) {
      const isStart = stop.role === "start";
      const isReturn = stop.role === "return";
      const color = isStart || isReturn ? "#9a3b12" : "#3b4cb3";
      const label = isStart ? "S" : isReturn ? "R" : String(stop.seq);
      const icon = L.divIcon({
        className: "route-plan-marker",
        html: `<span class="route-plan-marker-dot" style="background:${color}">${label}</span>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      const m = L.marker([stop.lat, stop.lon], { icon }).addTo(layer);
      m.bindPopup(`${stop.label || stop.role}<br>${stop.lat.toFixed(5)}, ${stop.lon.toFixed(5)}`);
      bounds.push([stop.lat, stop.lon]);
    }

    if (bounds.length && fitKey) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [36, 36], maxZoom: 14 });
    }
    map.invalidateSize();
  }, [start, draftStops, ordered, geometry, fitKey]);

  return <div ref={elRef} className="route-plan-map" role="presentation" />;
}
