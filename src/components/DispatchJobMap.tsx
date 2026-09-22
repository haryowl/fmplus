import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { STREET_TILE, streetTileOptions } from "../lib/mapTiles";
import { asMapCoord } from "../lib/mapCoords";
import type { DispatchStop } from "../lib/dispatch";
import { LIVE_MAP_COLORS } from "./DispatchLiveMap";

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
  routeStart?: { lat: number; lon: number; label?: string } | null;
  routeEnd?: { lat: number; lon: number; label?: string } | null;
  /** Optional GPS overlays (Board parity with Live map). */
  phoneTrail?: [number, number][];
  armadaTrack?: [number, number][];
  phoneLive?: { lat: number; lon: number } | null;
  vehicleLive?: { lat: number; lon: number } | null;
  /** When true, draw Armada track / start / complete / live. */
  hasVehicle?: boolean;
  trackStatus?: string;
};

function asCoord(lat: unknown, lon: unknown): [number, number] | null {
  return asMapCoord(lat, lon);
}

function cleanLine(raw: [number, number][] | undefined): [number, number][] {
  if (!raw?.length) return [];
  const out: [number, number][] = [];
  for (const p of raw) {
    const c = asCoord(p[0], p[1]);
    if (c) out.push(c);
  }
  return out;
}

function eventIcon(color: string, kind: string): L.DivIcon {
  return L.divIcon({
    className: "dispatch-live-map-marker",
    html: `<span class="dispatch-live-map-event" style="--dot:${color}">${kind}</span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function liveIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "dispatch-live-map-marker",
    html: `<span class="dispatch-live-map-live" style="--dot:${color};width:12px;height:12px"></span>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

export function DispatchJobMap({
  stops,
  fitKey,
  draftPin = null,
  onMapClick,
  interactiveEmpty = true,
  routeGeometry = [],
  routeStart = null,
  routeEnd = null,
  phoneTrail = [],
  armadaTrack = [],
  phoneLive = null,
  vehicleLive = null,
  hasVehicle = false,
  trackStatus = "",
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
    if (cleaned.length >= 2) return cleaned;
    return [];
  }, [routeGeometry]);

  const phoneLine = useMemo(() => cleanLine(phoneTrail), [phoneTrail]);
  const armadaLine = useMemo(() => cleanLine(armadaTrack), [armadaTrack]);
  const showGps = phoneLine.length >= 2 || armadaLine.length >= 2 || phoneLive || vehicleLive;

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

    const syncSize = () => {
      map.invalidateSize({ animate: false });
    };
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            syncSize();
          })
        : null;
    ro?.observe(el);
    requestAnimationFrame(syncSize);

    return () => {
      ro?.disconnect();
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

    const planColor = showGps ? LIVE_MAP_COLORS.plan : "#0b6b62";
    const planDash = showGps ? "8 10" : undefined;

    if (stopLine.length >= 2 && !roadLine.length) {
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
        color: planColor,
        weight: showGps ? 4 : 5,
        opacity: showGps ? 0.85 : 0.92,
        dashArray: planDash,
        lineJoin: "round",
        lineCap: "round",
      }).addTo(layer);
      for (const p of lineCoords) bounds.push(p);
    }

    if (phoneLine.length >= 2) {
      L.polyline(phoneLine, {
        color: LIVE_MAP_COLORS.phone,
        weight: 4,
        opacity: 0.92,
        lineJoin: "round",
      }).addTo(layer);
      for (const p of phoneLine) bounds.push(p);
    }

    if (hasVehicle && armadaLine.length >= 2) {
      L.polyline(armadaLine, {
        color: LIVE_MAP_COLORS.armada,
        weight: 4,
        opacity: 0.92,
        lineJoin: "round",
      }).addTo(layer);
      for (const p of armadaLine) bounds.push(p);
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

      if (showGps) {
        const sp = asCoord(stop.startPhoneLat, stop.startPhoneLon);
        if (sp) {
          L.marker(sp, { icon: eventIcon(LIVE_MAP_COLORS.phone, "S") })
            .bindPopup("Phone start")
            .addTo(layer);
          bounds.push(sp);
        }
        const sa = asCoord(stop.startArmadaLat, stop.startArmadaLon);
        if (sa && hasVehicle) {
          L.marker(sa, { icon: eventIcon(LIVE_MAP_COLORS.armada, "S") })
            .bindPopup("Vehicle start")
            .addTo(layer);
          bounds.push(sa);
        }
        const cp = asCoord(stop.completePhoneLat, stop.completePhoneLon);
        if (cp) {
          L.marker(cp, { icon: eventIcon(LIVE_MAP_COLORS.phone, "C") })
            .bindPopup("Phone complete")
            .addTo(layer);
          bounds.push(cp);
        }
        const ca = asCoord(stop.completeArmadaLat, stop.completeArmadaLon);
        if (ca && hasVehicle) {
          L.marker(ca, { icon: eventIcon(LIVE_MAP_COLORS.armada, "C") })
            .bindPopup("Vehicle complete")
            .addTo(layer);
          bounds.push(ca);
        }
      }
    });

    const addAnchor = (
      anchor: { lat: number; lon: number; label?: string } | null,
      letter: string,
      color: string,
    ) => {
      if (!anchor || !Number.isFinite(anchor.lat) || !Number.isFinite(anchor.lon)) return;
      const icon = L.divIcon({
        className: "route-plan-marker",
        html: `<span class="route-plan-marker-dot" style="background:${color}">${letter}</span>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      L.marker([anchor.lat, anchor.lon], { icon })
        .addTo(layer)
        .bindPopup(anchor.label || letter);
      bounds.push([anchor.lat, anchor.lon]);
    };
    addAnchor(routeStart, "D", "#9a4a2e");
    addAnchor(routeEnd, "R", "#9a4a2e");

    const pl = asCoord(phoneLive?.lat, phoneLive?.lon);
    if (pl) {
      L.marker(pl, { icon: liveIcon(LIVE_MAP_COLORS.phone), zIndexOffset: 400 })
        .bindPopup("Phone live")
        .addTo(layer);
      bounds.push(pl);
    }
    if (hasVehicle) {
      const vl = asCoord(vehicleLive?.lat, vehicleLive?.lon);
      if (vl) {
        L.marker(vl, { icon: liveIcon(LIVE_MAP_COLORS.armada), zIndexOffset: 420 })
          .bindPopup("Armada live")
          .addTo(layer);
        bounds.push(vl);
      }
    }

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
  }, [
    stops,
    fitKey,
    draftPin,
    interactiveEmpty,
    withCoords,
    stopLine,
    roadLine,
    routeStart,
    routeEnd,
    phoneLine,
    armadaLine,
    phoneLive,
    vehicleLive,
    hasVehicle,
    showGps,
  ]);

  return (
    <div className="dispatch-job-map-wrap">
      <div ref={elRef} className="dispatch-job-map" role="img" aria-label="Job stops map" />
      {showGps || trackStatus ? (
        <ul className="dispatch-live-map-legend" aria-label="Map legend">
          <li>
            <i style={{ background: LIVE_MAP_COLORS.plan }} /> Plan
          </li>
          <li>
            <i style={{ background: LIVE_MAP_COLORS.phone }} /> Phone
          </li>
          {hasVehicle ? (
            <li>
              <i style={{ background: LIVE_MAP_COLORS.armada }} /> Armada
            </li>
          ) : null}
          {trackStatus ? <li>{trackStatus}</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
