import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { STREET_TILE, streetTileOptions } from "../lib/mapTiles";

type Basemap = "light" | "satellite";

type Props = {
  path: [number, number][];
  className?: string;
  /** 0..1 progress along path for replay marker; null hides marker */
  replayT?: number | null;
  showBasemapToggle?: boolean;
};

const SAT_TILE = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  maxZoom: 19,
  attribution:
    'Tiles &copy; <a href="https://www.esri.com/">Esri</a> — Source: Esri, Maxar, Earthstar Geographics',
};

const startIcon = L.divIcon({
  className: "trip-end-marker trip-end-marker-start",
  html: '<span class="trip-end-marker-dot">S</span>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

const endIcon = L.divIcon({
  className: "trip-end-marker trip-end-marker-end",
  html: '<span class="trip-end-marker-dot">E</span>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

const playIcon = L.divIcon({
  className: "trip-end-marker trip-end-marker-play",
  html: '<span class="trip-end-marker-dot">●</span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function pointAlong(path: [number, number][], t: number): [number, number] | null {
  if (path.length === 0) return null;
  if (path.length === 1) return path[0];
  const clamped = Math.max(0, Math.min(1, t));
  const idx = clamped * (path.length - 1);
  const i0 = Math.floor(idx);
  const i1 = Math.min(path.length - 1, i0 + 1);
  const f = idx - i0;
  const a = path[i0];
  const b = path[i1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

export function FleetDayTrailMap({
  path,
  className,
  replayT = null,
  showBasemapToggle = true,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const playRef = useRef<L.Marker | null>(null);
  const [basemap, setBasemap] = useState<Basemap>("light");

  useEffect(() => {
    const el = hostRef.current;
    if (!el || mapRef.current) return;
    const map = L.map(el, { scrollWheelZoom: true, zoomControl: true }).setView([-2.5, 118], 5);
    const tile = L.tileLayer(STREET_TILE.url, streetTileOptions()).addTo(map);
    tileRef.current = tile;
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      tileRef.current = null;
      playRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileRef.current) {
      map.removeLayer(tileRef.current);
      tileRef.current = null;
    }
    if (basemap === "satellite") {
      tileRef.current = L.tileLayer(SAT_TILE.url, {
        maxZoom: SAT_TILE.maxZoom,
        attribution: SAT_TILE.attribution,
      }).addTo(map);
    } else {
      tileRef.current = L.tileLayer(STREET_TILE.url, streetTileOptions()).addTo(map);
    }
  }, [basemap]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    playRef.current = null;
    if (path.length < 2) {
      map.setView([-2.5, 118], 5);
      return;
    }
    // Soft underlay + dashed core (sample-style route)
    L.polyline(path, {
      color: "#0d9488",
      weight: 8,
      opacity: 0.28,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(layer);
    const line = L.polyline(path, {
      color: "#0f766e",
      weight: 4,
      opacity: 0.95,
      dashArray: "10 8",
      lineCap: "round",
      lineJoin: "round",
    }).addTo(layer);
    L.marker(path[0], { icon: startIcon, zIndexOffset: 400 }).addTo(layer);
    L.marker(path[path.length - 1], { icon: endIcon, zIndexOffset: 400 }).addTo(layer);
    map.fitBounds(line.getBounds().pad(0.18));
  }, [path]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    if (replayT == null || path.length < 2) {
      if (playRef.current) {
        layer.removeLayer(playRef.current);
        playRef.current = null;
      }
      return;
    }
    const pt = pointAlong(path, replayT);
    if (!pt) return;
    if (!playRef.current) {
      playRef.current = L.marker(pt, { icon: playIcon, zIndexOffset: 600 }).addTo(layer);
    } else {
      playRef.current.setLatLng(pt);
    }
  }, [replayT, path]);

  return (
    <div className={`fleet-day-map-wrap${className ? ` ${className}` : ""}`}>
      <div ref={hostRef} className="fleet-day-map leaflet-container" />
      {showBasemapToggle ? (
        <div className="fleet-day-basemap" role="group" aria-label="Basemap">
          <button
            type="button"
            className={basemap === "light" ? "is-active" : ""}
            onClick={() => setBasemap("light")}
          >
            Light
          </button>
          <button
            type="button"
            className={basemap === "satellite" ? "is-active" : ""}
            onClick={() => setBasemap("satellite")}
          >
            Satellite
          </button>
        </div>
      ) : null}
    </div>
  );
}
