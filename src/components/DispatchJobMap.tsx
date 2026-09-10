import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
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

  const withCoords = useMemo(
    () =>
      stops.filter(
        (s) => s.lat != null && s.lon != null && Number.isFinite(s.lat) && Number.isFinite(s.lon),
      ),
    [stops],
  );

  useEffect(() => {
    const el = elRef.current;
    if (!el || mapRef.current) return;
    const map = L.map(el, { scrollWheelZoom: true }).setView([-6.9175, 107.6191], 12);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
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

    const lineCoords: [number, number][] =
      routeGeometry.length >= 2
        ? routeGeometry
        : withCoords.length >= 2
          ? withCoords.map((s) => [s.lat as number, s.lon as number])
          : [];
    if (lineCoords.length >= 2) {
      L.polyline(lineCoords, {
        color: "#0b6b62",
        weight: 5,
        opacity: 0.9,
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
      const m = L.marker([stop.lat as number, stop.lon as number], { icon }).addTo(layer);
      m.bindPopup(`${stop.name}${stop.zone ? ` · ${stop.zone}` : ""}`);
      bounds.push([stop.lat as number, stop.lon as number]);
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
  }, [stops, fitKey, draftPin, interactiveEmpty, withCoords, routeGeometry]);

  return <div ref={elRef} className="dispatch-job-map" role="img" aria-label="Job stops map" />;
}
