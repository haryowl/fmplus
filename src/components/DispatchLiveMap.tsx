import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { STREET_TILE, streetTileOptions } from "../lib/mapTiles";
import { asMapCoord } from "../lib/mapCoords";
import type { DispatchLiveDriver } from "../lib/dispatch";

/** Plan / phone / Armada — high-contrast palette on light basemaps. */
export const LIVE_MAP_COLORS = {
  /** Vivid blue — readable on CARTO Positron / light street tiles. */
  plan: "#1d4ed8",
  phone: "#16a34a",
  armada: "#ea580c",
} as const;

type Props = {
  drivers: DispatchLiveDriver[];
  /** When set, that job is full opacity; others are dimmed. */
  focusJobId: string | null;
  fitKey: string;
  onSelectJob?: (jobId: string) => void;
};

function asCoord(lat: unknown, lon: unknown): [number, number] | null {
  return asMapCoord(lat, lon);
}

function cleanLine(raw: [number, number][] | undefined | null): [number, number][] {
  if (!raw?.length) return [];
  const out: [number, number][] = [];
  for (const p of raw) {
    const c = asCoord(p[0], p[1]);
    if (c) out.push(c);
  }
  return out;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stopDotIcon(color: string, label: string, selected: boolean): L.DivIcon {
  const size = selected ? 22 : 18;
  return L.divIcon({
    className: "dispatch-live-map-marker",
    html: `<span class="dispatch-live-map-dot" style="--dot:${color};width:${size}px;height:${size}px">${escapeHtml(label)}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

function liveDotIcon(color: string, selected: boolean): L.DivIcon {
  const size = selected ? 16 : 12;
  return L.divIcon({
    className: "dispatch-live-map-marker",
    html: `<span class="dispatch-live-map-live" style="--dot:${color};width:${size}px;height:${size}px"></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function eventDotIcon(color: string, kind: "S" | "C"): L.DivIcon {
  return L.divIcon({
    className: "dispatch-live-map-marker",
    html: `<span class="dispatch-live-map-event" style="--dot:${color}">${kind}</span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

export function DispatchLiveMap({ drivers, focusJobId, fitKey, onSelectJob }: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fitKeyRef = useRef("");
  const onSelectRef = useRef(onSelectJob);
  onSelectRef.current = onSelectJob;

  useEffect(() => {
    const el = elRef.current;
    if (!el || mapRef.current) return;
    const map = L.map(el, { scrollWheelZoom: true }).setView([-6.2, 106.8], 11);
    L.tileLayer(STREET_TILE.url, streetTileOptions()).addTo(map);
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

    const visible = focusJobId ? drivers.filter((d) => d.jobId === focusJobId) : drivers;
    const drawDrivers = visible.length ? visible : drivers;

    for (const d of drawDrivers) {
      const focused = !focusJobId || d.jobId === focusJobId;
      const opacity = focused ? 0.95 : 0.28;
      const weight = focused ? 6 : 3;

      const plan = cleanLine(d.plannedGeometry);
      if (plan.length >= 2) {
        L.polyline(plan, {
          color: LIVE_MAP_COLORS.plan,
          weight,
          opacity: opacity * 0.92,
          dashArray: "8 10",
          lineJoin: "round",
          lineCap: "round",
        }).addTo(layer);
        if (focused) for (const p of plan) bounds.push(p);
      }

      const phone = cleanLine(d.phoneTrail);
      if (phone.length >= 2) {
        L.polyline(phone, {
          color: LIVE_MAP_COLORS.phone,
          weight: weight - 1,
          opacity,
          lineJoin: "round",
          lineCap: "round",
        }).addTo(layer);
        if (focused) for (const p of phone) bounds.push(p);
      }

      // Armada actual track only when the job has a linked vehicle.
      if (d.armadaUserId != null) {
        const armada = cleanLine(d.armadaTrack);
        if (armada.length >= 2) {
          L.polyline(armada, {
            color: LIVE_MAP_COLORS.armada,
            weight: weight - 1,
            opacity,
            lineJoin: "round",
            lineCap: "round",
          }).addTo(layer);
          if (focused) for (const p of armada) bounds.push(p);
        }
      }

      for (const s of d.stops) {
        const planned = asCoord(s.plannedLat, s.plannedLon);
        if (planned) {
          const m = L.marker(planned, {
            icon: stopDotIcon(LIVE_MAP_COLORS.plan, String(s.stopNumber), focused),
            opacity: focused ? 1 : 0.45,
          }).addTo(layer);
          m.bindPopup(
            `<strong>${escapeHtml(s.name || `Stop ${s.stopNumber}`)}</strong><br/>Plan · #${s.stopNumber}`,
          );
          m.on("click", () => onSelectRef.current?.(d.jobId));
          if (focused) bounds.push(planned);
        }

        const startPhone = asCoord(s.startPhoneLat, s.startPhoneLon);
        if (startPhone) {
          L.marker(startPhone, {
            icon: eventDotIcon(LIVE_MAP_COLORS.phone, "S"),
            opacity: focused ? 1 : 0.4,
          })
            .bindPopup(`Phone start · ${escapeHtml(s.name || "")}`)
            .addTo(layer);
          if (focused) bounds.push(startPhone);
        }
        const startArmada = asCoord(s.startVehicleLat, s.startVehicleLon);
        if (startArmada && d.armadaUserId != null) {
          L.marker(startArmada, {
            icon: eventDotIcon(LIVE_MAP_COLORS.armada, "S"),
            opacity: focused ? 1 : 0.4,
          })
            .bindPopup(`Vehicle start · ${escapeHtml(s.name || "")}`)
            .addTo(layer);
          if (focused) bounds.push(startArmada);
        }

        const donePhone = asCoord(s.phoneLat, s.phoneLon);
        if (donePhone) {
          L.marker(donePhone, {
            icon: eventDotIcon(LIVE_MAP_COLORS.phone, "C"),
            opacity: focused ? 1 : 0.4,
          })
            .bindPopup(`Phone complete · ${escapeHtml(s.name || "")}`)
            .addTo(layer);
          if (focused) bounds.push(donePhone);
        }
        const doneArmada = asCoord(s.vehicleLat, s.vehicleLon);
        if (doneArmada && d.armadaUserId != null) {
          L.marker(doneArmada, {
            icon: eventDotIcon(LIVE_MAP_COLORS.armada, "C"),
            opacity: focused ? 1 : 0.4,
          })
            .bindPopup(`Vehicle complete · ${escapeHtml(s.name || "")}`)
            .addTo(layer);
          if (focused) bounds.push(doneArmada);
        }
      }

      // Dual live dots when both sources report (must-have with vehicle).
      const phoneLive = asCoord(d.phonePos?.lat, d.phonePos?.lon);
      if (phoneLive) {
        L.marker(phoneLive, {
          icon: liveDotIcon(LIVE_MAP_COLORS.phone, focused),
          opacity: focused ? 1 : 0.45,
          zIndexOffset: 400,
        })
          .bindPopup(
            `<strong>${escapeHtml(d.driverName)}</strong><br/>Phone live${
              d.phonePos?.ageSec != null ? ` · ${Math.round(d.phonePos.ageSec)}s` : ""
            }`,
          )
          .on("click", () => onSelectRef.current?.(d.jobId))
          .addTo(layer);
        if (focused) bounds.push(phoneLive);
      }
      if (d.armadaUserId != null) {
        const vehicleLive = asCoord(d.vehiclePos?.lat, d.vehiclePos?.lon);
        if (vehicleLive) {
          L.marker(vehicleLive, {
            icon: liveDotIcon(LIVE_MAP_COLORS.armada, focused),
            opacity: focused ? 1 : 0.45,
            zIndexOffset: 420,
          })
            .bindPopup(
              `<strong>${escapeHtml(d.vehicleLabel || "Vehicle")}</strong><br/>Armada live`,
            )
            .on("click", () => onSelectRef.current?.(d.jobId))
            .addTo(layer);
          if (focused) bounds.push(vehicleLive);
        }
      }
    }

    if (bounds.length && fitKeyRef.current !== fitKey) {
      fitKeyRef.current = fitKey;
      try {
        map.fitBounds(L.latLngBounds(bounds), { padding: [36, 36], maxZoom: 15 });
      } catch {
        /* empty */
      }
    }
  }, [drivers, focusJobId, fitKey]);

  return (
    <div className="dispatch-live-map-wrap">
      <div ref={elRef} className="dispatch-live-map" role="presentation" />
      <ul className="dispatch-live-map-legend" aria-label="Map legend">
        <li>
          <i style={{ background: LIVE_MAP_COLORS.plan, borderStyle: "dashed" }} /> Plan
        </li>
        <li>
          <i style={{ background: LIVE_MAP_COLORS.phone }} /> Phone actual
        </li>
        <li>
          <i style={{ background: LIVE_MAP_COLORS.armada }} /> Armada actual
        </li>
        <li>
          <span className="dispatch-live-map-legend-s">S</span> Start ·{" "}
          <span className="dispatch-live-map-legend-c">C</span> Complete
        </li>
      </ul>
    </div>
  );
}
