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
    const map = L.map(el, { scrollWheelZoom: false });
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
      const b = map.getBounds();
      const view = pathsForMapView(
        data.paths,
        b.isValid()
          ? { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }
          : null,
        MAX_MAP_POINTS,
      );
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
            OpenStreetMap only — GPS jumps and time gaps break the line the same way distance does.
            Zoom in to see every point; the overview may simplify a long route.
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
