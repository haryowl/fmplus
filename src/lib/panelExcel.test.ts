import { describe, expect, it } from "vitest";
import { buildXlsx, excelFilename, sanitizeSheetName } from "./xlsxDownload";
import { periodDetailSheet, tripSummarySheet, vehicleKpiSheet } from "./panelExcel";
import type { PeriodMetrics } from "./types";

describe("xlsxDownload", () => {
  it("sanitizes sheet names for Excel", () => {
    expect(sanitizeSheetName("A/B:C*D?E[F]")).toBe("A B C D E F");
    expect(sanitizeSheetName("x".repeat(40)).length).toBe(31);
  });

  it("builds a ZIP workbook", () => {
    const bytes = buildXlsx("Demo", [
      ["A", "B"],
      ["hello", 3],
    ]);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("Demo");
    expect(text).toContain("hello");
    expect(text).toContain("<v>3</v>");
  });

  it("names download files with date suffix", () => {
    expect(excelFilename("trip-detail-segments")).toMatch(/^trip-detail-segments-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});

describe("panelExcel", () => {
  it("builds vehicle KPI and trip summary sheets", () => {
    const kpi = vehicleKpiSheet({
      gps: 10,
      ignition: 9,
      odometer: 11,
      hours: 2,
      idle: 1,
      fuel: 5,
      canFuel: 4,
      tankFuel: 5,
      refill: 0,
      refillEvents: 0,
      cost: 50000,
      trips: 3,
      points: 100,
      days: 1,
      avgSpeed: 40,
      maxSpeed: 80,
      avgRpm: 1500,
      maxRpm: 3000,
      elevationGainM: 0,
      elevationLossM: 0,
      altitudeMinM: null,
      altitudeMaxM: null,
      altitudeSamples: 0,
      terrainImpactPct: 0,
      flatKmPerL: 0,
      roadSmoothCount: 0,
      roadRoughCount: 0,
      roadBumpyCount: 0,
      roadSamples: 0,
      roadSmoothPct: 0,
      roadRoughPct: 0,
      roadBumpyPct: 0,
      avgVibrationMg: 0,
      maxVibrationMg: 0,
    });
    expect(kpi[0]).toEqual(["Metric", "Value"]);
    expect(kpi.some((row) => row[0] === "GPS distance km" && row[1] === 10)).toBe(true);

    const summary = tripSummarySheet({
      trips: 2,
      distanceKm: 12.5,
      movingHours: 1.5,
      idleStopHours: 0.5,
      fuelL: 3,
      events: 4,
      recordedHours: 2,
      dayCount: 1,
    });
    expect(summary.find((row) => row[0] === "Trips")?.[1]).toBe(2);
  });

  it("builds period detail rows", () => {
    const row = {
      key: "d1",
      label: "Day 1",
      gpsDistanceKm: 10,
      ignitionDistanceKm: 9,
      odometerKm: 11,
      activeHours: 2,
      idleHours: 1,
      fuelUsedL: 5,
      fuelSource: "can",
      canFuelUsedL: 5,
      tankFuelUsedL: 0,
      refillL: 0,
      refillEvents: 0,
      fuelCost: 1,
      costPerKm: 0,
      kmPerL: 2,
      lPerKm: 0.5,
      elevationGainM: 0,
      elevationLossM: 0,
      altitudeMinM: null,
      altitudeMaxM: null,
      altitudeSamples: 0,
      terrainImpactPct: 0,
      flatKmPerL: 0,
      roadSmoothCount: 0,
      roadRoughCount: 0,
      roadBumpyCount: 0,
      roadSamples: 0,
      roadSmoothPct: 0,
      roadRoughPct: 0,
      roadBumpyPct: 0,
      avgVibrationMg: 0,
      maxVibrationMg: 0,
      tripCount: 1,
      pointCount: 10,
      calendarDays: 1,
      avgSpeedKmh: 40,
      maxSpeedKmh: 80,
      speedSamples: 5,
      avgRpm: 1500,
      maxRpm: 3000,
      rpmSamples: 5,
    } satisfies PeriodMetrics;
    const sheet = periodDetailSheet([row]);
    expect(sheet[0][0]).toBe("Period");
    expect(sheet[1][0]).toBe("Day 1");
    expect(sheet[1][1]).toBe(1);
  });
});
