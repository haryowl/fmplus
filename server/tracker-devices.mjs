/**
 * Tracker device registry + normalized vehicle fix ingest.
 * Shared by Admin CRUD, HTTP/JSON ingest, and the Go gateway (same tables).
 */
import crypto from "node:crypto";
import { dbQuery } from "./db.mjs";

export const TRACKER_PROTOCOLS = [
  "json",
  "teltonika",
  "jt808",
  "concox",
  "ruptela",
  "galileosky",
  "video",
  "other",
];

export const TELEMATICS_SOURCES = ["armada", "devices", "both"];

export function normalizeTelematicsSource(v) {
  const s = String(v || "both")
    .trim()
    .toLowerCase();
  return TELEMATICS_SOURCES.includes(s) ? s : "both";
}

export function telematicsUsesArmada(source) {
  const s = normalizeTelematicsSource(source);
  return s === "armada" || s === "both";
}

export function telematicsUsesDevices(source) {
  const s = normalizeTelematicsSource(source);
  return s === "devices" || s === "both";
}

export function normalizeProtocol(v) {
  const s = String(v || "json")
    .trim()
    .toLowerCase();
  return TRACKER_PROTOCOLS.includes(s) ? s : "other";
}

export function normalizeImei(v) {
  return String(v || "")
    .trim()
    .replace(/\s+/g, "")
    .slice(0, 32);
}

export function hashDeviceToken(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

export function generateDeviceToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function cleanCoord(lat, lon) {
  const a = Number(lat);
  const b = Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  if (a === 0 && b === 0) return null;
  return { lat: a, lon: b };
}

export function publicTrackerDevice(row, { includeTokenHint = false } = {}) {
  if (!row) return null;
  const out = {
    id: row.id,
    tenantId: row.tenant_id,
    imei: row.imei,
    uniqueId: row.unique_id || "",
    protocol: row.protocol,
    label: row.label || "",
    armadaUserId: row.armada_user_id == null ? null : Number(row.armada_user_id),
    enabled: row.enabled !== false,
    hasAuthToken: Boolean(row.auth_token_hash),
    lastSeenAt: row.last_seen_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
  if (includeTokenHint && row._plainToken) out.authToken = row._plainToken;
  if (row.last_lat != null && row.last_lon != null) {
    out.lastFix = {
      lat: Number(row.last_lat),
      lon: Number(row.last_lon),
      recordedAt: row.last_recorded_at || null,
      speed: row.last_speed == null ? null : Number(row.last_speed),
      sourceProtocol: row.last_source_protocol || row.protocol,
    };
  }
  return out;
}

export async function listTrackerDevices(tenantId) {
  const rows = await dbQuery(
    `SELECT d.*,
            lf.lat AS last_lat, lf.lon AS last_lon, lf.recorded_at AS last_recorded_at,
            lf.speed AS last_speed, lf.source_protocol AS last_source_protocol
     FROM tracker_devices d
     LEFT JOIN vehicle_last_fix lf ON lf.device_id = d.id
     WHERE d.tenant_id = $1
     ORDER BY lower(COALESCE(NULLIF(d.label, ''), d.imei)) ASC`,
    [tenantId],
  );
  return rows.rows.map((r) => publicTrackerDevice(r));
}

export async function getTrackerDevice(tenantId, deviceId) {
  const rows = await dbQuery(
    `SELECT d.*,
            lf.lat AS last_lat, lf.lon AS last_lon, lf.recorded_at AS last_recorded_at,
            lf.speed AS last_speed, lf.source_protocol AS last_source_protocol
     FROM tracker_devices d
     LEFT JOIN vehicle_last_fix lf ON lf.device_id = d.id
     WHERE d.tenant_id = $1 AND d.id = $2`,
    [tenantId, deviceId],
  );
  return publicTrackerDevice(rows.rows[0] || null);
}

export async function createTrackerDevice(tenantId, body) {
  const imei = normalizeImei(body.imei);
  if (imei.length < 5) {
    const err = new Error("IMEI / unique id is required (min 5 chars)");
    err.status = 400;
    throw err;
  }
  const protocol = normalizeProtocol(body.protocol);
  const label = String(body.label || "").trim().slice(0, 120);
  const uniqueId = String(body.uniqueId || body.unique_id || "").trim().slice(0, 64) || null;
  let armadaUserId = null;
  if (body.armadaUserId != null && body.armadaUserId !== "") {
    const n = Number(body.armadaUserId);
    if (!Number.isInteger(n) || n < 1) {
      const err = new Error("Invalid armadaUserId");
      err.status = 400;
      throw err;
    }
    armadaUserId = n;
  }
  const plainToken = body.authToken != null && String(body.authToken).trim()
    ? String(body.authToken).trim()
    : generateDeviceToken();
  const tokenHash = hashDeviceToken(plainToken);
  const inserted = await dbQuery(
    `INSERT INTO tracker_devices (
       tenant_id, imei, unique_id, protocol, label, armada_user_id, auth_token_hash, enabled
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      tenantId,
      imei,
      uniqueId,
      protocol,
      label,
      armadaUserId,
      tokenHash,
      body.enabled !== false,
    ],
  );
  const row = inserted.rows[0];
  row._plainToken = plainToken;
  return publicTrackerDevice(row, { includeTokenHint: true });
}

export async function updateTrackerDevice(tenantId, deviceId, body) {
  const found = await dbQuery(
    `SELECT * FROM tracker_devices WHERE tenant_id = $1 AND id = $2`,
    [tenantId, deviceId],
  );
  const current = found.rows[0];
  if (!current) {
    const err = new Error("Device not found");
    err.status = 404;
    throw err;
  }
  const imei = body.imei !== undefined ? normalizeImei(body.imei) : current.imei;
  if (imei.length < 5) {
    const err = new Error("IMEI / unique id is required (min 5 chars)");
    err.status = 400;
    throw err;
  }
  const protocol = body.protocol !== undefined ? normalizeProtocol(body.protocol) : current.protocol;
  const label =
    body.label !== undefined ? String(body.label || "").trim().slice(0, 120) : current.label;
  const uniqueId =
    body.uniqueId !== undefined || body.unique_id !== undefined
      ? String(body.uniqueId || body.unique_id || "").trim().slice(0, 64) || null
      : current.unique_id;
  let armadaUserId = current.armada_user_id;
  if (body.armadaUserId !== undefined) {
    if (body.armadaUserId == null || body.armadaUserId === "") armadaUserId = null;
    else {
      const n = Number(body.armadaUserId);
      if (!Number.isInteger(n) || n < 1) {
        const err = new Error("Invalid armadaUserId");
        err.status = 400;
        throw err;
      }
      armadaUserId = n;
    }
  }
  let tokenHash = current.auth_token_hash;
  let plainToken = null;
  if (body.rotateAuthToken === true) {
    plainToken = generateDeviceToken();
    tokenHash = hashDeviceToken(plainToken);
  } else if (body.authToken !== undefined && String(body.authToken).trim()) {
    plainToken = String(body.authToken).trim();
    tokenHash = hashDeviceToken(plainToken);
  }
  const enabled = body.enabled !== undefined ? body.enabled !== false : current.enabled !== false;
  const updated = await dbQuery(
    `UPDATE tracker_devices SET
       imei = $3, unique_id = $4, protocol = $5, label = $6,
       armada_user_id = $7, auth_token_hash = $8, enabled = $9, updated_at = now()
     WHERE tenant_id = $1 AND id = $2
     RETURNING *`,
    [tenantId, deviceId, imei, uniqueId, protocol, label, armadaUserId, tokenHash, enabled],
  );
  const row = updated.rows[0];
  if (plainToken) row._plainToken = plainToken;
  return publicTrackerDevice(row, { includeTokenHint: Boolean(plainToken) });
}

export async function deleteTrackerDevice(tenantId, deviceId) {
  const deleted = await dbQuery(
    `DELETE FROM tracker_devices WHERE tenant_id = $1 AND id = $2 RETURNING id`,
    [tenantId, deviceId],
  );
  if (!deleted.rows[0]) {
    const err = new Error("Device not found");
    err.status = 404;
    throw err;
  }
  return true;
}

export async function findDeviceByImei(imei) {
  const id = normalizeImei(imei);
  if (!id) return null;
  const rows = await dbQuery(
    `SELECT d.*, t.telematics_source, t.enabled AS tenant_enabled
     FROM tracker_devices d
     JOIN tenants t ON t.id = d.tenant_id
     WHERE d.imei = $1 AND d.enabled = true AND t.enabled = true
     LIMIT 1`,
    [id],
  );
  return rows.rows[0] || null;
}

export async function findDeviceByAuthToken(token) {
  const hash = hashDeviceToken(token);
  if (!hash) return null;
  const rows = await dbQuery(
    `SELECT d.*, t.telematics_source, t.enabled AS tenant_enabled
     FROM tracker_devices d
     JOIN tenants t ON t.id = d.tenant_id
     WHERE d.auth_token_hash = $1 AND d.enabled = true AND t.enabled = true
     LIMIT 1`,
    [hash],
  );
  return rows.rows[0] || null;
}

/**
 * Persist a normalized fix: append history + upsert last position.
 * @returns {Promise<object>} public last-fix shape
 */
export async function ingestVehicleFix(deviceRow, fix) {
  const coords = cleanCoord(fix.lat, fix.lon);
  if (!coords) {
    const err = new Error("Invalid lat/lon");
    err.status = 400;
    throw err;
  }
  const recordedAt = fix.recordedAt ? new Date(fix.recordedAt) : new Date();
  if (Number.isNaN(recordedAt.getTime())) {
    const err = new Error("Invalid recordedAt");
    err.status = 400;
    throw err;
  }
  const protocol = normalizeProtocol(fix.sourceProtocol || deviceRow.protocol || "json");
  const speed = fix.speed == null || fix.speed === "" ? null : Number(fix.speed);
  const heading = fix.heading == null || fix.heading === "" ? null : Number(fix.heading);
  const odometer = fix.odometer == null || fix.odometer === "" ? null : Number(fix.odometer);
  const altitude = fix.altitude == null || fix.altitude === "" ? null : Number(fix.altitude);
  const satellites =
    fix.satellites == null || fix.satellites === "" ? null : Math.round(Number(fix.satellites));
  const ignition =
    fix.ignition === undefined || fix.ignition === null || fix.ignition === ""
      ? null
      : Boolean(fix.ignition);
  const rawAttrs =
    fix.rawAttrs && typeof fix.rawAttrs === "object" && !Array.isArray(fix.rawAttrs)
      ? fix.rawAttrs
      : {};

  await dbQuery(
    `INSERT INTO vehicle_fixes (
       tenant_id, device_id, recorded_at, lat, lon, speed, heading, ignition,
       odometer, altitude, satellites, raw_attrs, source_protocol
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)`,
    [
      deviceRow.tenant_id,
      deviceRow.id,
      recordedAt.toISOString(),
      coords.lat,
      coords.lon,
      Number.isFinite(speed) ? speed : null,
      Number.isFinite(heading) ? heading : null,
      ignition,
      Number.isFinite(odometer) ? odometer : null,
      Number.isFinite(altitude) ? altitude : null,
      Number.isFinite(satellites) ? satellites : null,
      JSON.stringify(rawAttrs),
      protocol,
    ],
  );

  await dbQuery(
    `INSERT INTO vehicle_last_fix (
       device_id, tenant_id, recorded_at, lat, lon, speed, heading, ignition,
       odometer, altitude, satellites, raw_attrs, source_protocol, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13, now())
     ON CONFLICT (device_id) DO UPDATE SET
       recorded_at = EXCLUDED.recorded_at,
       lat = EXCLUDED.lat,
       lon = EXCLUDED.lon,
       speed = EXCLUDED.speed,
       heading = EXCLUDED.heading,
       ignition = EXCLUDED.ignition,
       odometer = EXCLUDED.odometer,
       altitude = EXCLUDED.altitude,
       satellites = EXCLUDED.satellites,
       raw_attrs = EXCLUDED.raw_attrs,
       source_protocol = EXCLUDED.source_protocol,
       updated_at = now()
     WHERE vehicle_last_fix.recorded_at <= EXCLUDED.recorded_at`,
    [
      deviceRow.id,
      deviceRow.tenant_id,
      recordedAt.toISOString(),
      coords.lat,
      coords.lon,
      Number.isFinite(speed) ? speed : null,
      Number.isFinite(heading) ? heading : null,
      ignition,
      Number.isFinite(odometer) ? odometer : null,
      Number.isFinite(altitude) ? altitude : null,
      Number.isFinite(satellites) ? satellites : null,
      JSON.stringify(rawAttrs),
      protocol,
    ],
  );

  await dbQuery(
    `UPDATE tracker_devices SET last_seen_at = GREATEST(COALESCE(last_seen_at, $3), $3), updated_at = now()
     WHERE id = $1 AND tenant_id = $2`,
    [deviceRow.id, deviceRow.tenant_id, recordedAt.toISOString()],
  );

  return {
    deviceId: deviceRow.id,
    tenantId: deviceRow.tenant_id,
    imei: deviceRow.imei,
    armadaUserId: deviceRow.armada_user_id == null ? null : Number(deviceRow.armada_user_id),
    lat: coords.lat,
    lon: coords.lon,
    recordedAt: recordedAt.toISOString(),
    speed: Number.isFinite(speed) ? speed : null,
    heading: Number.isFinite(heading) ? heading : null,
    ignition,
    sourceProtocol: protocol,
  };
}

/**
 * Latest device fixes keyed by armada_user_id for Dispatch Live merge.
 * @returns {Promise<Map<number, { lat: number, lon: number, recordedAt: string, ageSec: number|null, speed: number|null, deviceId: string, imei: string }>>}
 */
export async function lastFixesByArmadaUserIds(tenantId, armadaUserIds) {
  const ids = [...new Set((armadaUserIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  /** @type {Map<number, object>} */
  const map = new Map();
  if (!ids.length) return map;
  const rows = await dbQuery(
    `SELECT d.armada_user_id, d.id AS device_id, d.imei, d.label,
            lf.lat, lf.lon, lf.recorded_at, lf.speed, lf.source_protocol
     FROM tracker_devices d
     JOIN vehicle_last_fix lf ON lf.device_id = d.id
     WHERE d.tenant_id = $1
       AND d.enabled = true
       AND d.armada_user_id = ANY($2::int[])`,
    [tenantId, ids],
  );
  const now = Date.now();
  for (const r of rows.rows) {
    const uid = Number(r.armada_user_id);
    const recordedAt = r.recorded_at ? new Date(r.recorded_at).toISOString() : null;
    const ageSec =
      recordedAt && !Number.isNaN(Date.parse(recordedAt))
        ? Math.max(0, Math.round((now - Date.parse(recordedAt)) / 1000))
        : null;
    const prev = map.get(uid);
    if (prev && prev.ageSec != null && ageSec != null && prev.ageSec <= ageSec) continue;
    map.set(uid, {
      lat: Number(r.lat),
      lon: Number(r.lon),
      recordedAt,
      ageSec,
      speed: r.speed == null ? null : Number(r.speed),
      deviceId: r.device_id,
      imei: r.imei,
      label: r.label || r.imei,
      sourceProtocol: r.source_protocol,
    });
  }
  return map;
}

/** All last fixes for a tenant (Live Ops overlay / device-only fleet). */
export async function listTenantLastFixes(tenantId) {
  const rows = await dbQuery(
    `SELECT d.id AS device_id, d.imei, d.label, d.armada_user_id, d.protocol,
            lf.lat, lf.lon, lf.recorded_at, lf.speed, lf.heading, lf.ignition, lf.source_protocol
     FROM tracker_devices d
     JOIN vehicle_last_fix lf ON lf.device_id = d.id
     WHERE d.tenant_id = $1 AND d.enabled = true
     ORDER BY lf.recorded_at DESC`,
    [tenantId],
  );
  const now = Date.now();
  return rows.rows.map((r) => {
    const recordedAt = r.recorded_at ? new Date(r.recorded_at).toISOString() : null;
    const ageSec =
      recordedAt && !Number.isNaN(Date.parse(recordedAt))
        ? Math.max(0, Math.round((now - Date.parse(recordedAt)) / 1000))
        : null;
    return {
      deviceId: r.device_id,
      imei: r.imei,
      label: r.label || r.imei,
      armadaUserId: r.armada_user_id == null ? null : Number(r.armada_user_id),
      protocol: r.protocol,
      lat: Number(r.lat),
      lon: Number(r.lon),
      recordedAt,
      ageSec,
      speed: r.speed == null ? null : Number(r.speed),
      heading: r.heading == null ? null : Number(r.heading),
      ignition: r.ignition,
      sourceProtocol: r.source_protocol,
    };
  });
}

export async function pruneVehicleFixes(retentionDays = 14) {
  const days = Math.max(1, Math.min(90, Number(retentionDays) || 14));
  const res = await dbQuery(
    `DELETE FROM vehicle_fixes
     WHERE recorded_at < now() - ($1::text || ' days')::interval`,
    [String(days)],
  );
  return res.rowCount || 0;
}

export async function tenantTelematicsSource(tenantId) {
  const rows = await dbQuery(`SELECT telematics_source FROM tenants WHERE id = $1`, [tenantId]);
  return normalizeTelematicsSource(rows.rows[0]?.telematics_source);
}
