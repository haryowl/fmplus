import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  colorSegments,
  defaultMapMode,
  MAP_COLOR,
  MAX_MAP_POINTS,
  pathsForMapView,
  type MapMode,
  type TrackMapData,
} from "../lib/trackMap";

type Props = {
  data: TrackMapData;
};

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export function TrackMap({ data }: Props) {
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
  }, [data, mode]);

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
            A long straight stretch means no points were recorded in between (often tens of km). Distance still ignores jumps over 1.5 km.
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
