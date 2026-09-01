import type { BehaviorSummary } from "./behavior";
import type { CompareSnapshot, Prefer } from "./compare";
import { FLEET_VEHICLE_CAP } from "./config";
import { formatHours, formatKm, formatKmPerL, formatPct } from "./format";
import type { InsightBlock } from "./insight";
import type { MetricsTotals } from "./metrics";
import type { PeriodMetrics } from "./types";

export const FLEET_COLORS = [
  "#0b6b62",
  "#3b4cb3",
  "#9a3b12",
  "#c47d3a",
  "#6b3d7a",
  "#2a6f9a",
  "#7a5a12",
  "#4e6b3d",
];

export { FLEET_VEHICLE_CAP };

export type FleetVehicleRow = {
  userId: number;
  label: string;
  color: string;
  rows: PeriodMetrics[];
  totals: MetricsTotals;
  behavior: BehaviorSummary | null;
  hasData: boolean;
};

export function fleetColor(index: number): string {
  return FLEET_COLORS[index % FLEET_COLORS.length];
}

export function totalsToCompare(totals: MetricsTotals): CompareSnapshot {
  return {
    gpsDistanceKm: totals.gps,
    ignitionDistanceKm: totals.ignition,
    activeHours: totals.hours,
    idleHours: totals.idle,
    avgSpeedKmh: totals.avgSpeed,
    avgRpm: totals.avgRpm,
    fuelUsedL: totals.fuel,
    canFuelUsedL: totals.canFuel,
    tankFuelUsedL: totals.tankFuel,
    refillL: totals.refill,
    kmPerL: totals.fuel > 0 ? totals.gps / totals.fuel : 0,
    flatKmPerL: totals.flatKmPerL,
    elevationGainM: totals.elevationGainM,
    elevationLossM: totals.elevationLossM,
    roadBumpyPct: totals.roadBumpyPct,
    fuelCost: totals.cost,
  };
}

export function columnTones(values: number[], prefer: Prefer): Array<"best" | "worst" | ""> {
  if (prefer === "none" || values.length < 2) return values.map(() => "");
  const finite = values.filter((n) => Number.isFinite(n));
  if (finite.length < 2) return values.map(() => "");
  const best = prefer === "higher" ? Math.max(...finite) : Math.min(...finite);
  const worst = prefer === "higher" ? Math.min(...finite) : Math.max(...finite);
  if (best === worst) return values.map(() => "");
  return values.map((v) => {
    if (v === best) return "best";
    if (v === worst) return "worst";
    return "";
  });
}

export type RankColumnId =
  | "gps"
  | "hours"
  | "idleShare"
  | "kmPerL"
  | "cost"
  | "safety"
  | "events"
  | "bumpy";

export type RankColumn = {
  id: RankColumnId;
  label: string;
  prefer: Prefer;
  value: (row: FleetVehicleRow) => number;
};

export const RANK_COLUMNS: RankColumn[] = [
  { id: "gps", label: "GPS km", prefer: "none", value: (row) => row.totals.gps },
  { id: "hours", label: "Active h", prefer: "none", value: (row) => row.totals.hours },
  {
    id: "idleShare",
    label: "Idle share",
    prefer: "lower",
    value: (row) => {
      const engine = row.totals.hours + row.totals.idle;
      return engine > 0 ? (row.totals.idle / engine) * 100 : 0;
    },
  },
  {
    id: "kmPerL",
    label: "km/l",
    prefer: "higher",
    value: (row) => (row.totals.fuel > 0 ? row.totals.gps / row.totals.fuel : 0),
  },
  { id: "cost", label: "Cost", prefer: "lower", value: (row) => row.totals.cost },
  { id: "safety", label: "Safety", prefer: "higher", value: (row) => row.behavior?.safetyScore ?? 0 },
  {
    id: "events",
    label: "Events / 100 km",
    prefer: "lower",
    value: (row) => row.behavior?.eventsPer100km ?? 0,
  },
  { id: "bumpy", label: "Bumpy %", prefer: "lower", value: (row) => row.totals.roadBumpyPct },
];

export function sortFleetRows(
  rows: FleetVehicleRow[],
  columnId: RankColumnId,
  dir: "asc" | "desc",
): FleetVehicleRow[] {
  const col = RANK_COLUMNS.find((c) => c.id === columnId) ?? RANK_COLUMNS[0];
  const copy = [...rows];
  copy.sort((a, b) => {
    const av = col.value(a);
    const bv = col.value(b);
    if (av === bv) return a.label.localeCompare(b.label);
    return dir === "asc" ? av - bv : bv - av;
  });
  return copy;
}

export function alignedPeriodKeys(vehicles: FleetVehicleRow[]): { key: string; label: string }[] {
  const seen = new Set<string>();
  const out: { key: string; label: string }[] = [];
  for (const vehicle of vehicles) {
    for (const row of vehicle.rows) {
      if (seen.has(row.key)) continue;
      seen.add(row.key);
      out.push({ key: row.key, label: row.label });
    }
  }
  out.sort((a, b) => a.key.localeCompare(b.key));
  return out;
}

export function seriesForPeriod(
  vehicles: FleetVehicleRow[],
  periods: { key: string }[],
  pick: (row: PeriodMetrics) => number,
): number[][] {
  return vehicles.map((vehicle) => {
    const byKey = new Map(vehicle.rows.map((row) => [row.key, row]));
    return periods.map((period) => {
      const row = byKey.get(period.key);
      return row ? pick(row) : 0;
    });
  });
}

export function buildFleetInsights(vehicles: FleetVehicleRow[]): InsightBlock[] {
  const live = vehicles.filter((v) => v.hasData);
  if (live.length === 0) {
    return [
      {
        id: "empty",
        title: "Fleet",
        body: "Load at least one vehicle in this range to compare.",
      },
    ];
  }
  if (live.length === 1) {
    return [
      {
        id: "one",
        title: "Selection",
        body: `${live[0].label} is loaded. Add another vehicle from the group to compare distance, fuel, and safety.`,
      },
    ];
  }

  const kmPerL = (row: FleetVehicleRow) =>
    row.totals.fuel > 0 ? row.totals.gps / row.totals.fuel : 0;
  const idleShare = (row: FleetVehicleRow) => {
    const engine = row.totals.hours + row.totals.idle;
    return engine > 0 ? (row.totals.idle / engine) * 100 : 0;
  };

  const byKm = [...live].sort((a, b) => b.totals.gps - a.totals.gps);
  const byEff = [...live].filter((v) => kmPerL(v) > 0).sort((a, b) => kmPerL(b) - kmPerL(a));
  const byIdle = [...live].sort((a, b) => idleShare(b) - idleShare(a));
  const bySafety = [...live]
    .filter((v) => v.behavior)
    .sort((a, b) => (a.behavior?.safetyScore ?? 0) - (b.behavior?.safetyScore ?? 0));

  const blocks: InsightBlock[] = [
    {
      id: "distance",
      title: "Distance",
      body: `${byKm[0].label} covered the most GPS distance (${formatKm(byKm[0].totals.gps)} km). ${byKm[byKm.length - 1].label} covered the least (${formatKm(byKm[byKm.length - 1].totals.gps)} km).`,
    },
  ];

  if (byEff.length >= 2) {
    const best = byEff[0];
    const worst = byEff[byEff.length - 1];
    const gap = kmPerL(worst) > 0 ? ((kmPerL(best) - kmPerL(worst)) / kmPerL(worst)) * 100 : 0;
    blocks.push({
      id: "fuel",
      title: "Fuel efficiency",
      body: `${best.label} leads at ${formatKmPerL(kmPerL(best))} km/l. ${worst.label} is lowest at ${formatKmPerL(kmPerL(worst))} km/l${gap > 0 ? ` (${formatPct(gap)} behind the leader)` : ""}.`,
    });
  }

  if (byIdle.length >= 2 && idleShare(byIdle[0]) > 0) {
    blocks.push({
      id: "idle",
      title: "Idle",
      body: `${byIdle[0].label} spends the largest share of engine-on time idle (${formatPct(idleShare(byIdle[0]))}, ${formatHours(byIdle[0].totals.idle)} h). ${byIdle[byIdle.length - 1].label} is lowest at ${formatPct(idleShare(byIdle[byIdle.length - 1]))}.`,
    });
  }

  if (bySafety.length >= 2) {
    const worst = bySafety[0];
    const best = bySafety[bySafety.length - 1];
    blocks.push({
      id: "safety",
      title: "Driving behavior",
      body: `${best.label} has the best safety score (${best.behavior?.safetyScore.toFixed(0)}/100). ${worst.label} is lowest (${worst.behavior?.safetyScore.toFixed(0)}/100${worst.behavior?.topIssue ? `, most frequent ${worst.behavior.topIssue}` : ""}).`,
    });
  }

  return blocks;
}
