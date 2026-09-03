import type { TrackPoint, Trip } from "./types";

export type DayTrackRow = {
  trackInfoId: number;
  point: TrackPoint;
};

function asUtc(raw: Record<string, unknown>): string {
  const value = raw.utc ?? raw.uTC ?? raw.UTC ?? raw.serverUtc;
  return typeof value === "string" && value.trim() ? value : "";
}

function asVariables(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  if (Array.isArray(raw)) {
    const out: Record<string, unknown> = {};
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const name = typeof row.name === "string" ? row.name : "";
      if (name) out[name] = row.value;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return raw as Record<string, unknown>;
}

function asPosition(raw: unknown): TrackPoint["position"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const pos = raw as Record<string, unknown>;
  return {
    latitude: pos.latitude as number | string | undefined,
    longitude: pos.longitude as number | string | undefined,
    altitude: pos.altitude as number | string | undefined,
  };
}

/** Same TrackPoint shape the metrics pipeline already reads (`utc`, `position`, `variables`). */
export function normalizeTrackPoint(raw: unknown): DayTrackRow | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const utc = asUtc(item);
  if (!utc) return null;
  const trackInfoId = Number(item.trackInfoId ?? item.trackinfoid ?? 0);
  return {
    trackInfoId: Number.isInteger(trackInfoId) && trackInfoId > 0 ? trackInfoId : 0,
    point: {
      utc,
      position: asPosition(item.position),
      variables: asVariables(item.variables),
    },
  };
}

export function normalizeTrackList(raw: unknown): DayTrackRow[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown[] }).items)
    ? ((raw as { items: unknown[] }).items)
    : [];
  const out: DayTrackRow[] = [];
  for (const item of list) {
    const row = normalizeTrackPoint(item);
    if (row) out.push(row);
  }
  return out;
}

/**
 * Rebuild GpsGate recordings so tripCount / map still see one Trip per trackInfoId.
 * Points without an id are grouped by UTC calendar day.
 */
export function groupRowsIntoTrips(userId: number, rows: DayTrackRow[]): Trip[] {
  const buckets = new Map<number, TrackPoint[]>();
  for (const row of rows) {
    const key =
      row.trackInfoId > 0
        ? row.trackInfoId
        : -Number((row.point.utc ?? "").slice(0, 10).replace(/-/g, "") || "0");
    if (key === 0) continue;
    const list = buckets.get(key);
    if (list) list.push(row.point);
    else buckets.set(key, [row.point]);
  }

  const trips: Trip[] = [];
  for (const [trackInfoId, tracks] of buckets) {
    tracks.sort((a, b) => Date.parse(a.utc ?? "") - Date.parse(b.utc ?? ""));
    const seen = new Set<string>();
    const unique = tracks.filter((point) => {
      const stamp = point.utc ?? "";
      if (!stamp || seen.has(stamp)) return false;
      seen.add(stamp);
      return true;
    });
    if (unique.length === 0) continue;
    const first = unique[0]?.utc;
    trips.push({
      trackInfoId: Math.abs(trackInfoId),
      userId,
      created: first ? new Date(first) : null,
      tracks: unique,
    });
  }
  trips.sort((a, b) => (a.created?.getTime() ?? 0) - (b.created?.getTime() ?? 0));
  return trips;
}

/** Date-major order so the first batch paints every vehicle instead of one truck's whole month. */
export function interleaveUserDays<T>(
  userIds: number[],
  dates: string[],
  make: (userId: number, date: string) => T,
): T[] {
  const out: T[] = [];
  for (const date of dates) {
    for (const userId of userIds) {
      out.push(make(userId, date));
    }
  }
  return out;
}

export function describeLoadProgress(
  progress: { phase: string; loaded: number; total: number; skipped?: number },
  fleetVehicleCount?: number,
): string {
  const skipped = progress.skipped ? ` · ${progress.skipped} skipped` : "";
  if (progress.phase === "trips") {
    return `Finding trips · window ${Math.max(1, progress.loaded)} of ${progress.total}`;
  }
  if (progress.phase === "days") {
    if (fleetVehicleCount && fleetVehicleCount > 1) {
      return `Loading ${progress.loaded} of ${progress.total} vehicle-days across ${fleetVehicleCount} vehicles${skipped}`;
    }
    return `Loading ${progress.loaded} of ${progress.total} vehicle-days${skipped}`;
  }
  const fleet = fleetVehicleCount && fleetVehicleCount > 1 ? ` across ${fleetVehicleCount} vehicles` : "";
  return `Loading tracks ${progress.loaded} of ${progress.total}${fleet}${skipped}`;
}
