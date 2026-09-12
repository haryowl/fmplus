import { tenantHeaders } from "./tenant";
import { downloadXlsx, excelFilename, type ExcelCell } from "./xlsxDownload";

export type RoutePoint = {
  lat: number;
  lon: number;
  label?: string;
  id?: string;
};

/** OSRM car-profile excludes (hard avoid). Soft prefer needs a custom profile. */
export type RoutingOptions = {
  avoidTolls?: boolean;
  avoidMotorways?: boolean;
  avoidFerries?: boolean;
  respectGanjilGenap?: boolean;
  plateParity?: "odd" | "even" | "unknown" | "exempt";
  serviceDate?: string;
  dayStart?: string;
};

export type PlateParity = "odd" | "even" | "unknown" | "exempt";

export function routingPayload(opts: RoutingOptions | null | undefined): RoutingOptions {
  return {
    avoidTolls: Boolean(opts?.avoidTolls),
    avoidMotorways: Boolean(opts?.avoidMotorways),
    avoidFerries: Boolean(opts?.avoidFerries),
    respectGanjilGenap: Boolean(opts?.respectGanjilGenap),
    plateParity: opts?.plateParity || "unknown",
    ...(opts?.serviceDate ? { serviceDate: opts.serviceDate } : {}),
    ...(opts?.dayStart ? { dayStart: opts.dayStart } : {}),
  };
}

export function routingSummary(opts: RoutingOptions | null | undefined): string {
  const parts: string[] = [];
  if (opts?.avoidTolls) parts.push("no tolls");
  if (opts?.avoidMotorways) parts.push("no motorways");
  if (opts?.avoidFerries) parts.push("no ferries");
  if (opts?.respectGanjilGenap) {
    const p = opts.plateParity || "unknown";
    parts.push(`ganjil–genap (${p})`);
  }
  return parts.join(" · ");
}

export type RouteOrderedStop = RoutePoint & {
  seq: number;
  role: "start" | "stop" | "return";
};

export type RouteOptimizeResult = {
  engine: "osrm" | "haversine";
  warning: string | null;
  roundtrip: boolean;
  routing?: RoutingOptions & { exclude?: string[] };
  totalDistanceKm: number;
  totalDurationSec: number | null;
  orderedStops: RouteOrderedStop[];
  legs: { from: string; to: string; distanceKm: number }[];
  geometry: [number, number][];
};

export type RoutePlanStatus = {
  osrmConfigured: boolean;
  osrmReachable?: boolean;
  osrmError?: string | null;
  maxStops: number;
  engines: string[];
};

export async function fetchRoutePlanStatus(signal?: AbortSignal): Promise<RoutePlanStatus> {
  const res = await fetch("/api/route-plan/status", {
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as RoutePlanStatus & { error?: string };
  if (!res.ok) throw new Error(data.error || `Route status ${res.status}`);
  return data;
}

export type RouteLeg = {
  distanceKm: number;
  durationSec: number;
};

export type RouteGeometryResult = {
  engine: "osrm" | "haversine";
  geometry: [number, number][];
  legs: RouteLeg[];
  distanceKm: number | null;
  durationSec: number | null;
  warning: string | null;
};

/** Road path for an already-ordered stop list (does not re-order).
 * Uses the same /api/route-plan/optimize path as the Route plan page.
 */
export async function fetchRouteGeometry(
  points: Array<{ lat: number; lon: number }>,
  signal?: AbortSignal,
  routing?: RoutingOptions | null,
): Promise<RouteGeometryResult> {
  if (points.length < 2) {
    return {
      engine: "haversine",
      geometry: [],
      legs: [],
      distanceKm: 0,
      durationSec: 0,
      warning: "Need at least 2 points",
    };
  }
  const start = points[0];
  const stops = points.slice(1);
  const res = await fetch("/api/route-plan/optimize", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...tenantHeaders(),
    },
    body: JSON.stringify({
      start,
      stops,
      roundtrip: false,
      preserveOrder: true,
      routing: routingPayload(routing),
    }),
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as {
    engine?: string;
    geometry?: [number, number][];
    legs?: Array<{ distanceKm?: number; durationSec?: number | null }>;
    routeLegs?: RouteLeg[];
    totalDistanceKm?: number;
    totalDurationSec?: number | null;
    warning?: string | null;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Route geometry ${res.status}`);
  const routeLegs: RouteLeg[] = Array.isArray(data.routeLegs)
    ? data.routeLegs
    : Array.isArray(data.legs)
      ? data.legs.map((l) => ({
          distanceKm: Number(l.distanceKm) || 0,
          durationSec: Number(l.durationSec) || 0,
        }))
      : [];
  return {
    engine: data.engine === "osrm" ? "osrm" : "haversine",
    geometry: Array.isArray(data.geometry) ? data.geometry : [],
    legs: routeLegs,
    distanceKm: data.totalDistanceKm ?? null,
    durationSec: data.totalDurationSec ?? null,
    warning: data.warning ?? null,
  };
}

export function formatRouteDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "—";
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

/** Clock time HH:MM from minutes since midnight. */
export function formatClockMinutes(totalMinutes: number): string {
  const day = ((Math.round(totalMinutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  const hh = String(Math.floor(day / 60)).padStart(2, "0");
  const mm = String(day % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Parse "HH:MM" → minutes since midnight; null if invalid. */
export function parseClockToMinutes(value: string | undefined | null): number | null {
  const m = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Per-stop ETA + leg-from-previous, given ordered stops and route legs.
 *
 * When the road path includes a depot start and/or return, pass
 * `hasRouteStart` / `hasRouteEnd` so legs align:
 *   [depot→stop0, stop0→stop1, …, last→return]
 *
 * Departure clock = earliest windowStart among stops, else 08:00.
 * With a depot start that clock is depot departure; without it, first-stop arrival.
 * Service (dwell) is added after each stop arrival before the next leg.
 */
export type StopRouteMeta = {
  legDistanceKm: number | null;
  legDurationSec: number | null;
  eta: string | null;
};

export type SequenceRouteMeta = {
  /** HH:MM when leaving the depot (only when hasRouteStart). */
  depotDepart: string | null;
  stops: StopRouteMeta[];
  /** Leg from last stop back to depot/return (only when hasRouteEnd). */
  returnLeg: StopRouteMeta | null;
};

export function buildStopRouteMeta(
  stops: Array<{ windowStart?: string; serviceMinutes?: number | null }>,
  legs: RouteLeg[],
  defaultServiceMinutes = 0,
  opts?: { hasRouteStart?: boolean; hasRouteEnd?: boolean },
): SequenceRouteMeta {
  const hasRouteStart = Boolean(opts?.hasRouteStart);
  const hasRouteEnd = Boolean(opts?.hasRouteEnd);
  const start =
    stops.map((s) => parseClockToMinutes(s.windowStart)).find((n) => n != null) ?? 8 * 60;
  let elapsedMin = 0;
  const depotDepart = hasRouteStart ? formatClockMinutes(start) : null;

  const stopMetas: StopRouteMeta[] = stops.map((stop, i) => {
    const inboundIdx = hasRouteStart ? i : i === 0 ? null : i - 1;
    let legDistanceKm: number | null = null;
    let legDurationSec: number | null = null;
    if (inboundIdx != null) {
      const leg = legs[inboundIdx];
      legDistanceKm = leg?.distanceKm ?? null;
      legDurationSec = leg?.durationSec ?? null;
      elapsedMin += (leg?.durationSec ?? 0) / 60;
    }
    const eta = formatClockMinutes(start + elapsedMin);
    const svc =
      stop.serviceMinutes != null && Number.isFinite(Number(stop.serviceMinutes))
        ? Math.max(0, Number(stop.serviceMinutes))
        : Math.max(0, defaultServiceMinutes);
    elapsedMin += svc;
    return { legDistanceKm, legDurationSec, eta };
  });

  let returnLeg: StopRouteMeta | null = null;
  if (hasRouteEnd && stops.length > 0) {
    const returnIdx = hasRouteStart ? stops.length : Math.max(0, stops.length - 1);
    const leg = legs[returnIdx];
    elapsedMin += (leg?.durationSec ?? 0) / 60;
    returnLeg = {
      legDistanceKm: leg?.distanceKm ?? null,
      legDurationSec: leg?.durationSec ?? null,
      eta: formatClockMinutes(start + elapsedMin),
    };
  }

  return { depotDepart, stops: stopMetas, returnLeg };
}

function haversineKmClient(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Client-side straight-line fallback when the API returns an empty/zero route. */
export function estimateStraightRoute(
  points: Array<{ lat: number; lon: number }>,
): RouteGeometryResult {
  const AVG_KMH = 35;
  const legs: RouteLeg[] = [];
  let totalKm = 0;
  let totalSec = 0;
  const geometry: [number, number][] = [];
  for (let i = 0; i < points.length; i++) {
    const lat = Number(points[i].lat);
    const lon = Number(points[i].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    geometry.push([lat, lon]);
    if (i === 0) continue;
    const prev = geometry[geometry.length - 2];
    const km = haversineKmClient(prev[0], prev[1], lat, lon);
    const durationSec = Math.max(60, Math.round((km / AVG_KMH) * 3600));
    legs.push({ distanceKm: Math.round(km * 100) / 100, durationSec });
    totalKm += km;
    totalSec += durationSec;
  }
  return {
    engine: "haversine",
    geometry,
    legs,
    distanceKm: Math.round(totalKm * 100) / 100,
    durationSec: totalSec,
    warning: "Straight-line estimate",
  };
}

export async function optimizeRoutePlan(input: {
  start: RoutePoint;
  stops: RoutePoint[];
  roundtrip?: boolean;
  routing?: RoutingOptions;
}): Promise<RouteOptimizeResult> {
  const res = await fetch("/api/route-plan/optimize", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...tenantHeaders(),
    },
    body: JSON.stringify({
      start: input.start,
      stops: input.stops,
      roundtrip: input.roundtrip,
      routing: routingPayload(input.routing),
    }),
  });
  const data = (await res.json().catch(() => ({}))) as RouteOptimizeResult & { error?: string };
  if (!res.ok) throw new Error(data.error || `Optimize ${res.status}`);
  return data;
}

export function downloadRoutePlanExcel(result: RouteOptimizeResult): void {
  const headers: ExcelCell[] = ["Seq", "Role", "Label", "Lat", "Lon"];
  const body: ExcelCell[][] = result.orderedStops.map((s) => [
    s.seq + 1,
    s.role,
    s.label || "",
    Math.round(s.lat * 1e6) / 1e6,
    Math.round(s.lon * 1e6) / 1e6,
  ]);
  const summary: ExcelCell[][] = [
    ["Engine", result.engine],
    ["Distance km", result.totalDistanceKm],
    ["Duration", formatRouteDuration(result.totalDurationSec)],
    ["Roundtrip", result.roundtrip ? "yes" : "no"],
    ["Avoid", routingSummary(result.routing) || "none"],
    ["Warning", result.warning || ""],
  ];
  const legs: ExcelCell[][] = [
    ["From", "To", "Haversine km"],
    ...result.legs.map((l) => [l.from, l.to, l.distanceKm]),
  ];
  // Single sheet: sequence is the main deliverable
  downloadXlsx(excelFilename("route-plan"), "Route plan", [
    ["Field", "Value"],
    ...summary,
    [],
    headers,
    ...body,
    [],
    ...legs,
  ]);
}
