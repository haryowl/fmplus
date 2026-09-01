import { describe, expect, it } from "vitest";
import { computeBehavior, safetyScoreFromRate } from "./behavior";
import type { Trip } from "./types";

const thresholds = {
  harshBrake: 6.5,
  harshAccel: 4.5,
  harshCorner: 0.6,
  speedLimitKmh: 90,
};

const opts = {
  period: "daily" as const,
  dateFrom: "2025-04-01",
  dateTo: "2025-04-01",
  timezone: "+00:00",
  thresholds,
  distanceKm: 50,
};

describe("safetyScoreFromRate", () => {
  it("is 100 at zero events and 50 at 10 events per 100 km", () => {
    expect(safetyScoreFromRate(0)).toBe(100);
    expect(safetyScoreFromRate(10)).toBe(50);
    expect(safetyScoreFromRate(20)).toBe(0);
    expect(safetyScoreFromRate(40)).toBe(0);
  });
});

describe("computeBehavior", () => {
  it("counts a run of overspeed points as one event", () => {
    const trips: Trip[] = [
      {
        trackInfoId: 1,
        userId: 1,
        created: null,
        tracks: [
          { utc: "2025-04-01T01:00:00Z", variables: { speed: 20 } },
          { utc: "2025-04-01T01:00:05Z", variables: { speed: 30 } },
          { utc: "2025-04-01T01:00:10Z", variables: { speed: 31 } },
          { utc: "2025-04-01T01:00:15Z", variables: { speed: 10 } },
        ],
      },
    ];
    const summary = computeBehavior(trips, opts);
    expect(summary.overspeed).toBe(1);
    expect(summary.topIssue).toBe("Overspeed");
  });

  it("counts harsh braking on the rising edge of the digital flag", () => {
    const trips: Trip[] = [
      {
        trackInfoId: 1,
        userId: 1,
        created: null,
        tracks: [
          { utc: "2025-04-01T01:00:00Z", variables: { harshBrakingDigital: false } },
          { utc: "2025-04-01T01:00:02Z", variables: { harshBrakingDigital: true } },
          { utc: "2025-04-01T01:00:04Z", variables: { harshBrakingDigital: true } },
          { utc: "2025-04-01T01:00:06Z", variables: { harshBrakingDigital: false } },
        ],
      },
    ];
    const summary = computeBehavior(trips, { ...opts, distanceKm: 10 });
    expect(summary.harshBraking).toBe(1);
    expect(summary.totalEvents).toBe(1);
    expect(summary.eventsPer100km).toBe(10);
    expect(summary.safetyScore).toBe(50);
  });

  it("uses analog harsh acceleration when it exceeds the threshold", () => {
    const trips: Trip[] = [
      {
        trackInfoId: 1,
        userId: 1,
        created: null,
        tracks: [
          { utc: "2025-04-01T01:00:00Z", variables: { harshAccelerationValue: 1 } },
          { utc: "2025-04-01T01:00:02Z", variables: { harshAccelerationValue: 5 } },
        ],
      },
    ];
    const summary = computeBehavior(trips, opts);
    expect(summary.harshAcceleration).toBe(1);
  });
});
