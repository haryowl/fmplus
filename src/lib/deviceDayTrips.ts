import { DEFAULT_MIN_SPEED_KMH, DEFAULT_TRIP_BREAK_MIN } from "./config";
import { haversineKm } from "./geo";
import { dateKeyInOffset } from "./time";
import { assignLogicalTrips, type MotionPoint } from "./trips";
import type { TrackerDayPoint } from "./trackerDevices";

export type DeviceTrip = {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  distanceKm: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  pointCount: number;
  path: [number, number][];
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
};

type PointWithMs = TrackerDayPoint & { ms: number };

export function buildDeviceTrips(
  points: TrackerDayPoint[],
  opts: { tzOffset: string; minSpeedKmh?: number; tripBreakMin?: number },
): DeviceTrip[] {
  const minSpeedKmh = opts.minSpeedKmh ?? DEFAULT_MIN_SPEED_KMH;
  const breakMs = (opts.tripBreakMin ?? DEFAULT_TRIP_BREAK_MIN) * 60_000;

  const withMs: PointWithMs[] = [];
  for (const p of points) {
    const ms = Date.parse(p.recordedAt);
    if (!Number.isFinite(ms)) continue;
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    withMs.push({ ...p, ms });
  }
  withMs.sort((a, b) => a.ms - b.ms);

  const motion: MotionPoint[] = withMs.map((p) => ({
    ms: p.ms,
    dateKey: dateKeyInOffset(p.ms, opts.tzOffset),
    ignition: p.ignition === true,
    speedKmh: p.speed != null && Number.isFinite(p.speed) ? p.speed : 0,
    logicalTripId: null,
  }));

  assignLogicalTrips(motion, { minSpeedKmh, breakMs });

  const byId = new Map<number, PointWithMs[]>();
  for (let i = 0; i < withMs.length; i += 1) {
    const id = motion[i]?.logicalTripId;
    if (id == null) continue;
    const list = byId.get(id) || [];
    list.push(withMs[i]);
    byId.set(id, list);
  }

  const trips: DeviceTrip[] = [];
  let index = 0;
  for (const [id, pts] of [...byId.entries()].sort((a, b) => a[1][0].ms - b[1][0].ms)) {
    if (pts.length < 2) continue;
    let distanceKm = 0;
    let maxSpeedKmh = 0;
    let speedSum = 0;
    let speedN = 0;
    const path: [number, number][] = [];
    for (let i = 0; i < pts.length; i += 1) {
      const p = pts[i];
      path.push([p.lat, p.lon]);
      if (p.speed != null && Number.isFinite(p.speed)) {
        maxSpeedKmh = Math.max(maxSpeedKmh, p.speed);
        speedSum += p.speed;
        speedN += 1;
      }
      if (i > 0) {
        const prev = pts[i - 1];
        const d = haversineKm(prev.lat, prev.lon, p.lat, p.lon);
        if (Number.isFinite(d) && d < 50) distanceKm += d;
      }
    }
    const start = pts[0];
    const end = pts[pts.length - 1];
    index += 1;
    trips.push({
      id: `t${id}`,
      index,
      startMs: start.ms,
      endMs: end.ms,
      durationMs: Math.max(0, end.ms - start.ms),
      distanceKm,
      avgSpeedKmh: speedN ? speedSum / speedN : 0,
      maxSpeedKmh,
      pointCount: pts.length,
      path,
      startLat: start.lat,
      startLon: start.lon,
      endLat: end.lat,
      endLon: end.lon,
    });
  }
  return trips;
}

export function slimDayPoints(points: TrackerDayPoint[], max = 800): TrackerDayPoint[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out: TrackerDayPoint[] = [];
  for (let i = 0; i < max; i += 1) out.push(points[Math.round(i * step)]);
  return out;
}
