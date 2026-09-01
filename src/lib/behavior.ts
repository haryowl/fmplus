import { asNumber } from "./geo";
import { dateKeyInOffset, periodKey, periodLabel, zonedEndMs, zonedStartMs } from "./time";
import type { Period, TrackPoint, Trip } from "./types";

export type BehaviorThresholds = {
  harshBrake: number;
  harshAccel: number;
  harshCorner: number;
  speedLimitKmh: number;
};

export type BehaviorPeriod = {
  key: string;
  label: string;
  harshBraking: number;
  harshAcceleration: number;
  harshCornering: number;
  overspeed: number;
};

export type BehaviorSummary = {
  rows: BehaviorPeriod[];
  harshBraking: number;
  harshAcceleration: number;
  harshCornering: number;
  overspeed: number;
  totalEvents: number;
  eventsPer100km: number;
  safetyScore: number;
  topIssue: string | null;
};

function flagHarsh(
  variables: Record<string, unknown> | undefined,
  digitalKey: string,
  analogKey: string,
  threshold: number,
): boolean {
  if (!variables) return false;
  if (variables[digitalKey] === true) return true;
  const analog = asNumber(variables[analogKey]);
  return analog !== null && analog > threshold;
}

function overspeed(variables: Record<string, unknown> | undefined, limitKmh: number): boolean {
  const speedMs = asNumber(variables?.speed);
  if (speedMs === null) return false;
  return speedMs * 3.6 > limitKmh;
}

/** 100 at 0 events/100km, 50 at 10, 0 at 20 or more. */
export function safetyScoreFromRate(eventsPer100km: number): number {
  return Math.max(0, Math.min(100, 100 - eventsPer100km * 5));
}

function topIssueName(counts: {
  harshBraking: number;
  harshAcceleration: number;
  harshCornering: number;
  overspeed: number;
}): string | null {
  const issues: Array<[string, number]> = [
    ["Harsh braking", counts.harshBraking],
    ["Harsh acceleration", counts.harshAcceleration],
    ["Harsh cornering", counts.harshCornering],
    ["Overspeed", counts.overspeed],
  ];
  issues.sort((a, b) => b[1] - a[1]);
  return issues[0][1] > 0 ? issues[0][0] : null;
}

type FlagSample = {
  ms: number;
  dateKey: string;
  brake: boolean;
  accel: boolean;
  corner: boolean;
  over: boolean;
};

/**
 * Count rising edges so a 30-second overspeed is one event, not one per GPS point.
 */
export function computeBehavior(
  trips: Trip[],
  options: {
    period: Period;
    dateFrom: string;
    dateTo: string;
    timezone: string;
    thresholds: BehaviorThresholds;
    distanceKm: number;
  },
): BehaviorSummary {
  const startMs = zonedStartMs(options.dateFrom, options.timezone);
  const endMs = zonedEndMs(options.dateTo, options.timezone);
  const { thresholds } = options;
  const samples: FlagSample[] = [];

  for (const trip of trips) {
    for (const point of trip.tracks as TrackPoint[]) {
      if (!point.utc) continue;
      const ms = Date.parse(point.utc);
      if (!Number.isFinite(ms) || ms < startMs || ms > endMs) continue;
      samples.push({
        ms,
        dateKey: dateKeyInOffset(ms, options.timezone),
        brake: flagHarsh(point.variables, "harshBrakingDigital", "harshBrakingValue", thresholds.harshBrake),
        accel: flagHarsh(
          point.variables,
          "harshAccelerationDigital",
          "harshAccelerationValue",
          thresholds.harshAccel,
        ),
        corner: flagHarsh(
          point.variables,
          "harshCorneringDigital",
          "harshCorneringValue",
          thresholds.harshCorner,
        ),
        over: overspeed(point.variables, thresholds.speedLimitKmh),
      });
    }
  }

  samples.sort((a, b) => a.ms - b.ms);

  const buckets = new Map<string, BehaviorPeriod>();
  const ensure = (dateKey: string) => {
    const key = periodKey(dateKey, options.period);
    let row = buckets.get(key);
    if (!row) {
      row = {
        key,
        label: periodLabel(key, options.period),
        harshBraking: 0,
        harshAcceleration: 0,
        harshCornering: 0,
        overspeed: 0,
      };
      buckets.set(key, row);
    }
    return row;
  };

  let prevBrake = false;
  let prevAccel = false;
  let prevCorner = false;
  let prevOver = false;

  for (const sample of samples) {
    const row = ensure(sample.dateKey);
    if (sample.brake && !prevBrake) row.harshBraking += 1;
    if (sample.accel && !prevAccel) row.harshAcceleration += 1;
    if (sample.corner && !prevCorner) row.harshCornering += 1;
    if (sample.over && !prevOver) row.overspeed += 1;
    prevBrake = sample.brake;
    prevAccel = sample.accel;
    prevCorner = sample.corner;
    prevOver = sample.over;
  }

  const rows = [...buckets.keys()].sort().map((key) => buckets.get(key)!);
  const harshBraking = rows.reduce((s, r) => s + r.harshBraking, 0);
  const harshAcceleration = rows.reduce((s, r) => s + r.harshAcceleration, 0);
  const harshCornering = rows.reduce((s, r) => s + r.harshCornering, 0);
  const overspeedCount = rows.reduce((s, r) => s + r.overspeed, 0);
  const totalEvents = harshBraking + harshAcceleration + harshCornering + overspeedCount;
  const eventsPer100km = options.distanceKm > 0 ? (totalEvents / options.distanceKm) * 100 : 0;

  return {
    rows,
    harshBraking,
    harshAcceleration,
    harshCornering,
    overspeed: overspeedCount,
    totalEvents,
    eventsPer100km,
    safetyScore: safetyScoreFromRate(eventsPer100km),
    topIssue: topIssueName({
      harshBraking,
      harshAcceleration,
      harshCornering,
      overspeed: overspeedCount,
    }),
  };
}
