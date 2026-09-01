import { describe, expect, it } from "vitest";
import { buildInsights, type InsightInput } from "./insight";

const base = (over: Partial<InsightInput> = {}): InsightInput => ({
  gpsKm: 6,
  activeHours: 0.2,
  idleHours: 0.1,
  avgSpeedKmh: 15,
  avgRpm: 900,
  maxRpm: 1400,
  fuelUsedL: 0.7,
  canFuelUsedL: 0.7,
  tankFuelUsedL: 0.8,
  kmPerL: 8.6,
  flatKmPerL: 8.7,
  terrainImpactPct: 0.9,
  elevationGainM: 54,
  elevationLossM: 20,
  altitudeSamples: 12,
  roadSamples: 10,
  roadSmoothPct: 74.7,
  roadRoughPct: 20.3,
  roadBumpyPct: 5.1,
  avgVibrationMg: 103,
  behavior: {
    rows: [],
    harshBraking: 0,
    harshAcceleration: 0,
    harshCornering: 0,
    overspeed: 0,
    totalEvents: 0,
    eventsPer100km: 0,
    safetyScore: 100,
    topIssue: null,
  },
  ...over,
});

describe("buildInsights", () => {
  it("writes efficiency, terrain, road, and the V8-style fuel inspection under 10 km/l", () => {
    const blocks = buildInsights(base(), "standard");
    const byId = Object.fromEntries(blocks.map((b) => [b.id, b.body]));
    expect(byId.efficiency).toContain("8.6");
    expect(byId.efficiency).toContain("8.7");
    expect(byId.behavior).toContain("no significant events");
    expect(byId.road).toContain("74.7%");
    expect(byId.road).toContain("103 mG");
    expect(byId.maintenance).toContain("Fuel system inspection");
  });

  it("omits the road block when there are no accelerometer samples", () => {
    const blocks = buildInsights(base({ roadSamples: 0 }), "standard");
    expect(blocks.some((b) => b.id === "road")).toBe(false);
  });
});
