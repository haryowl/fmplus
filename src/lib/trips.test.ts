import { describe, expect, it } from "vitest";
import { assignLogicalTrips, type MotionPoint } from "./trips";

const BREAK = 5 * 60 * 1000;

function pt(ms: number, speedKmh: number, ignition = true): MotionPoint {
  return { ms, dateKey: "2025-04-01", ignition, speedKmh, logicalTripId: null };
}

describe("assignLogicalTrips", () => {
  it("merges adjacent Armada recordings while still driving", () => {
    const points = [
      pt(0, 36),
      pt(30_000, 40),
      pt(90_000, 38),
      pt(120_000, 42),
    ];
    const starts = assignLogicalTrips(points, { minSpeedKmh: 3, breakMs: BREAK });
    expect(starts.size).toBe(1);
    expect(new Set(points.map((p) => p.logicalTripId))).toEqual(new Set([1]));
  });

  it("splits on a GPS gap longer than the break", () => {
    const points = [pt(0, 36), pt(60_000, 40), pt(BREAK + 120_000, 38), pt(BREAK + 180_000, 40)];
    assignLogicalTrips(points, { minSpeedKmh: 3, breakMs: BREAK });
    expect(points[0].logicalTripId).toBe(1);
    expect(points[2].logicalTripId).toBe(2);
  });

  it("splits when ignition turns off, then a new trip after moving again", () => {
    const points = [
      pt(0, 36, true),
      pt(30_000, 40, true),
      pt(60_000, 0, false),
      pt(90_000, 0, false),
      pt(120_000, 36, true),
      pt(150_000, 40, true),
    ];
    assignLogicalTrips(points, { minSpeedKmh: 3, breakMs: BREAK });
    expect(points[0].logicalTripId).toBe(1);
    expect(points[2].logicalTripId).toBe(1);
    expect(points[3].logicalTripId).toBeNull();
    expect(points[4].logicalTripId).toBe(2);
  });

  it("keeps a short stop in the same trip and splits after a long park", () => {
    const short = [pt(0, 40), pt(30_000, 0), pt(90_000, 40)];
    assignLogicalTrips(short, { minSpeedKmh: 3, breakMs: BREAK });
    expect(short.map((p) => p.logicalTripId)).toEqual([1, 1, 1]);

    const parked = [pt(0, 40), pt(30_000, 0), pt(BREAK + 30_000, 0), pt(BREAK + 60_000, 40)];
    assignLogicalTrips(parked, { minSpeedKmh: 3, breakMs: BREAK });
    expect(parked[0].logicalTripId).toBe(1);
    expect(parked[2].logicalTripId).toBeNull();
    expect(parked[3].logicalTripId).toBe(2);
  });

  it("does not count engine-on idle with no movement as a trip", () => {
    const points = [pt(0, 0, true), pt(60_000, 0, true), pt(120_000, 0, true)];
    const starts = assignLogicalTrips(points, { minSpeedKmh: 3, breakMs: BREAK });
    expect(starts.size).toBe(0);
    expect(points.every((p) => p.logicalTripId === null)).toBe(true);
  });
});
