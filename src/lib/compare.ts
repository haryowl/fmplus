import type { PeriodMetrics } from "./types";

export type Prefer = "higher" | "lower" | "none";

export type CompareMetric = {
  id: string;
  label: string;
  a: number;
  b: number;
  pct: number | null;
  prefer: Prefer;
};

/** Percent change from baseline `from` to `to`. Null when baseline is 0 and `to` is not. */
export function pctChange(from: number, to: number): number | null {
  if (from === 0) return to === 0 ? 0 : null;
  return ((to - from) / from) * 100;
}

export type CompareSnapshot = {
  gpsDistanceKm: number;
  ignitionDistanceKm: number;
  activeHours: number;
  idleHours: number;
  avgSpeedKmh: number;
  avgRpm: number;
  fuelUsedL: number;
  canFuelUsedL: number;
  tankFuelUsedL: number;
  refillL: number;
  kmPerL: number;
  flatKmPerL: number;
  elevationGainM: number;
  elevationLossM: number;
  roadBumpyPct: number;
  fuelCost: number;
};

export function compareSnapshots(baseline: CompareSnapshot, compare: CompareSnapshot): CompareMetric[] {
  const pair = (
    id: string,
    label: string,
    a: number,
    b: number,
    prefer: Prefer,
  ): CompareMetric => ({
    id,
    label,
    a,
    b,
    pct: pctChange(a, b),
    prefer,
  });

  return [
    pair("gps", "GPS distance", baseline.gpsDistanceKm, compare.gpsDistanceKm, "none"),
    pair("ign", "Ignition distance", baseline.ignitionDistanceKm, compare.ignitionDistanceKm, "none"),
    pair("active", "Active hours", baseline.activeHours, compare.activeHours, "none"),
    pair("idle", "Idle hours", baseline.idleHours, compare.idleHours, "lower"),
    pair("speed", "Avg speed", baseline.avgSpeedKmh, compare.avgSpeedKmh, "none"),
    pair("rpm", "Avg RPM", baseline.avgRpm, compare.avgRpm, "none"),
    pair("fuel", "Fuel used", baseline.fuelUsedL, compare.fuelUsedL, "lower"),
    pair("can", "CAN used", baseline.canFuelUsedL, compare.canFuelUsedL, "lower"),
    pair("tank", "Tank used", baseline.tankFuelUsedL, compare.tankFuelUsedL, "lower"),
    pair("refill", "Refill", baseline.refillL, compare.refillL, "none"),
    pair("kml", "Efficiency", baseline.kmPerL, compare.kmPerL, "higher"),
    pair("flatkml", "Flat-terrain km/l", baseline.flatKmPerL, compare.flatKmPerL, "higher"),
    pair("gain", "Elevation gain", baseline.elevationGainM, compare.elevationGainM, "none"),
    pair("loss", "Elevation loss", baseline.elevationLossM, compare.elevationLossM, "none"),
    pair("bumpy", "Bumpy road", baseline.roadBumpyPct, compare.roadBumpyPct, "lower"),
    pair("cost", "Fuel cost", baseline.fuelCost, compare.fuelCost, "lower"),
  ];
}

export function comparePeriods(baseline: PeriodMetrics, compare: PeriodMetrics): CompareMetric[] {
  return compareSnapshots(baseline, compare);
}

export function deltaTone(metric: CompareMetric): "good" | "bad" | "neutral" {
  if (metric.pct === null || metric.pct === 0 || metric.prefer === "none") return "neutral";
  const up = metric.pct > 0;
  if (metric.prefer === "higher") return up ? "good" : "bad";
  return up ? "bad" : "good";
}
