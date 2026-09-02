import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { formatLiters } from "../lib/format";
import type { RefillEvent } from "../lib/metrics";
import { offsetToMinutes } from "../lib/time";
import {
  colorSegments,
  defaultMapMode,
  MAP_COLOR,
  MAX_MAP_POINTS,
  pathsForMapView,
  type MapMode,
  type TrackMapData,
} from "../lib/trackMap";

type NearbyFuel = {
  found: boolean;
  name?: string;
  distanceM?: number;
  source?: string;
};

type Props = {
  data: TrackMapData;
  refills?: RefillEvent[];
  timezone?: string;
};

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const refillIcon = L.divIcon({
  className: "refill-marker",
  html: '<span class="refill-marker-dot"></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  popupAnchor: [0, -8],
});

const startIcon = L.divIcon({
  className: "trip-end-marker trip-end-marker-start",
  html: '<span class="trip-end-marker-dot">S</span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  popupAnchor: [0, -10],
});

const endIcon = L.divIcon({
  className: "trip-end-marker trip-end-marker-end",
  html: '<span class="trip-end-marker-dot">E</span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  popupAnchor: [0, -10],
});

const fuelLookup = new Map<string, Promise<NearbyFuel>>();

function fuelCacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatWhen(ms: number, offset: string): string {
  const shifted = new Date(ms + offsetToMinutes(offset) * 60_000);
  const iso = shifted.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function googleMapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lon}`)}`;
}

function lookupNearbyFuel(lat: number, lon: number): Promise<NearbyFuel> {
  const key = fuelCacheKey(lat, lon);
  const hit = fuelLookup.get(key);
  if (hit) return hit;
  const req = fetch(`/api/nearby-fuel?lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lon))}`)
    .then(async (res) => {
      if (!res.ok) return { found: false as const };
      return (await res.json()) as NearbyFuel;
    })
    .catch(() => ({ found: false as const }));
  fuelLookup.set(key, req);
  return req;
}

function endpointPopup(label: string, point: { ms: number; lat: number; lon: number }, timezone: string): string {
  const maps = googleMapsUrl(point.lat, point.lon);
  return `<div class="refill-popup">
    <strong>${escapeHtml(label)}</strong>
    <div>${escapeHtml(formatWhen(point.ms, timezone))}</div>
    <a href="${maps}" target="_blank" rel="noopener noreferrer">Open in Google Maps</a>
  </div>`;
}
  const lat = event.lat as number;
  const lon = event.lon as number;
  const maps = googleMapsUrl(lat, lon);
  return `<div class="refill-popup">
    <strong>Fuel refill</strong>
    <div>${escapeHtml(formatLiters(event.liters))} L · ${escapeHtml(formatWhen(event.ms, timezone))}</div>
    <div class="refill-popup-osm">${nearby}</div>
    <a href="${maps}" target="_blank" rel="noopener noreferrer">Open in Google Maps</a>
  </div>`;
}

export function TrackMap({ data, refills = [], timezone = "+08:00" }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fittedForRef = useRef<TrackMapData | null>(null);
  const [mode, setMode] = useState<MapMode>(() => defaultMapMode(data));
  const [drawnCount, setDrawnCount] = useState(data.pointCount);

  useEffect(() => {
    setMode(defaultMapMode(data));
  }, [data]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || mapRef.current) return;
    const map = L.map(el, { scrollWheelZoom: false }).setView([-2.5, 118], 5);
    L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 18 }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const id = window.setTimeout(() => map.invalidateSize(), 80);
    return () => {
      window.clearTimeout(id);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = layerRef.current;
    if (!map || !group) return;

    const draw = () => {
      const alreadyFitted = fittedForRef.current === data;
      let box = null;
      if (alreadyFitted) {
        const b = map.getBounds();
        if (b.isValid()) {
          box = {
            south: b.getSouth(),
            west: b.getWest(),
            north: b.getNorth(),
            east: b.getEast(),
          };
        }
      }
      const view = pathsForMapView(data.paths, box, MAX_MAP_POINTS);
      group.clearLayers();
      const segments = colorSegments(view, mode, data.altMin, data.altMax);
      const bounds = L.latLngBounds([]);
      let vertices = 0;
      for (const path of view) vertices += path.length;
      for (const segment of segments) {
        const line = L.polyline(segment.points, {
          color: segment.color,
          weight: 5,
          opacity: 0.9,
          lineJoin: "round",
          lineCap: "round",
        });
        group.addLayer(line);
        bounds.extend(line.getBounds());
      }
      for (const event of refills) {
        if (event.lat === null || event.lon === null) continue;
        const lat = event.lat;
        const lon = event.lon;
        const marker = L.marker([lat, lon], { icon: refillIcon, zIndexOffset: 800 });
        marker.bindPopup(popupHtml(event, timezone, "Looking up nearby fuel (OpenStreetMap)…"), {
          maxWidth: 280,
        });
        marker.on("popupopen", () => {
          void lookupNearbyFuel(lat, lon).then((nearby) => {
            const text = nearby.found && nearby.name
              ? `Nearby (OpenStreetMap): ${nearby.name}${
                  nearby.distanceM !== undefined ? ` · ${nearby.distanceM} m` : ""
                }`
              : "No mapped fuel station within 300 m (OpenStreetMap)";
            marker.setPopupContent(popupHtml(event, timezone, text));
          });
        });
        group.addLayer(marker);
        bounds.extend([lat, lon]);
      }
      const start = data.start;
      const end = data.end;
      const sameEnds =
        start &&
        end &&
        Math.abs(start.lat - end.lat) < 1e-5 &&
        Math.abs(start.lon - end.lon) < 1e-5;
      if (start && !sameEnds) {
        const marker = L.marker([start.lat, start.lon], { icon: startIcon, zIndexOffset: 900 });
        marker.bindPopup(endpointPopup("Start", start, timezone), { maxWidth: 280 });
        group.addLayer(marker);
        bounds.extend([start.lat, start.lon]);
      }
      if (end) {
        const marker = L.marker([end.lat, end.lon], { icon: endIcon, zIndexOffset: 910 });
        marker.bindPopup(
          endpointPopup(sameEnds ? "Start & end" : "End", end, timezone),
          { maxWidth: 280 },
        );
        group.addLayer(marker);
        bounds.extend([end.lat, end.lon]);
      }
      setDrawnCount(vertices);
      if (fittedForRef.current !== data && bounds.isValid()) {
        fittedForRef.current = data;
        map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 });
      }
      map.invalidateSize();
    };

    draw();
    map.on("zoomend moveend", draw);
    return () => {
      map.off("zoomend moveend", draw);
    };
  }, [data, mode, refills, timezone]);

  const sampled =
    drawnCount < data.pointCount
      ? `Showing ${drawnCount.toLocaleString("en-US")} of ${data.pointCount.toLocaleString("en-US")} points — zoom in for full detail`
      : `${data.pointCount.toLocaleString("en-US")} points`;

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Track map</h2>
          <p>
            OpenStreetMap only — every GPS sample is joined in time order, like Armada.
            Blue S is the first point in the range, red E is the last. Orange pins are tank-rise refills.
            Click a pin for time and Google Maps. Station names are the nearest mapped fuel amenity, not a guaranteed pump name.
          </p>
        </div>
        <div className="field">
          <label htmlFor="map-mode">Colour by</label>
          <select id="map-mode" value={mode} onChange={(e) => setMode(e.target.value as MapMode)}>
            <option value="path">Track</option>
            {data.hasAltitude && <option value="elevation">Elevation</option>}
            {data.hasRoad && <option value="road">Road condition</option>}
          </select>
        </div>
      </div>
      {mode === "elevation" && (
        <div className="legend terrain-legend">
          <span>
            <i className="swatch" style={{ background: MAP_COLOR.low }} /> Low
          </span>
          <span>
            <i className="swatch" style={{ background: MAP_COLOR.mid }} /> Mid
          </span>
          <span>
            <i className="swatch" style={{ background: MAP_COLOR.high }} /> High
          </span>
        </div>
      )}
      {mode === "road" && (
        <div className="legend terrain-legend">
          <span>
            <i className="swatch" style={{ background: MAP_COLOR.low }} /> Smooth
          </span>
          <span>
            <i className="swatch" style={{ background: MAP_COLOR.mid }} /> Rough
          </span>
          <span>
            <i className="swatch" style={{ background: MAP_COLOR.high }} /> Bumpy
          </span>
        </div>
      )}
      <div className="legend terrain-legend">
        {data.start && (
          <span>
            <i className="swatch start-swatch" /> Start
          </span>
        )}
        {data.end && (
          <span>
            <i className="swatch end-swatch" /> End
          </span>
        )}
        {refills.length > 0 && (
          <span>
            <i className="swatch refill-swatch" /> Refill ({refills.length})
          </span>
        )}
      </div>
      <div ref={hostRef} className="map-wrap" />
      <p className="map-caption">
        {sampled}
        {data.hasAltitude && data.altMin !== null && data.altMax !== null
          ? ` · altitude ${Math.round(data.altMin)}–${Math.round(data.altMax)} m`
          : ""}
      </p>
    </section>
  );
}
