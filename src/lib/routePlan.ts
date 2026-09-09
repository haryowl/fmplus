import { tenantHeaders } from "./tenant";
import { downloadXlsx, excelFilename, type ExcelCell } from "./xlsxDownload";

export type RoutePoint = {
  lat: number;
  lon: number;
  label?: string;
  id?: string;
};

export type RouteOrderedStop = RoutePoint & {
  seq: number;
  role: "start" | "stop" | "return";
};

export type RouteOptimizeResult = {
  engine: "osrm" | "haversine";
  warning: string | null;
  roundtrip: boolean;
  totalDistanceKm: number;
  totalDurationSec: number | null;
  orderedStops: RouteOrderedStop[];
  legs: { from: string; to: string; distanceKm: number }[];
  geometry: [number, number][];
};

export type RoutePlanStatus = {
  osrmConfigured: boolean;
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

export async function optimizeRoutePlan(input: {
  start: RoutePoint;
  stops: RoutePoint[];
  roundtrip?: boolean;
}): Promise<RouteOptimizeResult> {
  const res = await fetch("/api/route-plan/optimize", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...tenantHeaders(),
    },
    body: JSON.stringify(input),
  });
  const data = (await res.json().catch(() => ({}))) as RouteOptimizeResult & { error?: string };
  if (!res.ok) throw new Error(data.error || `Optimize ${res.status}`);
  return data;
}

export function formatRouteDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "—";
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
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
