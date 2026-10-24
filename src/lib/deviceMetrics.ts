import {
  DEFAULT_FUEL_PRICE,
  DEFAULT_MIN_SPEED_KMH,
  DEFAULT_REFILL_THRESHOLD_L,
  DEFAULT_TRIP_BREAK_MIN,
} from "./config";
import { computeBehavior } from "./behavior";
import { computePeriodMetrics, sumMetrics, type MetricsTotals } from "./metrics";
import { eachDateInclusive } from "./time";
import {
  fetchTrackerDeviceDay,
  type TrackerDayPoint,
} from "./trackerDevices";
import type { Period, PeriodMetrics, Trip } from "./types";

export const DEVICE_METRICS_MAX_DAYS = 31;

/** Stable negative id so Fleet charts can key a GPS device without an Armada user id. */
export function deviceNumericId(deviceId: string): number {
  const id = String(deviceId || "").trim();
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return h === 0 ? -1 : -Math.abs(h);
}

/** Armada track points store speed in m/s; device fixes store km/h. */
export function devicePointsToTrip(deviceId: string, points: TrackerDayPoint[]): Trip {
  const uid = deviceNumericId(deviceId);
  return {
    trackInfoId: uid,
    userId: uid,
    created: points[0] ? new Date(points[0].recordedAt) : null,
    tracks: points.map((p) => ({
      utc: p.recordedAt,
      position: {
        latitude: p.lat,
        longitude: p.lon,
        altitude: p.altitude == null ? undefined : p.altitude,
      },
      variables: {
        ignition: p.ignition === true,
        speed: p.speed != null && Number.isFinite(p.speed) ? p.speed / 3.6 : 0,
        odometerAcc:
          p.odometerKm != null && Number.isFinite(p.odometerKm) ? p.odometerKm * 1000 : null,
      },
    })),
  };
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i], i);
    }
  }
  const n = Math.min(Math.max(1, limit), items.length || 1);
  await Promise.all(Array.from({ length: items.length ? n : 0 }, () => worker()));
  return out;
}

export async function fetchDeviceTripsForRange(
  opts: {
    deviceId: string;
    dateFrom: string;
    dateTo: string;
    timezone: string;
    signal?: AbortSignal;
    onProgress?: (loaded: number, total: number) => void;
  },
): Promise<{ trip: Trip; pointCount: number; days: number; skipped: number }> {
  const dates = eachDateInclusive(opts.dateFrom, opts.dateTo).slice(0, DEVICE_METRICS_MAX_DAYS);
  const points: TrackerDayPoint[] = [];
  let skipped = 0;
  let loaded = 0;
  await mapPool(dates, 4, async (date) => {
    try {
      const day = await fetchTrackerDeviceDay(
        { deviceId: opts.deviceId, date, tzOffset: opts.timezone },
        opts.signal,
      );
      points.push(...(day.points || []));
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      skipped += 1;
    } finally {
      loaded += 1;
      opts.onProgress?.(loaded, dates.length);
    }
  });
  points.sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  return {
    trip: devicePointsToTrip(opts.deviceId, points),
    pointCount: points.length,
    days: dates.length,
    skipped,
  };
}

export function devicePeriodMetrics(
  trips: Trip[],
  opts: {
    period: Period;
    dateFrom: string;
    dateTo: string;
    timezone: string;
    minSpeedKmh?: number;
    tripBreakMin?: number;
  },
): { rows: PeriodMetrics[]; totals: MetricsTotals } {
  const rows = computePeriodMetrics(trips, {
    period: opts.period,
    dateFrom: opts.dateFrom,
    dateTo: opts.dateTo,
    timezone: opts.timezone,
    minSpeedKmh: opts.minSpeedKmh ?? DEFAULT_MIN_SPEED_KMH,
    refillThresholdL: DEFAULT_REFILL_THRESHOLD_L,
    fuelPricePerL: DEFAULT_FUEL_PRICE,
    tripBreakMin: opts.tripBreakMin ?? DEFAULT_TRIP_BREAK_MIN,
  });
  return { rows, totals: sumMetrics(rows) };
}

export function deviceBehavior(
  trips: Trip[],
  totalsGpsKm: number,
  opts: { period: Period; dateFrom: string; dateTo: string; timezone: string },
) {
  return computeBehavior(trips, {
    period: opts.period,
    dateFrom: opts.dateFrom,
    dateTo: opts.dateTo,
    timezone: opts.timezone,
    distanceKm: totalsGpsKm,
    thresholds: {
      harshBrake: 6.5,
      harshAccel: 4.5,
      harshCorner: 0.6,
      speedLimitKmh: 90,
    },
  });
}
