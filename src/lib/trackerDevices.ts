import type { LastStatusRow } from "./lastStatus";
import { tenantHeaders } from "./tenant";

export type TrackerLastFix = {
  deviceId: string;
  imei: string;
  label: string;
  armadaUserId: number | null;
  protocol: string;
  lat: number;
  lon: number;
  recordedAt: string | null;
  ageSec: number | null;
  speed: number | null;
  heading: number | null;
  ignition: boolean | null;
  sourceProtocol: string;
};

export type TelematicsSource = "armada" | "devices" | "both";

function hashDeviceId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  const n = Math.abs(h) % 900_000_000;
  return -(n + 100_000_000);
}

/** Map a device last-fix into the Live Ops / Last Status row shape. */
export function trackerFixToStatusRow(fix: TrackerLastFix): LastStatusRow {
  const id = fix.armadaUserId != null && fix.armadaUserId > 0 ? fix.armadaUserId : hashDeviceId(fix.deviceId);
  const lastMs = fix.recordedAt ? Date.parse(fix.recordedAt) : null;
  return {
    id,
    name: fix.label || fix.imei,
    username: fix.imei,
    utc: fix.recordedAt || "",
    deviceActivity: fix.recordedAt || "",
    lastMs: Number.isFinite(lastMs) ? lastMs : null,
    lat: fix.lat,
    lon: fix.lon,
    altitude: null,
    heading: fix.heading,
    speedKmh: fix.speed,
    ignition: fix.ignition,
    fuelLevel: null,
    odometerKm: null,
  };
}

/**
 * Merge Armada usersstatus rows with direct-device last fixes.
 * Fresher device overlay wins on matching armadaUserId; orphan devices are appended.
 */
export function mergeArmadaRowsWithDeviceFixes(
  armadaRows: LastStatusRow[],
  fixes: TrackerLastFix[],
  telematicsSource: TelematicsSource = "both",
): LastStatusRow[] {
  const useArmada = telematicsSource === "armada" || telematicsSource === "both";
  const useDevices = telematicsSource === "devices" || telematicsSource === "both";
  if (!useDevices) return useArmada ? armadaRows : [];
  if (!useArmada) return fixes.map(trackerFixToStatusRow);

  const byId = new Map<number, LastStatusRow>();
  for (const row of armadaRows) byId.set(row.id, row);

  for (const fix of fixes) {
    const deviceRow = trackerFixToStatusRow(fix);
    if (fix.armadaUserId != null && fix.armadaUserId > 0) {
      const existing = byId.get(fix.armadaUserId);
      if (!existing) {
        byId.set(fix.armadaUserId, deviceRow);
        continue;
      }
      const deviceMs = deviceRow.lastMs;
      const armadaMs = existing.lastMs;
      const deviceFresher =
        deviceMs != null && (armadaMs == null || deviceMs >= armadaMs);
      if (deviceFresher) {
        byId.set(fix.armadaUserId, {
          ...existing,
          lat: deviceRow.lat,
          lon: deviceRow.lon,
          utc: deviceRow.utc || existing.utc,
          deviceActivity: deviceRow.deviceActivity || existing.deviceActivity,
          lastMs: deviceRow.lastMs ?? existing.lastMs,
          speedKmh: deviceRow.speedKmh ?? existing.speedKmh,
          heading: deviceRow.heading ?? existing.heading,
          ignition: deviceRow.ignition ?? existing.ignition,
        });
      }
    } else {
      byId.set(deviceRow.id, deviceRow);
    }
  }
  return [...byId.values()];
}

export async function fetchTrackerLastStatus(signal?: AbortSignal): Promise<{
  fixes: TrackerLastFix[];
  telematicsSource: TelematicsSource;
}> {
  const res = await fetch("/api/tracker/last-status", {
    credentials: "include",
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as {
    fixes?: TrackerLastFix[];
    telematicsSource?: TelematicsSource;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Tracker status ${res.status}`);
  return {
    fixes: data.fixes || [],
    telematicsSource: data.telematicsSource || "both",
  };
}
