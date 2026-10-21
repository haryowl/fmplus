import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { STREET_TILE, streetTileOptions } from "../lib/mapTiles";
import type { NativeGeofence } from "../lib/places";

export type PlacesDrawMode = "view" | "circle" | "polygon";

type Props = {
  fences: NativeGeofence[];
  mode: PlacesDrawMode;
  radiusM: number;
  ring: Array<[number, number]>;
  onPickCircle: (lat: number, lon: number) => void;
  onRingChange: (ring: Array<[number, number]>) => void;
};

function addFenceLayer(group: L.LayerGroup, fence: NativeGeofence) {
  const color = fence.color || "#2563eb";
  if (
    fence.kind === "circle" &&
    fence.lat != null &&
    fence.lon != null &&
    fence.radiusM != null &&
    fence.radiusM > 0
  ) {
    L.circle([fence.lat, fence.lon], {
      radius: fence.radiusM,
      color,
      weight: 2,
      fillColor: color,
      fillOpacity: 0.12,
    })
      .bindTooltip(fence.name, { sticky: true })
      .addTo(group);
    return;
  }
  if (fence.kind === "polygon" && fence.ring.length >= 3) {
    L.polygon(
      fence.ring.map(([lat, lon]) => [lat, lon] as [number, number]),
      { color, weight: 2, fillColor: color, fillOpacity: 0.12 },
    )
      .bindTooltip(fence.name, { sticky: true })
      .addTo(group);
  }
}

export function PlacesGeofenceMap({
  fences,
  mode,
  radiusM,
  ring,
  onPickCircle,
  onRingChange,
}: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const savedRef = useRef<L.LayerGroup | null>(null);
  const draftRef = useRef<L.LayerGroup | null>(null);
  const onPickCircleRef = useRef(onPickCircle);
  const onRingChangeRef = useRef(onRingChange);
  const modeRef = useRef(mode);
  const radiusRef = useRef(radiusM);
  const ringRef = useRef(ring);
  const [mapReady, setMapReady] = useState(false);

  onPickCircleRef.current = onPickCircle;
  onRingChangeRef.current = onRingChange;
  modeRef.current = mode;
  radiusRef.current = radiusM;
  ringRef.current = ring;

  useEffect(() => {
    const el = elRef.current;
    if (!el || mapRef.current) return;
    const map = L.map(el, {
      scrollWheelZoom: true,
      fadeAnimation: false,
      zoomAnimation: false,
    }).setView([-2.5, 118], 5);
    L.tileLayer(STREET_TILE.url, {
      ...streetTileOptions(),
      updateWhenIdle: false,
      keepBuffer: 2,
    }).addTo(map);
    savedRef.current = L.layerGroup().addTo(map);
    draftRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    map.on("click", (ev: L.LeafletMouseEvent) => {
      const { lat, lng } = ev.latlng;
      const draw = modeRef.current;
      if (draw === "circle") {
        onPickCircleRef.current(lat, lng);
        return;
      }
      if (draw === "polygon") {
        onRingChangeRef.current([...ringRef.current, [lat, lng]]);
      }
    });
    map.on("dblclick", (ev: L.LeafletMouseEvent) => {
      if (modeRef.current !== "polygon") return;
      L.DomEvent.stop(ev);
    });
    setMapReady(true);
    const invalidate = () => map.invalidateSize({ animate: false });
    requestAnimationFrame(invalidate);
    const t = window.setTimeout(invalidate, 200);
    return () => {
      window.clearTimeout(t);
      map.remove();
      mapRef.current = null;
      savedRef.current = null;
      draftRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    const group = savedRef.current;
    const map = mapRef.current;
    if (!mapReady || !group || !map) return;
    group.clearLayers();
    const pts: Array<[number, number]> = [];
    for (const fence of fences) {
      addFenceLayer(group, fence);
      if (fence.kind === "circle" && fence.lat != null && fence.lon != null) {
        pts.push([fence.lat, fence.lon]);
      }
      for (const [lat, lon] of fence.ring || []) pts.push([lat, lon]);
    }
    if (pts.length === 1) map.setView(pts[0], 14, { animate: false });
    else if (pts.length > 1) {
      const b = L.latLngBounds(pts);
      if (b.isValid()) map.fitBounds(b, { padding: [36, 36], maxZoom: 15, animate: false });
    }
  }, [fences, mapReady]);

  useEffect(() => {
    const group = draftRef.current;
    if (!mapReady || !group) return;
    group.clearLayers();
    const color = "#b45309";
    if (mode === "circle" && ring.length === 0) return;
    if (mode === "circle") {
      const [lat, lon] = ring[0] || [];
      if (Number.isFinite(lat) && Number.isFinite(lon) && radiusM > 0) {
        L.circle([lat, lon], {
          radius: radiusM,
          color,
          weight: 2,
          dashArray: "6 4",
          fillColor: color,
          fillOpacity: 0.16,
        }).addTo(group);
        L.circleMarker([lat, lon], { radius: 5, color, fillOpacity: 1 }).addTo(group);
      }
      return;
    }
    if (mode === "polygon" && ring.length) {
      if (ring.length >= 2) {
        L.polyline(ring, { color, weight: 2, dashArray: "6 4" }).addTo(group);
      }
      for (const [lat, lon] of ring) {
        L.circleMarker([lat, lon], { radius: 5, color, fillOpacity: 1 }).addTo(group);
      }
      if (ring.length >= 3) {
        L.polygon(ring, { color, weight: 1, fillColor: color, fillOpacity: 0.1 }).addTo(group);
      }
    }
  }, [mode, radiusM, ring, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    if (mode === "polygon") map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
  }, [mode, mapReady]);

  return (
    <div
      ref={elRef}
      className="places-fence-map leaflet-container"
      aria-label="Geofence map"
    />
  );
}
