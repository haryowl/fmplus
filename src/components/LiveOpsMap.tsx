import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { formatSpeed } from "../lib/format";
import { ageLabel } from "../lib/lastStatus";
import type { LastStatusRow } from "../lib/lastStatus";
import {
  classifyLiveRow,
  LIVE_OPS_COLORS,
  LIVE_OPS_LABELS,
  type LiveOpsClass,
} from "../lib/liveOps";
import { fullHref, tripsHref } from "../lib/routing";

type Props = {
  rows: LastStatusRow[];
  now: number;
  /** Bump when group/filters change so we fitBounds again. */
  fitKey: string;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function vehicleLinks(userId: number): { trips: string; full: string } {
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  params.set("userId", String(userId));
  params.delete("userIds");
  const q = params.toString();
  const search = q ? `?${q}` : "";
  return { trips: tripsHref(search), full: fullHref(search) };
}

function markerIcon(opsClass: LiveOpsClass, selected: boolean): L.DivIcon {
  const color = LIVE_OPS_COLORS[opsClass];
  const size = selected ? 18 : 14;
  return L.divIcon({
    className: "live-ops-marker",
    html: `<span class="live-ops-marker-dot${selected ? " selected" : ""}" style="background:${color};width:${size}px;height:${size}px"></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

export function LiveOpsMap({ rows, now, fitKey, selectedId, onSelect }: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fitKeyRef = useRef<string>("");

  useEffect(() => {
    const el = elRef.current;
    if (!el || mapRef.current) return;
    const map = L.map(el, { scrollWheelZoom: true }).setView([-2.5, 118], 5);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
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
    const bounds: L.LatLngExpression[] = [];

    for (const row of rows) {
      if (row.lat === null || row.lon === null) continue;
      const opsClass = classifyLiveRow(row, now);
      const selected = selectedId === row.id;
      const marker = L.marker([row.lat, row.lon], {
        icon: markerIcon(opsClass, selected),
        title: row.name,
      });
      const links = vehicleLinks(row.id);
      const ign =
        row.ignition === true ? "On" : row.ignition === false ? "Off" : "—";
      marker.bindPopup(
        `<div class="live-ops-popup">
          <strong>${escapeHtml(row.name)}</strong>
          <div class="muted">${escapeHtml(LIVE_OPS_LABELS[opsClass])} · ${escapeHtml(ageLabel(row.lastMs, now))}</div>
          <div>Speed ${
            row.speedKmh === null ? "—" : `${escapeHtml(formatSpeed(row.speedKmh))} km/h`
          } · Ign ${ign}</div>
          <div class="live-ops-popup-links">
            <a href="${escapeHtml(links.trips)}">Trips</a>
            <a href="${escapeHtml(links.full)}">Full</a>
          </div>
        </div>`,
      );
      marker.on("click", () => onSelect(row.id));
      marker.addTo(layer);
      bounds.push([row.lat, row.lon]);
    }

    if (bounds.length && fitKeyRef.current !== fitKey) {
      fitKeyRef.current = fitKey;
      map.fitBounds(L.latLngBounds(bounds), { padding: [28, 28], maxZoom: 14 });
    }

    requestAnimationFrame(() => map.invalidateSize());
  }, [rows, now, fitKey, selectedId, onSelect]);

  return <div ref={elRef} className="live-ops-map leaflet-container" />;
}
