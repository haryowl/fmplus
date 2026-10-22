import { describe, expect, it } from "vitest";
import {
  gpsStepKm,
  resolveOdometerKm,
  sumGpsTrackKm,
} from "../../server/gps-odometer.mjs";

describe("sumGpsTrackKm", () => {
  it("adds jump-filtered GNSS steps", () => {
    const t0 = Date.parse("2026-10-21T08:00:00Z");
    const points = [
      { lat: -6.2, lon: 106.8, ms: t0 },
      { lat: -6.35, lon: 106.8, ms: t0 + 20 * 60_000 },
      { lat: -6.55, lon: 106.8, ms: t0 + 50 * 60_000 },
    ];
    const km = sumGpsTrackKm(points);
    expect(km).toBeGreaterThan(30);
    expect(km).toBeLessThan(50);
    expect(sumGpsTrackKm(points.slice(0, 1))).toBe(0);
  });

  it("drops a teleport", () => {
    const t0 = Date.parse("2026-10-21T08:00:00Z");
    expect(
      gpsStepKm(
        { lat: -6.2, lon: 106.8, ms: t0 },
        { lat: -8.0, lon: 106.8, ms: t0 + 4000 },
      ),
    ).toBe(0);
  });
});

describe("resolveOdometerKm", () => {
  it("prefers hardware odo over GPS", () => {
    expect(resolveOdometerKm(148376.9, 12.4, {})).toEqual({
      odometerKm: 148376.9,
      odometerSource: "device",
    });
  });

  it("falls back to GPS when hardware odo is missing or zero", () => {
    expect(resolveOdometerKm(null, 18.7, {})).toEqual({
      odometerKm: 18.7,
      odometerSource: "gps",
    });
    expect(resolveOdometerKm(0, 18.7, {})).toEqual({
      odometerKm: 18.7,
      odometerSource: "gps",
    });
    expect(resolveOdometerKm(null, null, { odometer_km: 9 })).toEqual({
      odometerKm: 9,
      odometerSource: "device",
    });
  });
});
