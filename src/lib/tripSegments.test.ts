import { describe, expect, it } from "vitest";
import {
  buildTripSegments,
  inclusiveDayCount,
  recordedHoursFromSegments,
  segmentFuel,
  TRIP_DETAIL_MAX_DAYS,
  type TripSegmentPoint,
} from "./tripSegments";
import type { Trip } from "./types";

function pt(
  utc: string,
  opts: {
    ign?: boolean;
    speedMs?: number;
    lat?: number;
    lon?: number;
    fuel?: number;
    level?: number;
    rpm?: number;
  } = {},
) {
  return {
    utc,
    position: {
      latitude: opts.lat ?? -6.2,
      longitude: opts.lon ?? 106.8,
    },
    variables: {
      ignition: opts.ign ?? true,
      speed: opts.speedMs ?? 0,
      caN300_FuelConsumed: opts.fuel,
      "fuel level": opts.level,
      caN300_EngineRPM: opts.rpm,
    },
  };
}

describe("inclusiveDayCount / max days", () => {
  it("counts inclusive calendar days and exposes the 3-day cap", () => {
    expect(inclusiveDayCount("2026-08-01", "2026-08-01")).toBe(1);
    expect(inclusiveDayCount("2026-08-01", "2026-08-03")).toBe(3);
    expect(inclusiveDayCount("2026-08-01", "2026-08-04")).toBe(4);
    expect(TRIP_DETAIL_MAX_DAYS).toBe(3);
  });
});

describe("segmentFuel", () => {
  it("prefers CAN fuel consumed delta", () => {
    const points: TripSegmentPoint[] = [
      {
        ms: 1,
        lat: 0,
        lon: 0,
        ignition: true,
        speedKmh: 20,
        rpm: null,
        fuelConsumed: 10,
        fuelLevel: 40,
        logicalTripId: 1,
      },
      {
        ms: 2,
        lat: 0,
        lon: 0,
        ignition: true,
        speedKmh: 20,
        rpm: null,
        fuelConsumed: 12.5,
        fuelLevel: 38,
        logicalTripId: 1,
      },
    ];
    expect(segmentFuel(points)).toEqual({ fuelUsedL: 2.5, fuelSource: "can", refillL: 0 });
  });

  it("falls back to tank fuel level when CAN does not move", () => {
    const points: TripSegmentPoint[] = [
      {
        ms: 1,
        lat: 0,
        lon: 0,
        ignition: true,
        speedKmh: 10,
        rpm: null,
        fuelConsumed: 50,
        fuelLevel: 40,
        logicalTripId: 1,
      },
      {
        ms: 2,
        lat: 0,
        lon: 0,
        ignition: true,
        speedKmh: 10,
        rpm: null,
        fuelConsumed: 50,
        fuelLevel: 35,
        logicalTripId: 1,
      },
    ];
    const fuel = segmentFuel(points);
    expect(fuel.fuelSource).toBe("tank");
    expect(fuel.fuelUsedL).toBe(5);
  });
});

describe("buildTripSegments", () => {
  it("builds trip and stop; long GPS gaps are not filled as stop", () => {
    const trip: Trip = {
      trackInfoId: 1,
      userId: 9,
      created: new Date("2026-08-15T01:00:00+07:00"),
      tracks: [
        pt("2026-08-15T01:00:00+07:00", { ign: true, speedMs: 10, lat: -6.2, lon: 106.8 }),
        pt("2026-08-15T01:05:00+07:00", { ign: true, speedMs: 10, lat: -6.201, lon: 106.801 }),
        pt("2026-08-15T01:06:00+07:00", { ign: false, speedMs: 0, lat: -6.201, lon: 106.801 }),
        // 2h gap — unrecorded, must not become a 2h Stop row
        pt("2026-08-15T03:10:00+07:00", { ign: false, speedMs: 0, lat: -6.202, lon: 106.802 }),
        pt("2026-08-15T03:12:00+07:00", { ign: false, speedMs: 0, lat: -6.202, lon: 106.802 }),
      ],
    };

    const segments = buildTripSegments([trip], { timezone: "+07:00", tripBreakMin: 5, minSpeedKmh: 3 });
    const trips = segments.filter((s) => s.status === "trip");
    const stops = segments.filter((s) => s.status === "stop");
    expect(trips.length).toBeGreaterThanOrEqual(1);
    expect(stops.every((s) => s.durationMs < 30 * 60_000)).toBe(true);
    const hours = recordedHoursFromSegments(segments);
    expect(hours.recordedHours).toBeLessThan(1.5);
  });

  it("marks ignition-on stationary outside a trip as idle", () => {
    const trip: Trip = {
      trackInfoId: 2,
      userId: 9,
      created: new Date("2026-08-15T08:00:00+07:00"),
      tracks: [
        pt("2026-08-15T08:00:00+07:00", { ign: true, speedMs: 0, lat: -6.2, lon: 106.8 }),
        pt("2026-08-15T08:02:00+07:00", { ign: true, speedMs: 0, lat: -6.2, lon: 106.8 }),
        pt("2026-08-15T08:10:00+07:00", { ign: true, speedMs: 12, lat: -6.201, lon: 106.801 }),
        pt("2026-08-15T08:15:00+07:00", { ign: true, speedMs: 12, lat: -6.202, lon: 106.802 }),
      ],
    };
    const segments = buildTripSegments([trip], { timezone: "+07:00", tripBreakMin: 5, minSpeedKmh: 3 });
    expect(segments.some((s) => s.status === "idle")).toBe(true);
    expect(segments.some((s) => s.status === "trip")).toBe(true);
  });
});
