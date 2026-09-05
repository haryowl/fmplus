import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { TripSegment } from "../lib/tripSegments";

export type MapFocusPoint = {
  lat: number;
  lon: number;
  label?: string;
};

type Props = {
  segments: TripSegment[];
  selectedId: string | null;
  focusPoint?: MapFocusPoint | null;
  onSelect: (id: string | null) => void;
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

const refillIcon = L.divIcon({
  className: "refill-marker",
  html: '<span class="refill-marker-dot"></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function segmentBounds(seg: TripSegment): L.LatLngBoundsExpression | null {
  if (seg.path.length >= 2) return seg.path;
  if (seg.startLat !== null && seg.startLon !== null) {
    const pts: [number, number][] = [[seg.startLat, seg.startLon]];
    if (seg.endLat !== null && seg.endLon !== null) pts.push([seg.endLat, seg.endLon]);
    return pts;
  }
  return null;
}

export function TripSegmentMap({ segments, selectedId, focusPoint = null, onSelect }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const focusLayerRef = useRef<L.LayerGroup | null>(null);
  const fittedKeyRef = useRef("");

  const trips = useMemo(
    () => segments.filter((s) => s.status === "trip" && s.paths.some((p) => p.length >= 2)),
    [segments],
  );
  const markers = useMemo(
    () =>
      segments.filter(
        (s) =>
          (s.status === "idle" || s.status === "stop") &&
          s.startLat !== null &&
          s.startLon !== null,
      ),
    [segments],
  );

  useEffect(() => {
    const el = hostRef.current;
    if (!el || mapRef.current) return;
    const map = L.map(el, { scrollWheelZoom: true }).setView([-2.5, 118], 5);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    focusLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      focusLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const bounds: L.LatLngExpression[] = [];

    for (const seg of trips) {
      const selected = seg.id === selectedId;
      for (const piece of seg.paths) {
        if (piece.length < 2) continue;
        const line = L.polyline(piece, {
          color: seg.color,
          weight: selected ? 8 : 4,
          opacity: selected ? 1 : 0.72,
        });
        line.on("click", () => onSelect(seg.id));
        line.addTo(layer);
        for (const pt of piece) bounds.push(pt);
      }
      if (seg.startLat !== null && seg.startLon !== null) {
        L.marker([seg.startLat, seg.startLon], { icon: startIcon }).addTo(layer);
      }
      if (seg.endLat !== null && seg.endLon !== null) {
        L.marker([seg.endLat, seg.endLon], { icon: endIcon }).addTo(layer);
      }
    }

    for (const seg of markers) {
      const selected = seg.id === selectedId;
      const marker = L.circleMarker([seg.startLat as number, seg.startLon as number], {
        radius: selected ? 9 : 5,
        color: seg.color,
        fillColor: seg.color,
        fillOpacity: 0.85,
        weight: selected ? 3 : 1,
      });
      marker.bindTooltip(`${seg.status} · ${Math.round(seg.durationMs / 60000)} min`);
      marker.on("click", () => onSelect(seg.id));
      marker.addTo(layer);
      bounds.push([seg.startLat as number, seg.startLon as number]);
    }

    const key = segments.map((s) => s.id).join("|");
    if (key !== fittedKeyRef.current && !selectedId && !focusPoint) {
      fittedKeyRef.current = key;
      if (bounds.length >= 2) map.fitBounds(bounds as L.LatLngBoundsExpression, { padding: [28, 28] });
      else if (bounds.length === 1) map.setView(bounds[0], 14);
    }
  }, [trips, markers, segments, selectedId, focusPoint, onSelect]);

  useEffect(() => {
    const map = mapRef.current;
    const focusLayer = focusLayerRef.current;
    if (!map || !focusLayer) return;
    focusLayer.clearLayers();

    if (focusPoint) {
      L.marker([focusPoint.lat, focusPoint.lon], { icon: refillIcon, zIndexOffset: 900 })
        .bindTooltip(focusPoint.label || "Refill", { permanent: false })
        .addTo(focusLayer);
      map.setView([focusPoint.lat, focusPoint.lon], 17, { animate: true });
      return;
    }

    if (!selectedId) return;
    const seg = segments.find((s) => s.id === selectedId);
    if (!seg) return;
    const bounds = segmentBounds(seg);
    if (!bounds) return;
    const arr = bounds as [number, number][];
    if (Array.isArray(arr) && arr.length === 1) {
      map.setView(arr[0], 16, { animate: true });
    } else {
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 16, animate: true });
    }
  }, [selectedId, focusPoint, segments]);

  return <div ref={hostRef} className="trip-detail-map" role="img" aria-label="Trip map" />;
}
