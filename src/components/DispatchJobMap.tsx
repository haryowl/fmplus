import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { STREET_TILE, streetTileOptions } from "../lib/mapTiles";
import type { DispatchStop } from "../lib/dispatch";

type DraftPin = { lat: number; lon: number };

type Props = {
  stops: DispatchStop[];
  fitKey: string;
  draftPin?: DraftPin | null;
  onMapClick?: (lat: number, lon: number) => void;
  /** When true, always show a usable map even with no stop coords. */
  interactiveEmpty?: boolean;
  /** Road (or fallback) path from parent — [lat, lon][]. */
  routeGeometry?: [number, number][];
};

function asCoord(lat: unknown, lon: unknown): [number, number] | null {
  const a = Number(lat);
  const b = Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return [a, b];
}

export function DispatchJobMap({
  stops,
  fitKey,
  draftPin = null,
  onMapClick,
  interactiveEmpty = true,
  routeGeometry = [],
}: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;

  const withCoords = useMemo(() => {
    const out: Array<DispatchStop & { lat: number; lon: number }> = [];
    for (const s of stops) {
      const c = asCoord(s.lat, s.lon);
      if (!c) continue;
      out.push({ ...s, lat: c[0], lon: c[1] });
    }
    return out;
  }, [stops]);

  const stopLine = useMemo(
    () => withCoords.map((s) => [s.lat, s.lon] as [number, number]),
    [withCoords],
  );

  const roadLine = useMemo(() => {
    const cleaned: [number, number][] = [];
    for (const p of routeGeometry) {
      if (!Array.isArray(p) || p.length < 2) continue;
      const c = asCoord(p[0], p[1]);
      if (c) cleaned.push(c);
    }
    // Prefer road geometry only when it has real shape (more than stop-to-stop)
    if (cleaned.length >= 2) return cleaned;
    return [];
  }, [routeGeometry]);

  useEffect(() => {
    const el = elRef.current;
    if (!el || mapRef.current) return;
    const map = L.map(el, { scrollWheelZoom: true }).setView([-6.9175, 107.6191], 12);
    L.tileLayer(STREET_TILE.url, streetTileOptions()).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    map.on("click", (e) => {
      clickRef.current?.(e.latlng.lat, e.latlng.lng);
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

    // Always draw stop connectors so the sequence is visible even if OSRM fails.
    if (stopLine.length >= 2) {
      L.polyline(stopLine, {
        color: "#94a3b8",
        weight: 3,
        opacity: 0.55,
        dashArray: "6 8",
        lineJoin: "round",
      }).addTo(layer);
    }

    const lineCoords = roadLine.length >= 2 ? roadLine : stopLine;
    if (lineCoords.length >= 2) {
      L.polyline(lineCoords, {
        color: "#0b6b62",
        weight: 5,
        opacity: 0.92,
        lineJoin: "round",
        lineCap: "round",
      }).addTo(layer);
      for (const p of lineCoords) bounds.push(p);
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
      const m = L.marker([stop.lat, stop.lon], { icon }).addTo(layer);
      m.bindPopup(`${stop.name}${stop.zone ? ` · ${stop.zone}` : ""}`);
      bounds.push([stop.lat, stop.lon]);
    });

    if (draftPin && Number.isFinite(draftPin.lat) && Number.isFinite(draftPin.lon)) {
      const icon = L.divIcon({
        className: "route-plan-marker",
        html: `<span class="route-plan-marker-dot dispatch-draft-pin-dot">+</span>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      L.marker([draftPin.lat, draftPin.lon], { icon }).addTo(layer).bindPopup("New order pin");
      bounds.push([draftPin.lat, draftPin.lon]);
      if (!withCoords.length) {
        map.setView([draftPin.lat, draftPin.lon], Math.max(map.getZoom(), 15));
      }
    }

    if (bounds.length && fitKey) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [36, 36], maxZoom: 15 });
    } else if (interactiveEmpty && !bounds.length) {
      /* keep Bandung default */
    }
    setTimeout(() => map.invalidateSize(), 50);
  }, [stops, fitKey, draftPin, interactiveEmpty, withCoords, stopLine, roadLine]);

  return <div ref={elRef} className="dispatch-job-map" role="img" aria-label="Job stops map" />;
}
