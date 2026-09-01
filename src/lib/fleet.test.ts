import { describe, expect, it } from "vitest";
import type { BehaviorSummary } from "./behavior";
import type { MetricsTotals } from "./metrics";
import {
  buildFleetInsights,
  columnTones,
  sortFleetRows,
  type FleetVehicleRow,
} from "./fleet";
import type { PeriodMetrics } from "./types";

const totals = (over: Partial<MetricsTotals> = {}): MetricsTotals =>
  ({
    gps: 100,
    ignition: 90,
    odometer: 95,
    hours: 4,
    idle: 1,
    fuel: 20,
    canFuel: 20,
    tankFuel: 18,
    refill: 0,
    refillEvents: 0,
    cost: 210000,
    trips: 2,
    points: 10,
    days: 1,
    avgSpeed: 40,
    maxSpeed: 80,
    avgRpm: 1500,
    maxRpm: 2800,
    elevationGainM: 0,
    elevationLossM: 0,
    altitudeMinM: null,
    altitudeMaxM: null,
    altitudeSamples: 0,
    terrainImpactPct: 0,
    flatKmPerL: 5,
    roadSmoothCount: 0,
    roadRoughCount: 0,
    roadBumpyCount: 0,
    roadSamples: 0,
    roadSmoothPct: 0,
    roadRoughPct: 0,
    roadBumpyPct: 0,
    avgVibrationMg: 0,
    maxVibrationMg: 0,
    ...over,
  }) as MetricsTotals;

const behavior = (over: Partial<BehaviorSummary> = {}): BehaviorSummary => ({
  rows: [],
  harshBraking: 0,
  harshAcceleration: 0,
  harshCornering: 0,
  overspeed: 0,
  totalEvents: 0,
  eventsPer100km: 0,
  safetyScore: 100,
  topIssue: null,
  ...over,
});

const vehicle = (over: Partial<FleetVehicleRow> & { userId: number; label: string }): FleetVehicleRow => ({
  color: "#0b6b62",
  rows: [] as PeriodMetrics[],
  totals: totals(),
  behavior: behavior(),
  hasData: true,
  ...over,
});

describe("columnTones", () => {
  it("marks the best km/l high and the worst low", () => {
    expect(columnTones([8, 12, 5], "higher")).toEqual(["", "best", "worst"]);
  });

  it("marks the lowest idle as best", () => {
    expect(columnTones([10, 40, 25], "lower")).toEqual(["best", "worst", ""]);
  });
});

describe("sortFleetRows", () => {
  it("sorts by efficiency descending", () => {
    const rows = [
      vehicle({ userId: 1, label: "A", totals: totals({ gps: 100, fuel: 20 }) }),
      vehicle({ userId: 2, label: "B", totals: totals({ gps: 100, fuel: 10 }) }),
    ];
    expect(sortFleetRows(rows, "kmPerL", "desc").map((r) => r.label)).toEqual(["B", "A"]);
  });
});

describe("buildFleetInsights", () => {
  it("asks for a second vehicle when only one has data", () => {
    const blocks = buildFleetInsights([
      vehicle({ userId: 1, label: "Truck A", totals: totals({ gps: 80 }) }),
    ]);
    expect(blocks[0].body).toContain("Truck A");
    expect(blocks[0].body).toContain("Add another");
  });

  it("names the distance leader among several vehicles", () => {
    const blocks = buildFleetInsights([
      vehicle({ userId: 1, label: "A", totals: totals({ gps: 40, fuel: 10 }) }),
      vehicle({ userId: 2, label: "B", totals: totals({ gps: 90, fuel: 10 }) }),
    ]);
    const distance = blocks.find((b) => b.id === "distance")!;
    expect(distance.body).toContain("B covered the most");
    expect(distance.body).toContain("A covered the least");
  });
});
