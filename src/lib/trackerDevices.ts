import type { LastStatusRow } from "./lastStatus";
import { tenantHeaders } from "./tenant";

export type TrackerDeviceGroupRef = { id: string; name: string };

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
  displayParams?: Record<string, string | number | boolean>;
  odometerKm?: number | null;
  fuelLevel?: number | null;
  fuelLiters?: number | null;
  groups?: TrackerDeviceGroupRef[];
};

export type TrackerDeviceGroup = {
  id: string;
  name: string;
  description?: string;
  sortOrder?: number;
  memberCount?: number;
  deviceIds?: string[];
};

export type TelematicsSource = "armada" | "devices" | "both";

/** Stable negative status-row id for a GPS device with no Armada link. */
export function hashDeviceId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  const n = Math.abs(h) % 900_000_000;
  return -(n + 100_000_000);
}

/** Map status-row ids (Armada or synthetic) → tracker device UUID from last fixes. */
export function deviceIdByStatusRowId(fixes: TrackerLastFix[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const fix of fixes) {
    if (!fix.deviceId) continue;
    if (fix.armadaUserId != null && fix.armadaUserId > 0) {
      map.set(fix.armadaUserId, fix.deviceId);
    } else {
      map.set(hashDeviceId(fix.deviceId), fix.deviceId);
    }
  }
  return map;
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
    fuelLevel: fix.fuelLevel ?? null,
    odometerKm: fix.odometerKm ?? null,
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
          fuelLevel: deviceRow.fuelLevel ?? existing.fuelLevel,
          odometerKm: deviceRow.odometerKm ?? existing.odometerKm,
        });
      }
    } else {
      byId.set(deviceRow.id, deviceRow);
    }
  }
  return [...byId.values()];
}

export async function fetchTrackerLastStatus(
  signal?: AbortSignal,
  opts?: { groupIds?: string[] },
): Promise<{
  fixes: TrackerLastFix[];
  telematicsSource: TelematicsSource;
  displayPinIds: string[];
  displayPinLabels: Record<string, string>;
}> {
  const q = new URLSearchParams();
  for (const id of opts?.groupIds || []) {
    if (id) q.append("groupId", id);
  }
  const qs = q.toString();
  const res = await fetch(`/api/tracker/last-status${qs ? `?${qs}` : ""}`, {
    credentials: "include",
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as {
    fixes?: TrackerLastFix[];
    telematicsSource?: TelematicsSource;
    displayPinIds?: string[];
    displayPinLabels?: Record<string, string>;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Tracker status ${res.status}`);
  const labels =
    data.displayPinLabels && typeof data.displayPinLabels === "object" && !Array.isArray(data.displayPinLabels)
      ? Object.fromEntries(
          Object.entries(data.displayPinLabels).map(([k, v]) => [k, String(v)]),
        )
      : {};
  return {
    fixes: data.fixes || [],
    telematicsSource: data.telematicsSource || "both",
    displayPinIds: Array.isArray(data.displayPinIds) ? data.displayPinIds.map(String) : [],
    displayPinLabels: labels,
  };
}

let telematicsSourceCache: Promise<TelematicsSource> | null = null;

/** Tenant telematics source (cached per page load). */
export function fetchTelematicsSource(signal?: AbortSignal): Promise<TelematicsSource> {
  if (!telematicsSourceCache) {
    telematicsSourceCache = fetchTrackerLastStatus(signal)
      .then((s) => s.telematicsSource || "both")
      .catch(() => "both" as TelematicsSource);
  }
  return telematicsSourceCache;
}

export async function fetchTrackerDeviceGroups(
  signal?: AbortSignal,
  opts?: { members?: boolean },
): Promise<TrackerDeviceGroup[]> {
  const params = new URLSearchParams();
  if (opts?.members) params.set("members", "1");
  const q = params.toString();
  const res = await fetch(`/api/tracker/device-groups${q ? `?${q}` : ""}`, {
    credentials: "include",
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as {
    groups?: TrackerDeviceGroup[];
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Tracker groups ${res.status}`);
  return data.groups || [];
}

export type DeviceGroupScope = {
  groupIds: string[];
  deviceIds: string[];
  armadaUserIds: number[];
  memberCount: number;
  linkedArmadaCount: number;
};

/** Resolve device group membership to device UUIDs + linked Armada user ids (DB, not last-fix). */
export async function fetchDeviceGroupScope(
  groupIds: string[],
  signal?: AbortSignal,
): Promise<DeviceGroupScope> {
  const q = new URLSearchParams();
  for (const id of groupIds) {
    if (id) q.append("groupId", id);
  }
  const res = await fetch(`/api/tracker/device-group-scope?${q}`, {
    credentials: "include",
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as Partial<DeviceGroupScope> & {
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Device group scope ${res.status}`);
  return {
    groupIds: Array.isArray(data.groupIds) ? data.groupIds : groupIds,
    deviceIds: Array.isArray(data.deviceIds) ? data.deviceIds : [],
    armadaUserIds: Array.isArray(data.armadaUserIds)
      ? data.armadaUserIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)
      : [],
    memberCount: Number(data.memberCount) || 0,
    linkedArmadaCount: Number(data.linkedArmadaCount) || 0,
  };
}

export type TrackerDayPoint = {
  lat: number;
  lon: number;
  speed: number | null;
  heading: number | null;
  ignition: boolean | null;
  odometerKm: number | null;
  recordedAt: string;
  sourceProtocol?: string;
};

export type TrackerDeviceDay = {
  deviceId: string;
  date: string;
  tzOffset?: string;
  label?: string;
  imei?: string;
  points: TrackerDayPoint[];
  telematicsSource?: TelematicsSource;
};

export async function fetchTrackerDeviceDay(
  opts: { deviceId: string; date: string; tzOffset?: string },
  signal?: AbortSignal,
): Promise<TrackerDeviceDay> {
  const q = new URLSearchParams({
    deviceId: opts.deviceId,
    date: opts.date,
  });
  if (opts.tzOffset) q.set("tz", opts.tzOffset);
  const res = await fetch(`/api/tracker/device-day?${q}`, {
    credentials: "include",
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as TrackerDeviceDay & { error?: string };
  if (!res.ok) throw new Error(data.error || `Device day ${res.status}`);
  return {
    deviceId: data.deviceId || opts.deviceId,
    date: data.date || opts.date,
    tzOffset: data.tzOffset,
    label: data.label,
    imei: data.imei,
    points: Array.isArray(data.points) ? data.points : [],
    telematicsSource: data.telematicsSource,
  };
}
