import { describe, expect, it } from "vitest";
import { buildDeviceTrips, slimDayPoints } from "./deviceDayTrips";
import type { TrackerDayPoint } from "./trackerDevices";

function pt(lat: number, lon: number, ms: number, speed = 40): TrackerDayPoint {
  return {
    lat,
    lon,
    speed,
    heading: 90,
    ignition: true,
    odometerKm: null,
    recordedAt: new Date(ms).toISOString(),
  };
}

describe("buildDeviceTrips", () => {
  it("drops GPS jump points so a teleport is not counted as distance", () => {
    const t0 = Date.parse("2026-10-21T08:00:00.000Z");
    const trips = buildDeviceTrips(
      [
        pt(-3.99, 122.51, t0),
        pt(-5.47, 122.63, t0 + 5_000),
        pt(-3.995, 122.52, t0 + 40_000),
      ],
      { tzOffset: "+08:00" },
    );
    expect(trips).toHaveLength(1);
    expect(trips[0].distanceKm).toBeLessThan(5);
    expect(trips[0].path).toHaveLength(2);
  });
});

describe("slimDayPoints", () => {
  it("filters null-island and jump points before downsample", () => {
    const t0 = Date.parse("2026-10-21T08:00:00.000Z");
    const slim = slimDayPoints(
      [pt(-3.99, 122.51, t0), pt(0, 0, t0 + 1_000), pt(-3.991, 122.511, t0 + 20_000)],
      800,
    );
    expect(slim.every((p) => !(p.lat === 0 && p.lon === 0))).toBe(true);
    expect(slim.length).toBe(2);
  });
});
