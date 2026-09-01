import { describe, expect, it } from "vitest";
import { haversineKm } from "./geo";
import { computePeriodMetrics } from "./metrics";
import { dateKeyInOffset, updatedSinceWindows } from "./time";
import type { Trip } from "./types";

describe("updatedSinceWindows", () => {
  it("matches V17: three 14-day steps covering at least 42 days from From", () => {
    expect(updatedSinceWindows("2024-08-18", "2024-08-31")).toEqual([
      "2024-08-18",
      "2024-09-01",
      "2024-09-15",
    ]);
  });

  it("adds more windows when To is beyond 42 days", () => {
    const windows = updatedSinceWindows("2024-08-18", "2024-10-20");
    expect(windows[0]).toBe("2024-08-18");
    expect(windows.at(-1)).toBe("2024-10-13");
    expect(windows.length).toBeGreaterThan(3);
  });
});

describe("dateKeyInOffset", () => {
  it("uses the selected offset, not the browser timezone", () => {
    const utcEvening = Date.parse("2025-04-01T17:00:00Z");
    expect(dateKeyInOffset(utcEvening, "+08:00")).toBe("2025-04-02");
    expect(dateKeyInOffset(utcEvening, "+00:00")).toBe("2025-04-01");
  });
});

describe("haversineKm", () => {
  it("measures a known Jakarta–Bali-scale hop roughly", () => {
    const km = haversineKm(-6.2, 106.8, -8.7, 115.2);
    expect(km).toBeGreaterThan(900);
    expect(km).toBeLessThan(1200);
  });
});

describe("computePeriodMetrics", () => {
  it("sums GPS distance across multiple trips on the same day", () => {
    const point = (utc: string, lat: number, lon: number, speed = 10): Trip["tracks"][number] => ({
      utc,
      position: { latitude: lat, longitude: lon },
      variables: { ignition: true, speed, odometerAcc: 0 },
    });

    const trips: Trip[] = [
      {
        trackInfoId: 1,
        userId: 9,
        created: null,
        tracks: [
          point("2025-04-01T01:00:00Z", -6.2, 106.8),
          point("2025-04-01T01:02:00Z", -6.205, 106.805),
        ],
      },
      {
        trackInfoId: 2,
        userId: 9,
        created: null,
        tracks: [
          point("2025-04-01T05:00:00Z", -6.3, 106.9),
          point("2025-04-01T05:02:00Z", -6.305, 106.905),
        ],
      },
    ];

    const rows = computePeriodMetrics(trips, {
      period: "daily",
      dateFrom: "2025-04-01",
      dateTo: "2025-04-01",
      timezone: "+00:00",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].tripCount).toBe(2);
    expect(rows[0].gpsDistanceKm).toBeGreaterThan(1);
  });

  it("merges close Armada recordings into one driving trip", () => {
    const point = (utc: string, lat: number, lon: number): Trip["tracks"][number] => ({
      utc,
      position: { latitude: lat, longitude: lon },
      variables: { ignition: true, speed: 10, odometerAcc: 0 },
    });

    const trips: Trip[] = [
      {
        trackInfoId: 1,
        userId: 9,
        created: null,
        tracks: [
          point("2025-04-01T01:00:00Z", -6.2, 106.8),
          point("2025-04-01T01:01:00Z", -6.201, 106.801),
        ],
      },
      {
        trackInfoId: 2,
        userId: 9,
        created: null,
        tracks: [
          point("2025-04-01T01:02:00Z", -6.202, 106.802),
          point("2025-04-01T01:03:00Z", -6.203, 106.803),
        ],
      },
    ];

    const rows = computePeriodMetrics(trips, {
      period: "daily",
      dateFrom: "2025-04-01",
      dateTo: "2025-04-01",
      timezone: "+00:00",
    });

    expect(rows[0].tripCount).toBe(1);
  });

  it("counts idle when the engine is on and speed is below the minimum", () => {
    const trips: Trip[] = [
      {
        trackInfoId: 1,
        userId: 9,
        created: null,
        tracks: [
          {
            utc: "2025-04-01T01:00:00Z",
            variables: { ignition: true, speed: 0 },
          },
          {
            utc: "2025-04-01T01:04:00Z",
            variables: { ignition: true, speed: 0 },
          },
        ],
      },
    ];

    const rows = computePeriodMetrics(trips, {
      period: "daily",
      dateFrom: "2025-04-01",
      dateTo: "2025-04-01",
      timezone: "+00:00",
    });

    expect(rows[0].idleHours).toBeCloseTo(4 / 60, 5);
    expect(rows[0].activeHours).toBe(0);
  });

  it("takes CAN fuel used as last minus first non-zero reading", () => {
    const trips: Trip[] = [
      {
        trackInfoId: 1,
        userId: 9,
        created: null,
        tracks: [
          {
            utc: "2025-04-01T01:00:00Z",
            variables: { ignition: true, speed: 5, caN300_FuelConsumed: 50 },
          },
          {
            utc: "2025-04-01T01:20:00Z",
            variables: { ignition: true, speed: 5, caN300_FuelConsumed: 70 },
          },
        ],
      },
    ];

    const rows = computePeriodMetrics(trips, {
      period: "daily",
      dateFrom: "2025-04-01",
      dateTo: "2025-04-01",
      timezone: "+00:00",
      fuelPricePerL: 10000,
    });

    expect(rows[0].fuelUsedL).toBe(20);
    expect(rows[0].fuelCost).toBe(200000);
    expect(rows[0].fuelSource).toBe("can");
    expect(rows[0].canFuelUsedL).toBe(20);
    expect(rows[0].tankFuelUsedL).toBe(0);
  });

  it("uses tank decrease plus refills when the CAN counter does not move", () => {
    const trips: Trip[] = [
      {
        trackInfoId: 1,
        userId: 9,
        created: null,
        tracks: [
          {
            utc: "2025-04-01T02:00:00Z",
            variables: { ignition: true, speed: 0, "fuel level": 40 },
          },
          {
            utc: "2025-04-01T02:02:00Z",
            variables: { ignition: true, speed: 0, "fuel level": 52 },
          },
          {
            utc: "2025-04-01T04:00:00Z",
            variables: { ignition: true, speed: 5, "fuel level": 30 },
          },
        ],
      },
    ];

    const rows = computePeriodMetrics(trips, {
      period: "daily",
      dateFrom: "2025-04-01",
      dateTo: "2025-04-01",
      timezone: "+00:00",
      refillThresholdL: 8,
    });

    // first 40 + refill 12 − last 30 = 22
    expect(rows[0].refillL).toBe(12);
    expect(rows[0].fuelUsedL).toBe(22);
    expect(rows[0].fuelSource).toBe("tank");
    expect(rows[0].canFuelUsedL).toBe(0);
    expect(rows[0].tankFuelUsedL).toBe(22);
  });

  it("detects a low-speed tank rise at or above the refill threshold", () => {
    const trips: Trip[] = [
      {
        trackInfoId: 1,
        userId: 9,
        created: null,
        tracks: [
          {
            utc: "2025-04-01T02:00:00Z",
            variables: { ignition: true, speed: 0, "fuel level": 10 },
          },
          {
            utc: "2025-04-01T02:02:00Z",
            variables: { ignition: true, speed: 0, "fuel level": 22 },
          },
        ],
      },
    ];

    const rows = computePeriodMetrics(trips, {
      period: "daily",
      dateFrom: "2025-04-01",
      dateTo: "2025-04-01",
      timezone: "+00:00",
      refillThresholdL: 8,
    });

    expect(rows[0].refillEvents).toBe(1);
    expect(rows[0].refillL).toBe(12);
  });

  it("averages non-zero speed and RPM and keeps the period max", () => {
    const trips: Trip[] = [
      {
        trackInfoId: 1,
        userId: 9,
        created: null,
        tracks: [
          {
            utc: "2025-04-01T01:00:00Z",
            variables: { ignition: true, speed: 0, caN300_EngineRPM: 0 },
          },
          {
            utc: "2025-04-01T01:01:00Z",
            variables: { ignition: true, speed: 10, caN300_EngineRPM: 800 },
          },
          {
            utc: "2025-04-01T01:02:00Z",
            variables: { ignition: true, speed: 20, caN300_EngineRPM: 1200 },
          },
        ],
      },
    ];

    const rows = computePeriodMetrics(trips, {
      period: "daily",
      dateFrom: "2025-04-01",
      dateTo: "2025-04-01",
      timezone: "+00:00",
    });

    expect(rows[0].avgSpeedKmh).toBeCloseTo(54, 5);
    expect(rows[0].maxSpeedKmh).toBeCloseTo(72, 5);
    expect(rows[0].speedSamples).toBe(2);
    expect(rows[0].avgRpm).toBe(1000);
    expect(rows[0].maxRpm).toBe(1200);
    expect(rows[0].rpmSamples).toBe(2);
  });

  it("counts filtered elevation gain and raises flat-terrain km/l", () => {
    const t0 = Date.parse("2025-04-01T01:00:00Z");
    const point = (offsetSec: number, lat: number, lon: number, alt: number, fuel: number) => ({
      utc: new Date(t0 + offsetSec * 1000).toISOString(),
      position: { latitude: lat, longitude: lon, altitude: alt },
      variables: { ignition: true, speed: 10, caN300_FuelConsumed: fuel },
    });

    const trips: Trip[] = [
      {
        trackInfoId: 1,
        userId: 9,
        created: null,
        tracks: [
          point(0, -6.2, 106.8, 10, 10),
          point(20, -6.201, 106.801, 18, 10.2),
          point(40, -6.202, 106.802, 28, 10.4),
          point(60, -6.203, 106.803, 40, 10.6),
        ],
      },
    ];

    const rows = computePeriodMetrics(trips, {
      period: "daily",
      dateFrom: "2025-04-01",
      dateTo: "2025-04-01",
      timezone: "+00:00",
    });

    expect(rows[0].elevationGainM).toBe(30);
    expect(rows[0].elevationLossM).toBe(0);
    expect(rows[0].altitudeMinM).toBe(10);
    expect(rows[0].altitudeMaxM).toBe(40);
    expect(rows[0].terrainImpactPct).toBeGreaterThan(0);
    expect(rows[0].flatKmPerL).toBeGreaterThan(rows[0].kmPerL);
  });

  it("keeps CAN as the cost figure while still reporting tank identity", () => {
    const trips: Trip[] = [
      {
        trackInfoId: 1,
        userId: 9,
        created: null,
        tracks: [
          {
            utc: "2025-04-01T01:00:00Z",
            variables: {
              ignition: true,
              speed: 5,
              caN300_FuelConsumed: 10,
              "fuel level": 40,
            },
          },
          {
            utc: "2025-04-01T01:20:00Z",
            variables: {
              ignition: true,
              speed: 5,
              caN300_FuelConsumed: 16,
              "fuel level": 33,
            },
          },
        ],
      },
    ];

    const rows = computePeriodMetrics(trips, {
      period: "daily",
      dateFrom: "2025-04-01",
      dateTo: "2025-04-01",
      timezone: "+00:00",
    });

    expect(rows[0].canFuelUsedL).toBe(6);
    expect(rows[0].tankFuelUsedL).toBe(7);
    expect(rows[0].fuelUsedL).toBe(6);
    expect(rows[0].fuelSource).toBe("can");
  });

  it("buckets accelerometer magnitude into V8 smooth / rough / bumpy shares", () => {
    const trips: Trip[] = [
      {
        trackInfoId: 1,
        userId: 9,
        created: null,
        tracks: [
          {
            utc: "2025-04-01T01:00:00Z",
            variables: { ignition: true, speed: 5, axisX: 40, axisY: 0, axisZ: 0 },
          },
          {
            utc: "2025-04-01T01:01:00Z",
            variables: { ignition: true, speed: 5, axisX: 200, axisY: 0, axisZ: 0 },
          },
          {
            utc: "2025-04-01T01:02:00Z",
            variables: { ignition: true, speed: 5, axisX: 400, axisY: 0, axisZ: 0 },
          },
        ],
      },
    ];

    const rows = computePeriodMetrics(trips, {
      period: "daily",
      dateFrom: "2025-04-01",
      dateTo: "2025-04-01",
      timezone: "+00:00",
    });

    expect(rows[0].roadSamples).toBe(3);
    expect(rows[0].roadSmoothPct).toBeCloseTo(100 / 3, 5);
    expect(rows[0].roadRoughPct).toBeCloseTo(100 / 3, 5);
    expect(rows[0].roadBumpyPct).toBeCloseTo(100 / 3, 5);
    expect(rows[0].avgVibrationMg).toBeCloseTo(640 / 3, 5);
  });
});
