import { asNumber } from "./geo";
import { classifyVibration, vibrationMg } from "./road";
import { zonedEndMs, zonedStartMs } from "./time";
import type { TrackPoint, Trip } from "./types";

export const MAX_MAP_POINTS = 8000;

export const MAP_COLOR = {
  low: "#0b6b62",
  mid: "#c47d3a",
  high: "#9f2a2a",
  unknown: "#8a8378",
} as const;

export type MapMode = "path" | "elevation" | "road";

export type MapPoint = {
  ms: number;
  lat: number;
  lon: number;
  alt: number | null;
  vibrationMg: number | null;
};

export type MapSegment = {
  color: string;
  points: [number, number][];
};

export type TrackMapData = {
  paths: MapPoint[][];
  pointCount: number;
  rawCount: number;
  hasAltitude: boolean;
  hasRoad: boolean;
  altMin: number | null;
  altMax: number | null;
};

function parsePoint(point: TrackPoint): MapPoint | null {
  if (!point.utc) return null;
  const ms = Date.parse(point.utc);
  if (!Number.isFinite(ms)) return null;
  const lat = asNumber(point.position?.latitude);
  const lon = asNumber(point.position?.longitude);
  if (lat === null || lon === null) return null;
  const x = asNumber(point.variables?.axisX ?? point.variables?.AxisX);
  const y = asNumber(point.variables?.axisY ?? point.variables?.AxisY);
  const z = asNumber(point.variables?.axisZ ?? point.variables?.AxisZ);
  return {
    ms,
    lat,
    lon,
    alt: asNumber(point.position?.altitude),
    vibrationMg: x !== null && y !== null && z !== null ? vibrationMg({ x, y, z }) : null,
  };
}

function splitPaths(points: MapPoint[]): MapPoint[][] {
  if (points.length === 0) return [];
  return [points];
}

export function downsamplePath(points: MapPoint[], max: number): MapPoint[] {
  if (points.length <= max || max < 2) return points;
  const out: MapPoint[] = [];
  const step = (points.length - 1) / (max - 1);
  let last = -1;
  for (let i = 0; i < max; i += 1) {
    const idx = Math.round(i * step);
    if (idx === last) continue;
    out.push(points[idx]);
    last = idx;
  }
  return out;
}

export function downsamplePaths(paths: MapPoint[][], maxTotal: number): MapPoint[][] {
  const total = paths.reduce((sum, path) => sum + path.length, 0);
  if (total <= maxTotal) return paths;
  return paths.map((path) => {
    const share = Math.max(2, Math.round((path.length / total) * maxTotal));
    return downsamplePath(path, share);
  });
}

export type MapBounds = {
  south: number;
  west: number;
  north: number;
  east: number;
};

/** Keep vertices in (or next to) the view, then thin if the view is still dense. */
export function pathsForMapView(
  paths: MapPoint[][],
  bounds: MapBounds | null,
  maxPoints: number,
): MapPoint[][] {
  let clipped = paths;
  if (bounds) {
    const latPad = Math.max(0.01, (bounds.north - bounds.south) * 0.2);
    const lonPad = Math.max(0.01, (bounds.east - bounds.west) * 0.2);
    const south = bounds.south - latPad;
    const north = bounds.north + latPad;
    const west = bounds.west - lonPad;
    const east = bounds.east + lonPad;
    const inBox = (p: MapPoint) => p.lat >= south && p.lat <= north && p.lon >= west && p.lon <= east;
    clipped = paths
      .map((path) => {
        const keep = path.map(inBox);
        const out: MapPoint[] = [];
        for (let i = 0; i < path.length; i += 1) {
          if (keep[i] || keep[i - 1] || keep[i + 1]) out.push(path[i]);
        }
        return out;
      })
      .filter((path) => path.length >= 2);
  }
  return downsamplePaths(clipped, maxPoints);
}

export function elevationColor(alt: number, min: number, max: number): string {
  if (max <= min) return MAP_COLOR.mid;
  const t = (alt - min) / (max - min);
  if (t < 1 / 3) return MAP_COLOR.low;
  if (t < 2 / 3) return MAP_COLOR.mid;
  return MAP_COLOR.high;
}

export function roadColor(magnitudeMg: number): string {
  const bucket = classifyVibration(magnitudeMg);
  if (bucket === "bumpy") return MAP_COLOR.high;
  if (bucket === "rough") return MAP_COLOR.mid;
  return MAP_COLOR.low;
}

function edgeColor(
  a: MapPoint,
  b: MapPoint,
  mode: MapMode,
  altMin: number | null,
  altMax: number | null,
): string {
  if (mode === "path") return MAP_COLOR.low;
  if (mode === "elevation") {
    const alt =
      a.alt !== null && b.alt !== null ? (a.alt + b.alt) / 2 : (a.alt ?? b.alt);
    if (alt === null || altMin === null || altMax === null) return MAP_COLOR.unknown;
    return elevationColor(alt, altMin, altMax);
  }
  const mag =
    a.vibrationMg !== null && b.vibrationMg !== null
      ? (a.vibrationMg + b.vibrationMg) / 2
      : (a.vibrationMg ?? b.vibrationMg);
  if (mag === null) return MAP_COLOR.unknown;
  return roadColor(mag);
}

export function colorSegments(
  paths: MapPoint[][],
  mode: MapMode,
  altMin: number | null,
  altMax: number | null,
): MapSegment[] {
  const segments: MapSegment[] = [];
  for (const path of paths) {
    let current: MapSegment | null = null;
    for (let i = 1; i < path.length; i += 1) {
      const color = edgeColor(path[i - 1], path[i], mode, altMin, altMax);
      const latlng: [number, number] = [path[i].lat, path[i].lon];
      if (current && current.color === color) {
        current.points.push(latlng);
      } else {
        current = {
          color,
          points: [
            [path[i - 1].lat, path[i - 1].lon],
            latlng,
          ],
        };
        segments.push(current);
      }
    }
  }
  return segments;
}

export function buildTrackMap(
  trips: Trip[],
  options: { dateFrom: string; dateTo: string; timezone: string },
): TrackMapData {
  const startMs = zonedStartMs(options.dateFrom, options.timezone);
  const endMs = zonedEndMs(options.dateTo, options.timezone);
  const collected: MapPoint[] = [];

  for (const trip of trips) {
    for (const point of trip.tracks) {
      const parsed = parsePoint(point);
      if (!parsed) continue;
      if (parsed.ms < startMs || parsed.ms > endMs) continue;
      collected.push(parsed);
    }
  }

  collected.sort((a, b) => a.ms - b.ms);
  const rawCount = collected.length;
  const paths = splitPaths(collected);

  let altMin: number | null = null;
  let altMax: number | null = null;
  let hasAltitude = false;
  let hasRoad = false;
  let pointCount = 0;
  for (const path of paths) {
    pointCount += path.length;
    for (const p of path) {
      if (p.alt !== null) {
        hasAltitude = true;
        altMin = altMin === null ? p.alt : Math.min(altMin, p.alt);
        altMax = altMax === null ? p.alt : Math.max(altMax, p.alt);
      }
      if (p.vibrationMg !== null) hasRoad = true;
    }
  }

  return { paths, pointCount, rawCount, hasAltitude, hasRoad, altMin, altMax };
}

export function defaultMapMode(data: TrackMapData): MapMode {
  if (data.hasAltitude) return "elevation";
  if (data.hasRoad) return "road";
  return "path";
}
