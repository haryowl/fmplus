import { describe, expect, it } from "vitest";
import { deviceNumericId, devicePointsToTrip } from "./deviceMetrics";

describe("deviceMetrics", () => {
  it("maps a device UUID to a stable negative id", () => {
    const a = deviceNumericId("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    const b = deviceNumericId("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(a).toBe(b);
    expect(a).toBeLessThan(0);
    expect(deviceNumericId("ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee")).not.toBe(a);
  });

  it("converts device km/h and odometer km into Armada track units", () => {
    const trip = devicePointsToTrip("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", [
      {
        lat: -6.2,
        lon: 106.8,
        speed: 36,
        heading: 90,
        ignition: true,
        odometerKm: 12.5,
        altitude: 40,
        recordedAt: "2026-10-24T01:00:00.000Z",
      },
    ]);
    expect(trip.userId).toBeLessThan(0);
    expect(trip.tracks).toHaveLength(1);
    expect(trip.tracks[0].variables?.speed).toBeCloseTo(10);
    expect(trip.tracks[0].variables?.odometerAcc).toBe(12500);
    expect(trip.tracks[0].variables?.ignition).toBe(true);
    expect(trip.tracks[0].position?.altitude).toBe(40);
  });
});
