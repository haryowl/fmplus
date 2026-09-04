import {
  DEFAULT_MIN_SPEED_KMH,
  DEFAULT_REFILL_THRESHOLD_L,
  DEFAULT_TRIP_BREAK_MIN,
  MAX_GAP_MS,
  MAX_POSITION_JUMP_KM,
  REFILL_STEP_L,
  REFILL_WINDOW_MS,
} from "./config";
import { FLEET_COLORS } from "./fleet";
import { asNumber, haversineKm } from "./geo";
import { dateKeyInOffset } from "./time";
import { assignLogicalTrips, type MotionPoint } from "./trips";
import type { TrackPoint, Trip } from "./types";

export type SegmentStatus = "trip" | "idle" | "stop";
export type SegmentFuelSource = "can" | "tank" | "none";

export type TripSegmentPoint = {
  ms: number;
  lat: number | null;
  lon: number | null;
  ignition: boolean;
  speedKmh: number;
  rpm: number | null;
  fuelConsumed: number | null;
  fuelLevel: number | null;
  logicalTripId: number | null;
};

export type TripSegment = {
  id: string;
  status: SegmentStatus;
  logicalTripId: number | null;
  color: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  startLat: number | null;
  startLon: number | null;
  endLat: number | null;
  endLon: number | null;
  distanceKm: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  avgRpm: number;
  maxRpm: number;
  fuelUsedL: number;
  fuelSource: SegmentFuelSource;
  refillL: number;
  path: [number, number][];
  pointCount: number;
};

export type TripSegmentOptions = {
  timezone: string;
  minSpeedKmh?: number;
  tripBreakMin?: number;
  refillThresholdL?: number;
};

export const TRIP_DETAIL_MAX_DAYS = 3;

export function tripSegmentColor(index: number): string {
  return FLEET_COLORS[index % FLEET_COLORS.length];
}

export function googleMapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps?q=${lat},${lon}`;
}

function fuelLevelOf(variables: Record<string, unknown> | undefined): number | null {
  if (!variables) return null;
  return asNumber(variables["fuel level"] ?? variables.fuelLevel ?? variables.FuelLevel);
}

function toPoint(raw: TrackPoint): TripSegmentPoint | null {
  if (!raw.utc) return null;
  const ms = Date.parse(raw.utc);
  if (!Number.isFinite(ms)) return null;
  const speedMs = asNumber(raw.variables?.speed);
  return {
    ms,
    lat: asNumber(raw.position?.latitude),
    lon: asNumber(raw.position?.longitude),
    ignition: raw.variables?.ignition === true,
    speedKmh: speedMs === null ? 0 : speedMs * 3.6,
    rpm: asNumber(raw.variables?.caN300_EngineRPM),
    fuelConsumed: asNumber(raw.variables?.caN300_FuelConsumed),
    fuelLevel: fuelLevelOf(raw.variables),
    logicalTripId: null,
  };
}

function flattenTrips(trips: Trip[]): TripSegmentPoint[] {
  const out: TripSegmentPoint[] = [];
  for (const trip of trips) {
    for (const track of trip.tracks) {
      const point = toPoint(track);
      if (point) out.push(point);
    }
  }
  out.sort((a, b) => a.ms - b.ms);
  return out;
}

function detectRefillLiters(
  points: TripSegmentPoint[],
  thresholdL: number,
  maxSpeedKmh: number,
): number {
  const levels = points
    .filter((p) => p.fuelLevel !== null)
    .map((p) => ({ ms: p.ms, level: p.fuelLevel as number, speed: p.speedKmh }))
    .sort((a, b) => a.ms - b.ms);
  if (levels.length < 2) return 0;

  let liters = 0;
  let pending = 0;
  let pendingStart = 0;
  let lastAccepted = levels[0].level;

  const flush = () => {
    if (pending >= thresholdL) {
      const rounded = Math.round(pending / REFILL_STEP_L) * REFILL_STEP_L;
      if (rounded >= thresholdL) liters += rounded;
    }
    pending = 0;
    pendingStart = 0;
  };

  for (let i = 1; i < levels.length; i += 1) {
    const prev = levels[i - 1];
    const cur = levels[i];
    const rise = cur.level - lastAccepted;
    const dt = cur.ms - prev.ms;
    if (rise > 0.2 && cur.speed <= maxSpeedKmh) {
      if (!pending) pendingStart = cur.ms;
      if (cur.ms - pendingStart > REFILL_WINDOW_MS) flush();
      if (dt > MAX_GAP_MS && rise >= thresholdL && cur.speed <= maxSpeedKmh) {
        pending = rise;
        pendingStart = cur.ms;
        lastAccepted = cur.level;
        flush();
        continue;
      }
      pending += rise;
      lastAccepted = cur.level;
    } else if (cur.level + 0.2 < lastAccepted) {
      flush();
      lastAccepted = cur.level;
    }
  }
  flush();
  return liters;
}

export function segmentFuel(
  points: TripSegmentPoint[],
  refillThresholdL = DEFAULT_REFILL_THRESHOLD_L,
): { fuelUsedL: number; fuelSource: SegmentFuelSource; refillL: number } {
  const can = points.map((p) => p.fuelConsumed).filter((v): v is number => v !== null && v > 0);
  if (can.length >= 2) {
    const delta = can[can.length - 1] - can[0];
    if (delta > 0.05) {
      return { fuelUsedL: delta, fuelSource: "can", refillL: 0 };
    }
  }

  const refillL = detectRefillLiters(points, refillThresholdL, DEFAULT_MIN_SPEED_KMH);
  const levels = points.filter((p) => p.fuelLevel !== null).sort((a, b) => a.ms - b.ms);
  if (levels.length >= 2) {
    const first = levels[0].fuelLevel as number;
    const last = levels[levels.length - 1].fuelLevel as number;
    const used = Math.max(0, first + refillL - last);
    if (used > 0.05 || refillL > 0) {
      return { fuelUsedL: used, fuelSource: "tank", refillL };
    }
  }
  return { fuelUsedL: 0, fuelSource: "none", refillL: 0 };
}

function pathAndDistance(points: TripSegmentPoint[]): { path: [number, number][]; distanceKm: number } {
  const path: [number, number][] = [];
  let distanceKm = 0;
  let prev: TripSegmentPoint | null = null;
  for (const point of points) {
    if (point.lat === null || point.lon === null) continue;
    path.push([point.lat, point.lon]);
    if (prev?.lat !== null && prev?.lon !== null && prev) {
      const dist = haversineKm(prev.lat, prev.lon, point.lat, point.lon);
      if (dist <= MAX_POSITION_JUMP_KM) distanceKm += dist;
    }
    prev = point;
  }
  return { path, distanceKm };
}

function metricsOf(points: TripSegmentPoint[]) {
  let speedSum = 0;
  let speedN = 0;
  let maxSpeed = 0;
  let rpmSum = 0;
  let rpmN = 0;
  let maxRpm = 0;
  for (const point of points) {
    if (point.speedKmh > 0) {
      speedSum += point.speedKmh;
      speedN += 1;
      if (point.speedKmh > maxSpeed) maxSpeed = point.speedKmh;
    }
    if (point.rpm !== null && point.rpm > 0) {
      rpmSum += point.rpm;
      rpmN += 1;
      if (point.rpm > maxRpm) maxRpm = point.rpm;
    }
  }
  return {
    avgSpeedKmh: speedN ? speedSum / speedN : 0,
    maxSpeedKmh: maxSpeed,
    avgRpm: rpmN ? rpmSum / rpmN : 0,
    maxRpm,
  };
}

function firstLastCoords(points: TripSegmentPoint[]) {
  let startLat: number | null = null;
  let startLon: number | null = null;
  let endLat: number | null = null;
  let endLon: number | null = null;
  for (const point of points) {
    if (point.lat === null || point.lon === null) continue;
    if (startLat === null) {
      startLat = point.lat;
      startLon = point.lon;
    }
    endLat = point.lat;
    endLon = point.lon;
  }
  return { startLat, startLon, endLat, endLon };
}

function buildSegment(
  status: SegmentStatus,
  points: TripSegmentPoint[],
  logicalTripId: number | null,
  colorIndex: number,
  refillThresholdL: number,
): TripSegment | null {
  if (points.length === 0) return null;
  const startMs = points[0].ms;
  const endMs = points[points.length - 1].ms;
  if (endMs < startMs) return null;
  const { path, distanceKm } = pathAndDistance(points);
  const fuel = segmentFuel(points, refillThresholdL);
  const metrics = metricsOf(points);
  const coords = firstLastCoords(points);
  return {
    id: `${status}-${startMs}-${logicalTripId ?? "x"}`,
    status,
    logicalTripId,
    color: status === "trip" ? tripSegmentColor(colorIndex) : status === "idle" ? "#8a8378" : "#5c5650",
    startMs,
    endMs,
    durationMs: Math.max(0, endMs - startMs),
    ...coords,
    distanceKm,
    ...metrics,
    fuelUsedL: fuel.fuelUsedL,
    fuelSource: fuel.fuelSource,
    refillL: fuel.refillL,
    path,
    pointCount: points.length,
  };
}

/**
 * Build Trip / Idle / Stop rows from a vehicle's loaded trips.
 * Consecutive Stop (or Idle) points merge across GPS heartbeat gaps until
 * status flips or a Trip starts — time outside trip/idle is one Stop/park.
 */
export function buildTripSegments(trips: Trip[], options: TripSegmentOptions): TripSegment[] {
  const timezone = options.timezone;
  const minSpeedKmh = options.minSpeedKmh ?? DEFAULT_MIN_SPEED_KMH;
  const breakMs = (options.tripBreakMin ?? DEFAULT_TRIP_BREAK_MIN) * 60_000;
  const refillThresholdL = options.refillThresholdL ?? DEFAULT_REFILL_THRESHOLD_L;

  const points = flattenTrips(trips);
  if (points.length === 0) return [];

  const motion: MotionPoint[] = points.map((p) => ({
    ms: p.ms,
    dateKey: dateKeyInOffset(p.ms, timezone),
    ignition: p.ignition,
    speedKmh: p.speedKmh,
    logicalTripId: null,
  }));
  assignLogicalTrips(motion, { minSpeedKmh, breakMs });
  for (let i = 0; i < points.length; i += 1) points[i].logicalTripId = motion[i].logicalTripId;

  const segments: TripSegment[] = [];
  let tripColorIndex = 0;
  let i = 0;

  while (i < points.length) {
    const start = points[i];
    if (start.logicalTripId !== null) {
      const tripId = start.logicalTripId;
      const chunk: TripSegmentPoint[] = [];
      while (i < points.length && points[i].logicalTripId === tripId) {
        chunk.push(points[i]);
        i += 1;
      }
      const seg = buildSegment("trip", chunk, tripId, tripColorIndex, refillThresholdL);
      if (seg) {
        segments.push(seg);
        tripColorIndex += 1;
      }
      continue;
    }

    // Non-trip: Idle (ignition on) or Stop (ignition off).
    // Merge across GPS heartbeat gaps until the next Trip or status flip —
    // time outside trip/idle is one continuous Stop/park block.
    const status: SegmentStatus = start.ignition ? "idle" : "stop";
    const chunk: TripSegmentPoint[] = [start];
    i += 1;
    while (i < points.length && points[i].logicalTripId === null) {
      const cur = points[i];
      const nextStatus: SegmentStatus = cur.ignition ? "idle" : "stop";
      if (nextStatus !== status) break;
      chunk.push(cur);
      i += 1;
    }
    const seg = buildSegment(status, chunk, null, tripColorIndex, refillThresholdL);
    if (seg) segments.push(seg);
  }

  return segments;
}

export function recordedHoursFromSegments(segments: TripSegment[]): {
  tripHours: number;
  idleHours: number;
  stopHours: number;
  recordedHours: number;
} {
  let tripMs = 0;
  let idleMs = 0;
  let stopMs = 0;
  for (const seg of segments) {
    if (seg.status === "trip") tripMs += seg.durationMs;
    else if (seg.status === "idle") idleMs += seg.durationMs;
    else stopMs += seg.durationMs;
  }
  const recordedMs = tripMs + idleMs + stopMs;
  return {
    tripHours: tripMs / 3_600_000,
    idleHours: idleMs / 3_600_000,
    stopHours: stopMs / 3_600_000,
    recordedHours: recordedMs / 3_600_000,
  };
}

export function inclusiveDayCount(dateFrom: string, dateTo: string): number {
  if (!dateFrom || !dateTo || dateTo < dateFrom) return 0;
  const a = Date.parse(`${dateFrom}T12:00:00Z`);
  const b = Date.parse(`${dateTo}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.floor((b - a) / 86_400_000) + 1;
}
