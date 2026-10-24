import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { STREET_TILE, streetTileOptions } from "../lib/mapTiles";
import { formatCoord, formatSpeedValue, type UnitSystem } from "../lib/units";
import { useUnitSystem } from "../lib/unitSystem";
import { ageLabel } from "../lib/lastStatus";
import type { LastStatusRow } from "../lib/lastStatus";
import {
  classifyLiveRow,
  LIVE_OPS_COLORS,
  LIVE_OPS_LABELS,
  type LiveOpsClass,
} from "../lib/liveOps";
import { vehicleTrackHref } from "../lib/routing";
import type { TelematicsSource } from "../lib/trackerDevices";
import type { NativeGeofence } from "../lib/places";
import { geocodeCacheKey } from "../lib/reverseGeocode";

export type LiveOpsPlace = {
  id: string;
  name: string;
  lat: number | null;
  lon: number | null;
};

type Props = {
  rows: LastStatusRow[];
  now: number;
  /** Bump when group/filters change so we expect a new focus target. */
  fitKey: string;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  /** Bump (`id:n`) to pan/zoom onto a vehicle without changing fitKey. */
  locateToken?: string;
  /** Status-row id → GPS device UUID for popup history links. */
  deviceIdByRowId?: Map<number, string>;
  telematicsSource?: TelematicsSource | null;
  geofences?: NativeGeofence[];
  servicePoints?: LiveOpsPlace[];
  /** Cache-key (`lat.toFixed(5),lon.toFixed(5)`) → reverse-geocoded address. */
  addresses?: Record<string, string>;
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

const iconCache = new Map<string, L.DivIcon>();

function markerIcon(
  opsClass: LiveOpsClass,
  selected: boolean,
  label?: string,
): L.DivIcon {
  const safe = (label || "").slice(0, 28);
  const key = `${opsClass}:${selected ? 1 : 0}:${safe}`;
  let icon = iconCache.get(key);
  if (icon) return icon;
  const color = LIVE_OPS_COLORS[opsClass];
  const size = selected ? 18 : 14;
  const tag = selected
    ? `<span class="live-ops-marker-tag">${escapeHtml(safe)} · ${escapeHtml(LIVE_OPS_LABELS[opsClass])}</span>`
    : "";
  icon = L.divIcon({
    className: "live-ops-marker",
    html: `<span class="live-ops-marker-wrap">${tag}<span class="live-ops-marker-dot${selected ? " selected" : ""}" style="background:${color};width:${size}px;height:${size}px"></span></span>`,
    iconSize: selected ? [Math.max(size, 120), size + 22] : [size, size],
    iconAnchor: selected ? [Math.max(size, 120) / 2, size / 2 + 11] : [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
  iconCache.set(key, icon);
  return icon;
}

function formatPopupAddress(address?: string): string {
  const parts = String(address || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) return `${parts[0]} · ${parts[1]}`;
  return parts[0] || "";
}

function popupHtml(
  row: LastStatusRow,
  opsClass: LiveOpsClass,
  now: number,
  deviceId?: string | null,
  telematicsSource?: TelematicsSource | null,
  address?: string,
  unitSystem: UnitSystem = "metric",
): string {
  const trips = vehicleTrackHref({
    rowId: row.id,
    deviceId,
    kind: "trips",
    telematicsSource,
  });
  const full = vehicleTrackHref({
    rowId: row.id,
    deviceId,
    kind: "full",
    telematicsSource,
  });
  const ign = row.ignition === true ? "On" : row.ignition === false ? "Off" : "—";
  const rawCoords =
    row.lat != null && row.lon != null ? `${row.lat.toFixed(6)},${row.lon.toFixed(6)}` : "";
  const coords =
    row.lat != null && row.lon != null ? formatCoord(row.lat, row.lon, unitSystem) : "";
  const addr = formatPopupAddress(address);
  const speed =
    row.speedKmh == null || !Number.isFinite(row.speedKmh)
      ? "—"
      : formatSpeedValue(row.speedKmh, unitSystem);
  const live = row.lastMs != null && now - row.lastMs < 10 * 60 * 1000;
  const color = LIVE_OPS_COLORS[opsClass];
  return `<div class="live-ops-popup">
    <header class="live-ops-popup-head">
      <strong>${escapeHtml(row.name)}</strong>
      <i class="live-ops-popup-dot" style="background:${color}"></i>
    </header>
    <div class="live-ops-popup-sub">
      <span>${escapeHtml(LIVE_OPS_LABELS[opsClass])} · ${escapeHtml(ageLabel(row.lastMs, now))}</span>
      ${live ? `<em class="live-ops-popup-live">LIVE</em>` : ""}
    </div>
    <div class="live-ops-popup-row">
      <span>${escapeHtml(speed)}</span>
      <i></i>
      <span>Ign ${ign}</span>
    </div>
    ${
      coords
        ? `<div class="live-ops-popup-coords">
      <span>${escapeHtml(coords)}</span>
      <button type="button" class="live-ops-popup-copy" data-copy="${escapeHtml(rawCoords)}" title="Copy coordinates" aria-label="Copy coordinates">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75"><rect x="8" y="8" width="11" height="13" rx="2"/><path d="M5 16V5a2 2 0 0 1 2-2h8"/></svg>
      </button>
    </div>`
        : ""
    }
    ${
      addr
        ? `<div class="live-ops-popup-addr" title="${escapeHtml(address || addr)}">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M12 21s7-6.2 7-11.2A7 7 0 1 0 5 9.8C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.2"/></svg>
      <span>${escapeHtml(addr)}</span>
    </div>`
        : ""
    }
    <div class="live-ops-popup-links">
      <a href="${escapeHtml(trips)}">Trips</a>
      <a href="${escapeHtml(full)}">Full <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M9 5h10v10M9 15 19 5"/></svg></a>
    </div>
  </div>`;
}

/** Stable token of which devices+positions we should be zoomed to. */
function focusToken(fitKey: string, rows: LastStatusRow[]): string {
  const parts: string[] = [fitKey];
  for (const row of rows) {
    if (row.lat == null || row.lon == null) continue;
    if (!Number.isFinite(row.lat) || !Number.isFinite(row.lon)) continue;
    parts.push(`${row.id}:${row.lat.toFixed(5)},${row.lon.toFixed(5)}`);
  }
  parts.sort();
  return parts.join("|");
}

function focusMapOnBounds(map: L.Map, points: Array<[number, number]>) {
  if (!points.length) return;
  map.invalidateSize({ animate: false });
  if (points.length === 1) {
    map.setView(points[0], 15, { animate: false });
  } else {
    const llb = L.latLngBounds(points);
    if (!llb.isValid()) return;
    // Identical points → treat as single
    if (llb.getNorthEast().equals(llb.getSouthWest())) {
      map.setView(points[0], 15, { animate: false });
    } else {
      map.fitBounds(llb, { padding: [40, 40], maxZoom: 16, animate: false });
    }
  }
  // Force tile fetch after programmatic move (updateWhenIdle can leave grey canvas).
  map.eachLayer((layer) => {
    const tile = layer as L.TileLayer & { redraw?: () => void };
    if (typeof tile.redraw === "function") tile.redraw();
  });
}

/**
 * Incremental Leaflet map. Re-focuses whenever the set of device positions for
 * the current fitKey changes (group switch → new ids → zoom to those vehicles).
 */
export function LiveOpsMap({
  rows,
  now,
  fitKey,
  selectedId,
  onSelect,
  locateToken,
  deviceIdByRowId,
  telematicsSource,
  geofences,
  servicePoints,
  addresses,
}: Props) {
  const units = useUnitSystem();
  const unitSystemRef = useRef(units.system);
  unitSystemRef.current = units.system;
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fencesRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef(new Map<number, MarkerMeta>());
  const lastFocusTokenRef = useRef("");
  const lastLocateRef = useRef("");
  const onSelectRef = useRef(onSelect);
  const nowRef = useRef(now);
  const rowsByIdRef = useRef(new Map<number, LastStatusRow>());
  const deviceIdByRowIdRef = useRef(deviceIdByRowId);
  const telematicsSourceRef = useRef(telematicsSource);
  const addressesRef = useRef(addresses);
  const [mapReady, setMapReady] = useState(false);

  onSelectRef.current = onSelect;
  nowRef.current = now;
  deviceIdByRowIdRef.current = deviceIdByRowId;
  telematicsSourceRef.current = telematicsSource;
  addressesRef.current = addresses;

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
      updateWhenZooming: true,
      keepBuffer: 2,
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    fencesRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const onPopupOpen = (ev: L.PopupEvent) => {
      const root = ev.popup.getElement();
      const btn = root?.querySelector<HTMLButtonElement>("[data-copy]");
      if (!btn || btn.dataset.bound === "1") return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", (click) => {
        click.preventDefault();
        click.stopPropagation();
        const text = btn.getAttribute("data-copy") || "";
        if (text) void navigator.clipboard?.writeText(text);
      });
    };
    map.on("popupopen", onPopupOpen);
    setMapReady(true);

    const invalidate = () => map.invalidateSize({ animate: false });
    requestAnimationFrame(invalidate);
    const t1 = window.setTimeout(invalidate, 100);
    const t2 = window.setTimeout(invalidate, 400);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => invalidate());
      ro.observe(el);
    }

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      ro?.disconnect();
      map.off("popupopen", onPopupOpen);
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      fencesRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    const group = fencesRef.current;
    if (!mapReady || !group) return;
    group.clearLayers();
    for (const fence of geofences || []) {
      if (fence.enabled === false) continue;
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
        continue;
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
    for (const place of servicePoints || []) {
      if (place.lat == null || place.lon == null) continue;
      if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon)) continue;
      L.circleMarker([place.lat, place.lon], {
        radius: 7,
        color: "#9a4a2e",
        weight: 2,
        fillColor: "#efe8db",
        fillOpacity: 0.95,
      })
        .bindTooltip(place.name || "Place", { sticky: true })
        .addTo(group);
    }
  }, [geofences, servicePoints, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    const t = nowRef.current;
    const nextIds = new Set<number>();
    const points: Array<[number, number]> = [];
    const byId = new Map<number, LastStatusRow>();

    for (const row of rows) {
      byId.set(row.id, row);
      if (row.lat === null || row.lon === null) continue;
      if (!Number.isFinite(row.lat) || !Number.isFinite(row.lon)) continue;

      nextIds.add(row.id);
      points.push([row.lat, row.lon]);

      const opsClass = classifyLiveRow(row, t);
      const selected = selectedId === row.id;
      const existing = markersRef.current.get(row.id);

      if (!existing) {
        const marker = L.marker([row.lat, row.lon], {
          icon: markerIcon(opsClass, selected, row.name),
          title: row.name,
          keyboard: false,
          zIndexOffset: selected ? 600 : 0,
        });
        marker.on("click", () => onSelectRef.current(row.id));
        marker.bindPopup(
          () => {
            const latest = rowsByIdRef.current.get(row.id) || row;
            const cls = classifyLiveRow(latest, nowRef.current);
            const addr =
              latest.lat != null && latest.lon != null
                ? addressesRef.current?.[geocodeCacheKey(latest.lat, latest.lon)] || ""
                : "";
            return popupHtml(
              latest,
              cls,
              nowRef.current,
              deviceIdByRowIdRef.current?.get(latest.id),
              telematicsSourceRef.current,
              addr,
              unitSystemRef.current,
            );
          },
          {
            className: "live-ops-leaflet-popup",
            closeButton: false,
            maxWidth: 300,
            minWidth: 240,
            autoPanPadding: [24, 24],
          },
        );
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
      if (
        existing.opsClass !== opsClass ||
        existing.selected !== selected ||
        existing.name !== row.name
      ) {
        existing.marker.setIcon(markerIcon(opsClass, selected, row.name));
        existing.marker.setZIndexOffset(selected ? 600 : 0);
        existing.opsClass = opsClass;
        existing.selected = selected;
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

    const token = focusToken(fitKey, rows);
    if (!points.length) {
      lastFocusTokenRef.current = token;
      return;
    }
    if (token === lastFocusTokenRef.current) return;
    lastFocusTokenRef.current = token;

    try {
      focusMapOnBounds(map, points);
      window.requestAnimationFrame(() => focusMapOnBounds(map, points));
      window.setTimeout(() => focusMapOnBounds(map, points), 120);
    } catch {
      lastFocusTokenRef.current = "";
    }
  }, [rows, fitKey, selectedId]);

  useEffect(() => {
    if (!locateToken || locateToken === lastLocateRef.current) return;
    lastLocateRef.current = locateToken;
    const map = mapRef.current;
    if (!map || selectedId == null) return;
    const meta = markersRef.current.get(selectedId);
    if (!meta) return;
    map.setView([meta.lat, meta.lon], Math.max(map.getZoom(), 15), { animate: true });
  }, [locateToken, selectedId]);

  return <div ref={elRef} className="live-ops-map leaflet-container" />;
}
