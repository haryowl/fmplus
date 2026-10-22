import { dbQuery } from "./db.mjs";

const EARTH_RADIUS_KM = 6371;
const MIN_GPS_JUMP_KM = 1.5;
const MAX_GPS_IMPLIED_SPEED_KMH = 180;
const NULL_ISLAND_DEG = 0.01;

export function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isNullIsland(lat, lon) {
  return Math.abs(lat) < NULL_ISLAND_DEG && Math.abs(lon) < NULL_ISLAND_DEG;
}

export function isImpossibleGpsStep(prev, next) {
  const d = haversineKm(prev.lat, prev.lon, next.lat, next.lon);
  if (!Number.isFinite(d) || d < MIN_GPS_JUMP_KM) return false;
  const dtMs = next.ms - prev.ms;
  if (dtMs <= 0) return true;
  const kmh = d / (dtMs / 3_600_000);
  return kmh > MAX_GPS_IMPLIED_SPEED_KMH;
}

/** Jump-filtered haversine between consecutive valid GNSS fixes, or 0. */
export function gpsStepKm(prev, next) {
  if (!prev || !next) return 0;
  const plat = Number(prev.lat);
  const plon = Number(prev.lon);
  const nlat = Number(next.lat);
  const nlon = Number(next.lon);
  if (![plat, plon, nlat, nlon].every(Number.isFinite)) return 0;
  if (isNullIsland(plat, plon) || isNullIsland(nlat, nlon)) return 0;
  const prevMs = prev.ms ?? Date.parse(prev.recordedAt || prev.recorded_at || 0);
  const nextMs = next.ms ?? Date.parse(next.recordedAt || next.recorded_at || 0);
  if (!Number.isFinite(prevMs) || !Number.isFinite(nextMs)) return 0;
  if (
    isImpossibleGpsStep(
      { lat: plat, lon: plon, ms: prevMs },
      { lat: nlat, lon: nlon, ms: nextMs },
    )
  ) {
    return 0;
  }
  const d = haversineKm(plat, plon, nlat, nlon);
  return Number.isFinite(d) && d > 0 ? d : 0;
}

/** Sum jump-filtered GNSS steps. Points should already be time-ordered. */
export function sumGpsTrackKm(points) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += gpsStepKm(points[i - 1], points[i]);
  }
  return total;
}

/**
 * Hardware odo when present and positive; otherwise virtual GPS km.
 * @param {unknown} rowOdometer
 * @param {unknown} gpsOdometerKm
 * @param {Record<string, unknown>|null|undefined} mapped
 */
export function resolveOdometerKm(rowOdometer, gpsOdometerKm, mapped) {
  const mappedOdo = Number(mapped?.odometer_km);
  let device = rowOdometer == null || rowOdometer === "" ? null : Number(rowOdometer);
  if (!Number.isFinite(device) || device <= 0) {
    device = Number.isFinite(mappedOdo) && mappedOdo > 0 ? mappedOdo : null;
  }
  if (Number.isFinite(device) && device > 0) {
    return { odometerKm: device, odometerSource: "device" };
  }
  const gps = gpsOdometerKm == null || gpsOdometerKm === "" ? null : Number(gpsOdometerKm);
  if (Number.isFinite(gps)) {
    return { odometerKm: gps, odometerSource: "gps" };
  }
  return { odometerKm: null, odometerSource: null };
}

function uuidList(deviceIds) {
  return [
    ...new Set(
      (deviceIds || [])
        .map((id) => String(id || "").trim())
        .filter((id) => /^[0-9a-f-]{36}$/i.test(id)),
    ),
  ];
}

/**
 * One-shot fill of gps_odometer_km from retained vehicle_fixes.
 * @param {string[]} deviceIds
 * @returns {Promise<Map<string, number>>}
 */
export async function ensureGpsOdometerKm(deviceIds) {
  const ids = uuidList(deviceIds);
  /** @type {Map<string, number>} */
  const out = new Map();
  if (!ids.length) return out;
  let need;
  try {
    need = await dbQuery(
      `SELECT id::text AS id
       FROM tracker_devices
       WHERE id = ANY($1::uuid[]) AND gps_odometer_km IS NULL`,
      [ids],
    );
  } catch {
    return out;
  }
  const needIds = need.rows.map((r) => String(r.id));
  if (!needIds.length) return out;

  const pts = await dbQuery(
    `SELECT device_id::text AS device_id, lat, lon, recorded_at
     FROM vehicle_fixes
     WHERE device_id = ANY($1::uuid[])
       AND lat IS NOT NULL AND lon IS NOT NULL
       AND ABS(lat) >= 0.01 AND ABS(lon) >= 0.01
     ORDER BY device_id, recorded_at ASC`,
    [needIds],
  );
  /** @type {Map<string, Array<{ lat: number, lon: number, recordedAt: unknown }>>} */
  const byDevice = new Map();
  for (const r of pts.rows) {
    const id = String(r.device_id);
    const list = byDevice.get(id) || [];
    list.push({ lat: Number(r.lat), lon: Number(r.lon), recordedAt: r.recorded_at });
    byDevice.set(id, list);
  }

  for (const id of needIds) {
    const km = sumGpsTrackKm(byDevice.get(id) || []);
    try {
      await dbQuery(
        `UPDATE tracker_devices
         SET gps_odometer_km = $2
         WHERE id = $1::uuid AND gps_odometer_km IS NULL`,
        [id, km],
      );
      out.set(id, km);
    } catch {
      /* column may not exist mid-migrate */
    }
  }
  return out;
}

/**
 * Add a GNSS step when the virtual odo already exists; otherwise backfill history.
 * @param {string} deviceId
 * @param {number} deltaKm
 */
export async function applyGpsOdometerDelta(deviceId, deltaKm) {
  const id = String(deviceId || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  const delta = Number(deltaKm);
  if (Number.isFinite(delta) && delta > 0) {
    try {
      const upd = await dbQuery(
        `UPDATE tracker_devices
         SET gps_odometer_km = gps_odometer_km + $2
         WHERE id = $1::uuid AND gps_odometer_km IS NOT NULL`,
        [id, delta],
      );
      if (upd.rowCount > 0) return;
    } catch {
      return;
    }
  }
  await ensureGpsOdometerKm([id]);
}

/**
 * Fill gps_odometer_km on last-status rows that still have NULL.
 * @param {Array<{ device_id?: unknown, gps_odometer_km?: unknown }>} rows
 */
export async function hydrateGpsOdometer(rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  const missing = rows
    .filter((r) => r && (r.gps_odometer_km == null || r.gps_odometer_km === ""))
    .map((r) => r.device_id);
  if (!missing.length) return;
  const filled = await ensureGpsOdometerKm(missing);
  if (!filled.size) return;
  for (const r of rows) {
    if (!r || r.gps_odometer_km != null) continue;
    const km = filled.get(String(r.device_id));
    if (km != null) r.gps_odometer_km = km;
  }
}
