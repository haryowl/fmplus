import { describe, expect, it } from "vitest";
import {
  buildTripSegments,
  inclusiveDayCount,
  recordedHoursFromSegments,
  segmentFuel,
  timelineSlicesForDay,
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
  it("counts inclusive calendar days and exposes the 31-day cap", () => {
    expect(inclusiveDayCount("2026-08-01", "2026-08-01")).toBe(1);
    expect(inclusiveDayCount("2026-08-01", "2026-08-03")).toBe(3);
    expect(inclusiveDayCount("2026-08-01", "2026-08-04")).toBe(4);
    expect(TRIP_DETAIL_MAX_DAYS).toBe(31);
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
    expect(segmentFuel(points)).toEqual({
      fuelUsedL: 2.5,
      fuelSource: "can",
      refillL: 0,
      refillEvents: [],
    });
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
  it("merges parked heartbeat stops into one Stop across long gaps", () => {
    const trip: Trip = {
      trackInfoId: 1,
      userId: 9,
      created: new Date("2026-08-15T01:00:00+07:00"),
      tracks: [
        pt("2026-08-15T01:00:00+07:00", { ign: true, speedMs: 10, lat: -6.2, lon: 106.8 }),
        pt("2026-08-15T01:05:00+07:00", { ign: true, speedMs: 10, lat: -6.201, lon: 106.801 }),
        pt("2026-08-15T01:06:00+07:00", { ign: false, speedMs: 0, lat: -6.201, lon: 106.801 }),
        // Hourly park heartbeats — one Stop from first to last
        pt("2026-08-15T02:06:00+07:00", { ign: false, speedMs: 0, lat: -6.201, lon: 106.801 }),
        pt("2026-08-15T03:06:00+07:00", { ign: false, speedMs: 0, lat: -6.201, lon: 106.801 }),
        pt("2026-08-15T04:06:00+07:00", { ign: false, speedMs: 0, lat: -6.201, lon: 106.801 }),
      ],
    };

    const segments = buildTripSegments([trip], { timezone: "+07:00", tripBreakMin: 5, minSpeedKmh: 3 });
    const trips = segments.filter((s) => s.status === "trip");
    const stops = segments.filter((s) => s.status === "stop");
    expect(trips.length).toBeGreaterThanOrEqual(1);
    expect(stops).toHaveLength(1);
    // Park heartbeats from ~01:06/02:06 through 04:06 collapse to one Stop (≥2h wall clock).
    expect(stops[0].durationMs).toBeGreaterThanOrEqual(2 * 3_600_000);
    expect(stops[0].pointCount).toBeGreaterThanOrEqual(3);
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

describe("timelineSlicesForDay", () => {
  it("places a segment as a percentage of the day", () => {
    const slices = timelineSlicesForDay(
      [
        {
          id: "trip-1",
          status: "trip",
          logicalTripId: 1,
          color: "#0b6b62",
          startMs: Date.parse("2026-08-15T06:00:00+07:00"),
          endMs: Date.parse("2026-08-15T12:00:00+07:00"),
          durationMs: 6 * 3_600_000,
          startLat: -6.2,
          startLon: 106.8,
          endLat: -6.3,
          endLon: 106.9,
          distanceKm: 10,
          avgSpeedKmh: 40,
          maxSpeedKmh: 60,
          avgRpm: 0,
          maxRpm: 0,
          fuelUsedL: 0,
          fuelSource: "none",
          refillL: 0,
          refillEvents: [],
          path: [],
          pointCount: 2,
        },
      ],
      "2026-08-15",
      "+07:00",
    );
    expect(slices).toHaveLength(1);
    expect(slices[0].leftPct).toBeCloseTo(25, 0);
    expect(slices[0].widthPct).toBeCloseTo(25, 0);
  });
});
