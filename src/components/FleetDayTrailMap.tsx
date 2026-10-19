import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { STREET_TILE, streetTileOptions } from "../lib/mapTiles";

type Props = {
  path: [number, number][];
  className?: string;
};

const startIcon = L.divIcon({
  className: "trip-end-marker trip-end-marker-start",
  html: '<span class="trip-end-marker-dot">S</span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

const endIcon = L.divIcon({
  className: "trip-end-marker trip-end-marker-end",
  html: '<span class="trip-end-marker-dot">E</span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

export function FleetDayTrailMap({ path, className }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || mapRef.current) return;
    const map = L.map(el, { scrollWheelZoom: true }).setView([-2.5, 118], 5);
    L.tileLayer(STREET_TILE.url, streetTileOptions()).addTo(map);
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
    if (path.length < 2) {
      map.setView([-2.5, 118], 5);
      return;
    }
    const line = L.polyline(path, {
      color: "#0b6b62",
      weight: 4,
      opacity: 0.9,
    }).addTo(layer);
    L.marker(path[0], { icon: startIcon }).addTo(layer);
    L.marker(path[path.length - 1], { icon: endIcon }).addTo(layer);
    map.fitBounds(line.getBounds().pad(0.15));
  }, [path]);

  return <div ref={hostRef} className={className || "fleet-day-map leaflet-container"} />;
}
