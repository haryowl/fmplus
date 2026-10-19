import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { STREET_TILE, streetTileOptions } from "../lib/mapTiles";
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
  /** While true, defer focus — avoids fitting to the previous group's markers. */
  loading?: boolean;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
};

type MarkerMeta = {
  marker: L.Marker;
  opsClass: LiveOpsClass;
  selected: boolean;
  lat: number;
  lon: number;
  name: string;
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

const iconCache = new Map<string, L.DivIcon>();

function markerIcon(opsClass: LiveOpsClass, selected: boolean): L.DivIcon {
  const key = `${opsClass}:${selected ? 1 : 0}`;
  let icon = iconCache.get(key);
  if (icon) return icon;
  const color = LIVE_OPS_COLORS[opsClass];
  const size = selected ? 18 : 14;
  icon = L.divIcon({
    className: "live-ops-marker",
    html: `<span class="live-ops-marker-dot${selected ? " selected" : ""}" style="background:${color};width:${size}px;height:${size}px"></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
  iconCache.set(key, icon);
  return icon;
}

function popupHtml(row: LastStatusRow, opsClass: LiveOpsClass, now: number): string {
  const links = vehicleLinks(row.id);
  const ign = row.ignition === true ? "On" : row.ignition === false ? "Off" : "—";
  return `<div class="live-ops-popup">
    <strong>${escapeHtml(row.name)}</strong>
    <div class="muted">${escapeHtml(LIVE_OPS_LABELS[opsClass])} · ${escapeHtml(ageLabel(row.lastMs, now))}</div>
    <div>Speed ${
      row.speedKmh === null ? "—" : `${escapeHtml(formatSpeed(row.speedKmh))} km/h`
    } · Ign ${ign}</div>
    <div class="live-ops-popup-links">
      <a href="${escapeHtml(links.trips)}">Trips</a>
      <a href="${escapeHtml(links.full)}">Full</a>
    </div>
  </div>`;
}

/**
 * Incremental Leaflet map — keeps markers across polls/selection instead of
 * clearLayers() (which blanked the map under load / group switches).
 */
function focusMapOnBounds(map: L.Map, bounds: L.LatLngExpression[]) {
  if (!bounds.length) return;
  map.invalidateSize({ animate: false });
  if (bounds.length === 1) {
    map.setView(bounds[0], 15, { animate: false });
    return;
  }
  const llb = L.latLngBounds(bounds);
  if (!llb.isValid()) return;
  map.fitBounds(llb, { padding: [36, 36], maxZoom: 16, animate: false });
}

export function LiveOpsMap({ rows, now, fitKey, loading = false, selectedId, onSelect }: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef(new Map<number, MarkerMeta>());
  const needFitRef = useRef(true);
  const lastFitKeyRef = useRef(fitKey);
  const onSelectRef = useRef(onSelect);
  const nowRef = useRef(now);
  const rowsByIdRef = useRef(new Map<number, LastStatusRow>());

  onSelectRef.current = onSelect;
  nowRef.current = now;

  if (lastFitKeyRef.current !== fitKey) {
    lastFitKeyRef.current = fitKey;
    needFitRef.current = true;
  }

  useEffect(() => {
    const el = elRef.current;
    if (!el || mapRef.current) return;

    const map = L.map(el, {
      scrollWheelZoom: true,
      // Prefer transform-based pan; smoother under marker churn
      preferCanvas: false,
    }).setView([-2.5, 118], 5);
    L.tileLayer(STREET_TILE.url, {
      ...streetTileOptions(),
      updateWhenIdle: true,
      keepBuffer: 2,
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    const invalidate = () => {
      map.invalidateSize({ animate: false });
    };
    // Layout often settles after first paint (shell / sidenav / flex).
    requestAnimationFrame(invalidate);
    const t1 = window.setTimeout(invalidate, 80);
    const t2 = window.setTimeout(invalidate, 320);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => invalidate());
      ro.observe(el);
    }

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      ro?.disconnect();
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    const t = nowRef.current;
    const nextIds = new Set<number>();
    const bounds: L.LatLngExpression[] = [];
    const byId = new Map<number, LastStatusRow>();

    for (const row of rows) {
      byId.set(row.id, row);
      if (row.lat === null || row.lon === null) continue;
      if (!Number.isFinite(row.lat) || !Number.isFinite(row.lon)) continue;

      nextIds.add(row.id);
      bounds.push([row.lat, row.lon]);

      const opsClass = classifyLiveRow(row, t);
      const selected = selectedId === row.id;
      const existing = markersRef.current.get(row.id);

      if (!existing) {
        const marker = L.marker([row.lat, row.lon], {
          icon: markerIcon(opsClass, selected),
          title: row.name,
          keyboard: false,
        });
        marker.on("click", () => onSelectRef.current(row.id));
        marker.bindPopup(() => {
          const latest = rowsByIdRef.current.get(row.id) || row;
          const cls = classifyLiveRow(latest, nowRef.current);
          return popupHtml(latest, cls, nowRef.current);
        });
        marker.addTo(layer);
        markersRef.current.set(row.id, {
          marker,
          opsClass,
          selected,
          lat: row.lat,
          lon: row.lon,
          name: row.name,
        });
        continue;
      }

      if (existing.lat !== row.lat || existing.lon !== row.lon) {
        existing.marker.setLatLng([row.lat, row.lon]);
        existing.lat = row.lat;
        existing.lon = row.lon;
      }
      if (existing.opsClass !== opsClass || existing.selected !== selected) {
        existing.marker.setIcon(markerIcon(opsClass, selected));
        existing.opsClass = opsClass;
        existing.selected = selected;
      }
      if (existing.name !== row.name) {
        existing.marker.options.title = row.name;
        existing.name = row.name;
      }
    }

    rowsByIdRef.current = byId;

    for (const [id, meta] of markersRef.current) {
      if (nextIds.has(id)) continue;
      layer.removeLayer(meta.marker);
      markersRef.current.delete(id);
    }

    map.invalidateSize({ animate: false });

    // Defer focus until the fetch for this group/filter finishes, otherwise we
    // lock onto the previous group's coordinates and never re-fit.
    if (loading || !needFitRef.current) return;
    if (!bounds.length) return;

    needFitRef.current = false;
    try {
      focusMapOnBounds(map, bounds);
      // Second pass after layout (sidenav / flex) settles.
      window.requestAnimationFrame(() => focusMapOnBounds(map, bounds));
    } catch {
      needFitRef.current = true;
    }
  }, [rows, fitKey, selectedId, loading]);

  return <div ref={elRef} className="live-ops-map leaflet-container" />;
}
