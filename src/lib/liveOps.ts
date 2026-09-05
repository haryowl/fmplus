import type { LastStatusRow } from "./lastStatus";

export const STALE_MS = 15 * 60 * 1000;
export const MOVING_SPEED_KMH = 5;

export type LiveOpsClass = "moving" | "idle" | "off" | "stale" | "noFix";

export const LIVE_OPS_CLASSES: LiveOpsClass[] = ["moving", "idle", "off", "stale", "noFix"];

export const LIVE_OPS_LABELS: Record<LiveOpsClass, string> = {
  moving: "Moving",
  idle: "Idle",
  off: "Off",
  stale: "Stale",
  noFix: "No fix",
};

export const LIVE_OPS_COLORS: Record<LiveOpsClass, string> = {
  moving: "#0b6b62",
  idle: "#c47a1a",
  off: "#6a6358",
  stale: "#9f2a2a",
  noFix: "#8a8378",
};

export function defaultLiveFilters(): Record<LiveOpsClass, boolean> {
  return {
    moving: true,
    idle: true,
    off: true,
    stale: true,
    noFix: true,
  };
}

/** Single primary class — first match wins (noFix → stale → moving → idle/off). */
export function classifyLiveRow(row: LastStatusRow, now = Date.now()): LiveOpsClass {
  if (row.lat === null || row.lon === null) return "noFix";
  if (row.lastMs === null || now - row.lastMs > STALE_MS) return "stale";
  const speed = row.speedKmh;
  if (typeof speed === "number" && Number.isFinite(speed) && speed >= MOVING_SPEED_KMH) {
    return "moving";
  }
  if (row.ignition === false) return "off";
  return "idle";
}

export function filterLiveRows(
  rows: LastStatusRow[],
  enabled: Record<LiveOpsClass, boolean>,
  now = Date.now(),
): LastStatusRow[] {
  return rows.filter((row) => enabled[classifyLiveRow(row, now)] === true);
}

export function countLiveByClass(
  rows: LastStatusRow[],
  now = Date.now(),
): Record<LiveOpsClass, number> {
  const counts: Record<LiveOpsClass, number> = {
    moving: 0,
    idle: 0,
    off: 0,
    stale: 0,
    noFix: 0,
  };
  for (const row of rows) {
    counts[classifyLiveRow(row, now)] += 1;
  }
  return counts;
}
