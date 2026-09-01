import { describe, expect, it } from "vitest";
import { comparePeriods, deltaTone, pctChange } from "./compare";
import type { PeriodMetrics } from "./types";

const base = (over: Partial<PeriodMetrics> = {}): PeriodMetrics => ({
  key: "a",
  label: "A",
  gpsDistanceKm: 100,
  ignitionDistanceKm: 90,
  odometerKm: 95,
  activeHours: 4,
  idleHours: 1,
  fuelUsedL: 20,
  fuelSource: "can",
  canFuelUsedL: 20,
  tankFuelUsedL: 18,
  refillL: 25,
  refillEvents: 1,
  fuelCost: 200000,
  costPerKm: 2000,
  kmPerL: 5,
  lPerKm: 0.2,
  tripCount: 2,
  pointCount: 10,
  calendarDays: 1,
  avgSpeedKmh: 40,
  maxSpeedKmh: 80,
  speedSamples: 10,
  avgRpm: 1500,
  maxRpm: 2800,
  rpmSamples: 10,
  elevationGainM: 40,
  elevationLossM: 35,
  altitudeMinM: 10,
  altitudeMaxM: 50,
  altitudeSamples: 8,
  terrainImpactPct: 0.4,
  flatKmPerL: 5.02,
  roadSmoothCount: 7,
  roadRoughCount: 2,
  roadBumpyCount: 1,
  roadSamples: 10,
  roadSmoothPct: 70,
  roadRoughPct: 20,
  roadBumpyPct: 10,
  avgVibrationMg: 120,
  maxVibrationMg: 400,
  ...over,
});

describe("pctChange", () => {
  it("returns 0 when both are zero and null when rising from zero", () => {
    expect(pctChange(0, 0)).toBe(0);
    expect(pctChange(0, 10)).toBeNull();
    expect(pctChange(10, 15)).toBe(50);
  });
});

describe("comparePeriods", () => {
  it("marks lower fuel as good and higher efficiency as good", () => {
    const rows = comparePeriods(
      base(),
      base({ fuelUsedL: 16, kmPerL: 6, idleHours: 2, key: "b", label: "B" }),
    );
    const fuel = rows.find((r) => r.id === "fuel")!;
    const kml = rows.find((r) => r.id === "kml")!;
    const idle = rows.find((r) => r.id === "idle")!;
    expect(deltaTone(fuel)).toBe("good");
    expect(deltaTone(kml)).toBe("good");
    expect(deltaTone(idle)).toBe("bad");
  });
});
