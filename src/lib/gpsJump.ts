import { haversineKm } from "./geo";

/** Ignore GPS dither below this; Armada metrics use the same floor. */
export const MIN_GPS_JUMP_KM = 1.5;
/** Drop a point when implied ground speed exceeds a fast highway. */
export const MAX_GPS_IMPLIED_SPEED_KMH = 180;
/** Do not draw a straight line across a teleport when timestamps are missing. */
export const MAX_GPS_TELEPORT_KM = 80;
const NULL_ISLAND_DEG = 0.01;

export function isNullIsland(lat: number, lon: number): boolean {
  return Math.abs(lat) < NULL_ISLAND_DEG && Math.abs(lon) < NULL_ISLAND_DEG;
}

export function isImpossibleGpsStep(
  prev: { lat: number; lon: number; ms: number },
  next: { lat: number; lon: number; ms: number },
): boolean {
  const d = haversineKm(prev.lat, prev.lon, next.lat, next.lon);
  if (!Number.isFinite(d) || d < MIN_GPS_JUMP_KM) return false;
  const dtMs = next.ms - prev.ms;
  if (dtMs <= 0) return true;
  const kmh = d / (dtMs / 3_600_000);
  return kmh > MAX_GPS_IMPLIED_SPEED_KMH;
}

/** Keep real GNSS samples; skip null-island and implied-speed teleports. */
export function keepGpsTrack<T extends { lat: number; lon: number; ms: number }>(points: T[]): T[] {
  const out: T[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    if (isNullIsland(p.lat, p.lon)) continue;
    const prev = out[out.length - 1];
    if (prev && isImpossibleGpsStep(prev, p)) continue;
    out.push(p);
  }
  return out;
}

/** Split a lat/lon polyline so teleports are not drawn as a sea-crossing line. */
export function splitTrailByJump(path: [number, number][]): [number, number][][] {
  if (path.length === 0) return [];
  const segments: [number, number][][] = [];
  let current: [number, number][] = [path[0]];
  for (let i = 1; i < path.length; i += 1) {
    const prev = current[current.length - 1];
    const d = haversineKm(prev[0], prev[1], path[i][0], path[i][1]);
    if (Number.isFinite(d) && d > MAX_GPS_TELEPORT_KM) {
      if (current.length >= 2) segments.push(current);
      current = [path[i]];
    } else {
      current.push(path[i]);
    }
  }
  if (current.length >= 2) segments.push(current);
  return segments;
}
