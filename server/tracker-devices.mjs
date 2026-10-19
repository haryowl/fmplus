/**
 * Tracker device registry + normalized vehicle fix ingest.
 * Shared by Admin CRUD, HTTP/JSON ingest, and the Go gateway (same tables).
 */
import crypto from "node:crypto";
import { dbQuery } from "./db.mjs";
import { applyDeviceRemap } from "./device-manager.mjs";
import {
  deviceIdsInGroups,
  groupSummariesByDeviceIds,
} from "./tracker-device-groups.mjs";
import { listDeviceFieldDefs, sanitizeCustomAttrs } from "./tracker-device-fields.mjs";

export const TRACKER_PROTOCOLS = [
  "json",
  "teltonika",
  "jt808",
  "jt809",
  "jt1078",
  "subiao",
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

function cleanVideoField(v, max) {
  const s = String(v || "").trim().slice(0, max);
  return s || null;
}

/** Prefer a global (tenant_id NULL) system profile for the protocol. */
export async function defaultProfileIdForProtocol(protocol) {
  const proto = normalizeProtocol(protocol);
  const rows = await dbQuery(
    `SELECT id FROM tracker_device_profiles
     WHERE tenant_id IS NULL AND protocol = $1
     ORDER BY CASE completeness
       WHEN 'certified' THEN 0 WHEN 'partial' THEN 1 WHEN 'mvp' THEN 2 ELSE 3 END,
       name ASC
     LIMIT 1`,
    [proto],
  );
  return rows.rows[0]?.id || null;
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
    description: row.description || "",
    plate: row.plate || "",
    vin: row.vin || "",
    make: row.make || "",
    model: row.model || "",
    modelYear:
      row.model_year == null || row.model_year === ""
        ? null
        : Number.isFinite(Number(row.model_year))
          ? Number(row.model_year)
          : null,
    vehicleType: row.vehicle_type || "",
    color: row.color || "",
    cameraChannels: Math.max(0, Math.min(32, Number(row.camera_channels) || 0)),
    tags: Array.isArray(row.tags) ? row.tags.map((t) => String(t)).filter(Boolean) : [],
    customAttrs:
      row.custom_attrs && typeof row.custom_attrs === "object" && !Array.isArray(row.custom_attrs)
        ? row.custom_attrs
        : {},
    armadaUserId: row.armada_user_id == null ? null : Number(row.armada_user_id),
    enabled: row.enabled !== false,
    hasAuthToken: Boolean(row.auth_token_hash),
    videoChannelId: row.video_channel_id || "",
    videoRtspUrl: row.video_rtsp_url || "",
    videoNotes: row.video_notes || "",
    profileId: row.profile_id || null,
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
      heading: row.last_heading == null ? null : Number(row.last_heading),
      ignition:
        row.last_ignition === undefined || row.last_ignition === null
          ? null
          : Boolean(row.last_ignition),
      sourceProtocol: row.last_source_protocol || row.protocol,
    };
  }
  return out;
}

function cleanTextField(v, max) {
  return String(v ?? "").trim().slice(0, max);
}

function parseModelYear(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1980 || n > 2100) return null;
  return n;
}

function parseCameraChannels(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(32, Math.trunc(n)));
}

function parseTags(v) {
  if (Array.isArray(v)) return v.map((t) => String(t).trim()).filter(Boolean).slice(0, 24);
  if (typeof v === "string") {
    return v
      .split(/[,;]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 24);
  }
  return [];
}

async function resolveCustomAttrs(tenantId, body, currentAttrs) {
  if (body.customAttrs === undefined && body.custom_attrs === undefined) {
    return currentAttrs && typeof currentAttrs === "object" && !Array.isArray(currentAttrs)
      ? currentAttrs
      : {};
  }
  const defs = await listDeviceFieldDefs(tenantId, { includeDisabled: false });
  return sanitizeCustomAttrs(body.customAttrs ?? body.custom_attrs, defs);
}

export async function listTrackerDevices(tenantId) {
  const rows = await dbQuery(
    `SELECT d.*,
            lf.lat AS last_lat, lf.lon AS last_lon, lf.recorded_at AS last_recorded_at,
            lf.speed AS last_speed, lf.heading AS last_heading, lf.ignition AS last_ignition,
            lf.source_protocol AS last_source_protocol
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
  const videoChannelId = cleanVideoField(body.videoChannelId ?? body.video_channel_id, 64);
  const videoRtspUrl = cleanVideoField(body.videoRtspUrl ?? body.video_rtsp_url, 500);
  const videoNotes = cleanVideoField(body.videoNotes ?? body.video_notes, 500);
  const description = cleanTextField(body.description, 500);
  const plate = cleanTextField(body.plate, 32);
  const vin = cleanTextField(body.vin, 32);
  const make = cleanTextField(body.make, 64);
  const model = cleanTextField(body.model, 64);
  const modelYear = parseModelYear(body.modelYear ?? body.model_year);
  const vehicleType = cleanTextField(body.vehicleType ?? body.vehicle_type, 64);
  const color = cleanTextField(body.color, 32);
  const cameraChannels = parseCameraChannels(body.cameraChannels ?? body.camera_channels);
  const tags = parseTags(body.tags);
  const customAttrs = await resolveCustomAttrs(tenantId, body, {});
  let profileId =
    body.profileId || body.profile_id
      ? String(body.profileId || body.profile_id).trim() || null
      : null;
  if (!profileId) {
    try {
      profileId = await defaultProfileIdForProtocol(protocol);
    } catch {
      profileId = null;
    }
  }
  const inserted = await dbQuery(
    `INSERT INTO tracker_devices (
       tenant_id, imei, unique_id, protocol, label, armada_user_id, auth_token_hash, enabled,
       video_channel_id, video_rtsp_url, video_notes, profile_id,
       description, plate, vin, make, model, model_year, vehicle_type, color,
       camera_channels, tags, custom_attrs
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb)
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
      videoChannelId,
      videoRtspUrl,
      videoNotes,
      profileId,
      description,
      plate,
      vin,
      make,
      model,
      modelYear,
      vehicleType,
      color,
      cameraChannels,
      tags,
      JSON.stringify(customAttrs),
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
  const videoChannelId =
    body.videoChannelId !== undefined || body.video_channel_id !== undefined
      ? cleanVideoField(body.videoChannelId ?? body.video_channel_id, 64)
      : current.video_channel_id;
  const videoRtspUrl =
    body.videoRtspUrl !== undefined || body.video_rtsp_url !== undefined
      ? cleanVideoField(body.videoRtspUrl ?? body.video_rtsp_url, 500)
      : current.video_rtsp_url;
  const videoNotes =
    body.videoNotes !== undefined || body.video_notes !== undefined
      ? cleanVideoField(body.videoNotes ?? body.video_notes, 500)
      : current.video_notes;
  const profileId =
    body.profileId !== undefined || body.profile_id !== undefined
      ? String(body.profileId || body.profile_id || "").trim() || null
      : current.profile_id;
  const description =
    body.description !== undefined ? cleanTextField(body.description, 500) : current.description || "";
  const plate = body.plate !== undefined ? cleanTextField(body.plate, 32) : current.plate || "";
  const vin = body.vin !== undefined ? cleanTextField(body.vin, 32) : current.vin || "";
  const make = body.make !== undefined ? cleanTextField(body.make, 64) : current.make || "";
  const model = body.model !== undefined ? cleanTextField(body.model, 64) : current.model || "";
  const modelYear =
    body.modelYear !== undefined || body.model_year !== undefined
      ? parseModelYear(body.modelYear ?? body.model_year)
      : current.model_year;
  const vehicleType =
    body.vehicleType !== undefined || body.vehicle_type !== undefined
      ? cleanTextField(body.vehicleType ?? body.vehicle_type, 64)
      : current.vehicle_type || "";
  const color = body.color !== undefined ? cleanTextField(body.color, 32) : current.color || "";
  const cameraChannels =
    body.cameraChannels !== undefined || body.camera_channels !== undefined
      ? parseCameraChannels(body.cameraChannels ?? body.camera_channels)
      : Math.max(0, Number(current.camera_channels) || 0);
  const tags = body.tags !== undefined ? parseTags(body.tags) : Array.isArray(current.tags) ? current.tags : [];
  const customAttrs = await resolveCustomAttrs(tenantId, body, current.custom_attrs);
  const updated = await dbQuery(
    `UPDATE tracker_devices SET
       imei = $3, unique_id = $4, protocol = $5, label = $6,
       armada_user_id = $7, auth_token_hash = $8, enabled = $9,
       video_channel_id = $10, video_rtsp_url = $11, video_notes = $12,
       profile_id = $13,
       description = $14, plate = $15, vin = $16, make = $17, model = $18,
       model_year = $19, vehicle_type = $20, color = $21, camera_channels = $22,
       tags = $23, custom_attrs = $24::jsonb, updated_at = now()
     WHERE tenant_id = $1 AND id = $2
     RETURNING *`,
    [
      tenantId,
      deviceId,
      imei,
      uniqueId,
      protocol,
      label,
      armadaUserId,
      tokenHash,
      enabled,
      videoChannelId,
      videoRtspUrl,
      videoNotes,
      profileId,
      description,
      plate,
      vin,
      make,
      model,
      modelYear,
      vehicleType,
      color,
      cameraChannels,
      tags,
      JSON.stringify(customAttrs),
    ],
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

function publicUnassignedRow(row) {
  if (!row) return null;
  return {
    imei: row.imei,
    protocol: row.protocol || "other",
    lastRemote: row.last_remote || "",
    hitCount: Number(row.hit_count) || 1,
    firstSeenAt:
      row.first_seen_at instanceof Date
        ? row.first_seen_at.toISOString()
        : row.first_seen_at
          ? String(row.first_seen_at)
          : null,
    lastSeenAt:
      row.last_seen_at instanceof Date
        ? row.last_seen_at.toISOString()
        : row.last_seen_at
          ? String(row.last_seen_at)
          : null,
  };
}

/** Unknown IMEIs seen by the gateway, newest first. */
export async function listUnassignedTrackerImeis(limit = 100) {
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const rows = await dbQuery(
    `SELECT imei, protocol, last_remote, hit_count, first_seen_at, last_seen_at
     FROM tracker_unassigned
     ORDER BY last_seen_at DESC
     LIMIT $1`,
    [lim],
  );
  return rows.rows.map(publicUnassignedRow);
}

/** Drop a quarantined IMEI without claiming it. */
export async function dismissUnassignedTrackerImei(imei) {
  const id = normalizeImei(imei);
  if (!id) {
    const err = new Error("IMEI is required");
    err.status = 400;
    throw err;
  }
  const deleted = await dbQuery(
    `DELETE FROM tracker_unassigned WHERE imei = $1 RETURNING imei`,
    [id],
  );
  if (!deleted.rows[0]) {
    const err = new Error("Unassigned IMEI not found");
    err.status = 404;
    throw err;
  }
  return true;
}

/**
 * Claim a quarantined IMEI into a tenant device registry, then remove from quarantine.
 * @param {string} tenantId
 * @param {{ imei: string, label?: string, protocol?: string, armadaUserId?: number|null, authToken?: string }} body
 */
export async function claimUnassignedTrackerImei(tenantId, body) {
  const imei = normalizeImei(body?.imei);
  if (imei.length < 5) {
    const err = new Error("IMEI / unique id is required (min 5 chars)");
    err.status = 400;
    throw err;
  }
  const found = await dbQuery(
    `SELECT imei, protocol FROM tracker_unassigned WHERE imei = $1`,
    [imei],
  );
  const row = found.rows[0];
  if (!row) {
    const err = new Error("Unassigned IMEI not found");
    err.status = 404;
    throw err;
  }
  const existing = await dbQuery(
    `SELECT id FROM tracker_devices WHERE imei = $1 LIMIT 1`,
    [imei],
  );
  if (existing.rows[0]) {
    await dbQuery(`DELETE FROM tracker_unassigned WHERE imei = $1`, [imei]);
    const err = new Error("IMEI already registered on another device");
    err.status = 409;
    throw err;
  }
  const device = await createTrackerDevice(tenantId, {
    imei,
    label: body?.label,
    protocol: body?.protocol || row.protocol || "other",
    profileId: body?.profileId || body?.profile_id || null,
    armadaUserId: body?.armadaUserId,
    authToken: body?.authToken,
    uniqueId: body?.uniqueId,
    enabled: body?.enabled !== false,
  });
  await dbQuery(`DELETE FROM tracker_unassigned WHERE imei = $1`, [imei]);
  return device;
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

  let mappedAttrs = {};
  let speedOut = Number.isFinite(speed) ? speed : null;
  let headingOut = Number.isFinite(heading) ? heading : null;
  let odometerOut = Number.isFinite(odometer) ? odometer : null;
  let satellitesOut = Number.isFinite(satellites) ? satellites : null;
  let ignitionOut = ignition;
  try {
    const remapped = await applyDeviceRemap(deviceRow.id, deviceRow.profile_id, rawAttrs);
    mappedAttrs = remapped.mapped || {};
    if (remapped.typed?.ignition !== undefined) ignitionOut = remapped.typed.ignition;
    if (remapped.typed?.odometer != null && Number.isFinite(remapped.typed.odometer)) {
      odometerOut = remapped.typed.odometer;
    }
    if (remapped.typed?.speed != null && Number.isFinite(remapped.typed.speed)) {
      speedOut = remapped.typed.speed;
    }
    if (remapped.typed?.heading != null && Number.isFinite(remapped.typed.heading)) {
      headingOut = remapped.typed.heading;
    }
    if (remapped.typed?.satellites != null && Number.isFinite(remapped.typed.satellites)) {
      satellitesOut = remapped.typed.satellites;
    }
  } catch {
    /* tables may not exist mid-migrate */
  }

  await dbQuery(
    `INSERT INTO vehicle_fixes (
       tenant_id, device_id, recorded_at, lat, lon, speed, heading, ignition,
       odometer, altitude, satellites, raw_attrs, mapped_attrs, source_protocol
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14)`,
    [
      deviceRow.tenant_id,
      deviceRow.id,
      recordedAt.toISOString(),
      coords.lat,
      coords.lon,
      speedOut,
      headingOut,
      ignitionOut,
      odometerOut,
      Number.isFinite(altitude) ? altitude : null,
      satellitesOut,
      JSON.stringify(rawAttrs),
      JSON.stringify(mappedAttrs),
      protocol,
    ],
  );

  await dbQuery(
    `INSERT INTO vehicle_last_fix (
       device_id, tenant_id, recorded_at, lat, lon, speed, heading, ignition,
       odometer, altitude, satellites, raw_attrs, mapped_attrs, source_protocol, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14, now())
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
       mapped_attrs = EXCLUDED.mapped_attrs,
       source_protocol = EXCLUDED.source_protocol,
       updated_at = now()
     WHERE vehicle_last_fix.recorded_at <= EXCLUDED.recorded_at`,
    [
      deviceRow.id,
      deviceRow.tenant_id,
      recordedAt.toISOString(),
      coords.lat,
      coords.lon,
      speedOut,
      headingOut,
      ignitionOut,
      odometerOut,
      Number.isFinite(altitude) ? altitude : null,
      satellitesOut,
      JSON.stringify(rawAttrs),
      JSON.stringify(mappedAttrs),
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

/** Pull odometer km + fuel from last-fix columns / mapped_attrs. */
export function enrichFixTelemetry(row) {
  const mapped =
    row.mapped_attrs && typeof row.mapped_attrs === "object" && !Array.isArray(row.mapped_attrs)
      ? row.mapped_attrs
      : {};
  let odometerKm = row.odometer == null ? null : Number(row.odometer);
  if (!Number.isFinite(odometerKm)) {
    const fromMapped = Number(mapped.odometer_km);
    odometerKm = Number.isFinite(fromMapped) ? fromMapped : null;
  }
  let fuelLevel = null;
  const fl = Number(mapped.fuel_level);
  if (Number.isFinite(fl)) fuelLevel = fl;
  let fuelLiters = null;
  const liters = Number(mapped.fuel_liters ?? mapped["can.fuel_l"]);
  if (Number.isFinite(liters)) fuelLiters = liters;
  return { odometerKm, fuelLevel, fuelLiters };
}

/**
 * Latest device fixes keyed by armada_user_id for Dispatch Live / Maintenance merge.
 * @returns {Promise<Map<number, object>>}
 */
export async function lastFixesByArmadaUserIds(tenantId, armadaUserIds) {
  const ids = [...new Set((armadaUserIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  /** @type {Map<number, object>} */
  const map = new Map();
  if (!ids.length) return map;
  const rows = await dbQuery(
    `SELECT d.armada_user_id, d.id AS device_id, d.imei, d.label,
            lf.lat, lf.lon, lf.recorded_at, lf.speed, lf.heading, lf.ignition,
            lf.odometer, lf.mapped_attrs, lf.source_protocol
     FROM tracker_devices d
     JOIN vehicle_last_fix lf ON lf.device_id = d.id
     WHERE d.tenant_id = $1
       AND d.enabled = true
       AND d.armada_user_id = ANY($2::int[])`,
    [tenantId, ids],
  );
  const now = Date.now();
  const deviceIds = rows.rows.map((r) => r.device_id);
  const groupsByDevice = await groupSummariesByDeviceIds(tenantId, deviceIds).catch(() => new Map());
  for (const r of rows.rows) {
    const uid = Number(r.armada_user_id);
    const recordedAt = r.recorded_at ? new Date(r.recorded_at).toISOString() : null;
    const ageSec =
      recordedAt && !Number.isNaN(Date.parse(recordedAt))
        ? Math.max(0, Math.round((now - Date.parse(recordedAt)) / 1000))
        : null;
    const prev = map.get(uid);
    if (prev && prev.ageSec != null && ageSec != null && prev.ageSec <= ageSec) continue;
    const tel = enrichFixTelemetry(r);
    map.set(uid, {
      lat: Number(r.lat),
      lon: Number(r.lon),
      recordedAt,
      ageSec,
      speed: r.speed == null ? null : Number(r.speed),
      heading: r.heading == null ? null : Number(r.heading),
      ignition: r.ignition,
      deviceId: r.device_id,
      imei: r.imei,
      label: r.label || r.imei,
      sourceProtocol: r.source_protocol,
      odometerKm: tel.odometerKm,
      fuelLevel: tel.fuelLevel,
      fuelLiters: tel.fuelLiters,
      groups: groupsByDevice.get(r.device_id) || [],
    });
  }
  return map;
}

/**
 * Odometer km for one Armada user from the linked tracker device (freshest enabled).
 * @returns {Promise<number|null>}
 */
export async function deviceOdometerKmForArmadaUser(tenantId, armadaUserId) {
  const uid = Number(armadaUserId);
  if (!Number.isInteger(uid) || uid < 1) return null;
  const map = await lastFixesByArmadaUserIds(tenantId, [uid]);
  const fix = map.get(uid);
  return fix?.odometerKm != null && Number.isFinite(fix.odometerKm) ? fix.odometerKm : null;
}

/**
 * Armada user ids linked to enabled devices in the given tracker device groups.
 * @param {string} tenantId
 * @param {string[]} groupIds
 * @returns {Promise<number[]>}
 */
export async function armadaUserIdsInDeviceGroups(tenantId, groupIds) {
  const deviceIds = await deviceIdsInGroups(tenantId, groupIds);
  if (!deviceIds.length) return [];
  const rows = await dbQuery(
    `SELECT DISTINCT armada_user_id
     FROM tracker_devices
     WHERE tenant_id = $1
       AND enabled = true
       AND id = ANY($2::uuid[])
       AND armada_user_id IS NOT NULL`,
    [tenantId, deviceIds],
  );
  return rows.rows
    .map((r) => Number(r.armada_user_id))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/**
 * Shared fleet last positions for Dispatch recovery / plan-day / Live start points.
 * Shape matches fetchVehiclePositions: Map&lt;armadaUserId, { lat, lon, label }&gt;.
 * Device fixes overlay (and fill) Armada when telematics_source includes devices.
 *
 * @param {string} tenantId
 * @param {{ appId?: number, token?: string } | null | undefined} vaultTenant
 * @param {{ armadaUserIds?: number[], groupIds?: string[] }} [opts]
 * @returns {Promise<Map<number, { lat: number, lon: number, label: string }>>}
 */
export async function buildTelematicsPosMap(tenantId, vaultTenant, opts = {}) {
  const source = await tenantTelematicsSource(tenantId).catch(() => "both");
  /** @type {Map<number, { lat: number, lon: number, label: string }>} */
  const out = new Map();

  let uidFilter = null;
  if (Array.isArray(opts.groupIds) && opts.groupIds.filter(Boolean).length) {
    uidFilter = new Set(await armadaUserIdsInDeviceGroups(tenantId, opts.groupIds));
  } else if (Array.isArray(opts.armadaUserIds) && opts.armadaUserIds.length) {
    uidFilter = new Set(
      opts.armadaUserIds.map(Number).filter((n) => Number.isInteger(n) && n > 0),
    );
  }

  if (telematicsUsesArmada(source) && vaultTenant?.appId && vaultTenant?.token) {
    try {
      const { fetchVehiclePositions } = await import("./vehicle-positions.mjs");
      const armada = await fetchVehiclePositions(vaultTenant);
      for (const [uid, pos] of armada) {
        if (uidFilter && !uidFilter.has(uid)) continue;
        out.set(uid, pos);
      }
    } catch {
      /* keep empty / device-only */
    }
  }

  if (telematicsUsesDevices(source)) {
    let ids =
      uidFilter != null
        ? [...uidFilter]
        : Array.isArray(opts.armadaUserIds)
          ? opts.armadaUserIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)
          : null;
    if (ids == null) {
      // No scope: overlay all linked devices for the tenant.
      const all = await dbQuery(
        `SELECT DISTINCT armada_user_id
         FROM tracker_devices
         WHERE tenant_id = $1 AND enabled = true AND armada_user_id IS NOT NULL`,
        [tenantId],
      );
      ids = all.rows
        .map((r) => Number(r.armada_user_id))
        .filter((n) => Number.isInteger(n) && n > 0);
    }
    if (ids.length) {
      try {
        const deviceMap = await lastFixesByArmadaUserIds(tenantId, ids);
        for (const [uid, fix] of deviceMap) {
          if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lon)) continue;
          const prev = out.get(uid);
          // Prefer device GPS when present (devices / both).
          out.set(uid, {
            lat: fix.lat,
            lon: fix.lon,
            label: fix.label
              ? `${fix.label} (device)`
              : prev?.label || `Vehicle ${uid} (device)`,
          });
        }
      } catch {
        /* keep Armada overlay */
      }
    }
  }

  return out;
}

/**
 * All last fixes for a tenant (Fleet Live / Live Ops overlay / device-only fleet).
 * @param {string} tenantId
 * @param {{ groupIds?: string[] }} [opts]
 */
export async function listTenantLastFixes(tenantId, opts = {}) {
  const groupIds = Array.isArray(opts.groupIds) ? opts.groupIds.filter(Boolean) : [];
  const groupFilter = groupIds.length ? groupIds : null;

  // Single round-trip: filter by group membership + aggregate group labels.
  // Avoids deviceIdsInGroups + groupSummariesByDeviceIds (2 extra queries per poll).
  const rows = await dbQuery(
    `SELECT d.id AS device_id, d.imei, d.label, d.plate, d.vehicle_type, d.armada_user_id, d.protocol,
            lf.lat, lf.lon, lf.recorded_at, lf.speed, lf.heading, lf.ignition,
            lf.odometer, lf.mapped_attrs, lf.source_protocol,
            COALESCE(gs.groups_json, '[]'::json) AS groups_json
     FROM tracker_devices d
     JOIN vehicle_last_fix lf ON lf.device_id = d.id
     LEFT JOIN LATERAL (
       SELECT json_agg(
                json_build_object('id', g.id, 'name', g.name)
                ORDER BY g.sort_order ASC, lower(g.name) ASC
              ) AS groups_json
       FROM tracker_device_group_members m
       JOIN tracker_device_groups g ON g.id = m.group_id AND g.tenant_id = d.tenant_id
       WHERE m.device_id = d.id
     ) gs ON true
     WHERE d.tenant_id = $1 AND d.enabled = true
       AND (
         $2::uuid[] IS NULL
         OR EXISTS (
           SELECT 1
           FROM tracker_device_group_members m2
           WHERE m2.device_id = d.id AND m2.group_id = ANY($2::uuid[])
         )
       )
     ORDER BY lf.recorded_at DESC NULLS LAST`,
    [tenantId, groupFilter],
  );
  const now = Date.now();
  return rows.rows.map((r) => {
    const recordedAt = r.recorded_at ? new Date(r.recorded_at).toISOString() : null;
    const ageSec =
      recordedAt && !Number.isNaN(Date.parse(recordedAt))
        ? Math.max(0, Math.round((now - Date.parse(recordedAt)) / 1000))
        : null;
    const tel = enrichFixTelemetry(r);
    const displayLabel =
      (r.label && String(r.label).trim()) ||
      (r.plate && String(r.plate).trim()) ||
      r.imei;
    let groups = [];
    const rawGroups = r.groups_json;
    if (Array.isArray(rawGroups)) {
      groups = rawGroups
        .filter((g) => g && g.id && g.name)
        .map((g) => ({ id: String(g.id), name: String(g.name) }));
    }
    return {
      deviceId: r.device_id,
      imei: r.imei,
      label: displayLabel,
      plate: r.plate || "",
      vehicleType: r.vehicle_type || "",
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
      odometerKm: tel.odometerKm,
      fuelLevel: tel.fuelLevel,
      fuelLiters: tel.fuelLiters,
      groups,
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

/**
 * Day polylines from vehicle_fixes for Live maps.
 * @param {string} tenantId
 * @param {Array<{ armadaUserId: number, date: string }>} days
 * @returns {Promise<Map<string, Array<{ lat: number, lon: number, recordedAt: string }>>>}
 */
export async function deviceTrailsByArmadaDays(tenantId, days) {
  /** @type {Map<string, Array<{ lat: number, lon: number, recordedAt: string }>>} */
  const out = new Map();
  const list = Array.isArray(days) ? days.slice(0, 320) : [];
  for (const day of list) {
    const uid = Number(day.armadaUserId ?? day.userId);
    const date = String(day.date || "").trim().slice(0, 10);
    if (!Number.isInteger(uid) || uid < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const key = `${uid}|${date}`;
    const rows = await dbQuery(
      `SELECT vf.lat, vf.lon, vf.recorded_at
       FROM vehicle_fixes vf
       JOIN tracker_devices d ON d.id = vf.device_id
       WHERE d.tenant_id = $1
         AND d.enabled = true
         AND d.armada_user_id = $2
         AND vf.recorded_at >= ($3::date AT TIME ZONE 'Asia/Jakarta')
         AND vf.recorded_at < (($3::date + 1) AT TIME ZONE 'Asia/Jakarta')
       ORDER BY vf.recorded_at ASC
       LIMIT 2000`,
      [tenantId, uid, date],
    );
    out.set(
      key,
      rows.rows.map((r) => ({
        lat: Number(r.lat),
        lon: Number(r.lon),
        recordedAt:
          r.recorded_at instanceof Date ? r.recorded_at.toISOString() : String(r.recorded_at),
      })),
    );
  }
  return out;
}

/**
 * Day history points for one tracker device (Fleet Live Trips / History).
 * @param {string} tenantId
 * @param {string} deviceId
 * @param {{ date: string, tzOffset?: string, limit?: number }} opts
 */
export async function listDeviceDayFixes(tenantId, deviceId, opts = {}) {
  const date = String(opts.date || "").trim().slice(0, 10);
  const device = String(deviceId || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(device) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { deviceId: device, date, points: [] };
  }
  const offset = /^[+-]\d{2}:\d{2}$/.test(String(opts.tzOffset || "").trim())
    ? String(opts.tzOffset).trim()
    : "+07:00";
  const startMs = Date.parse(`${date}T00:00:00${offset}`);
  if (!Number.isFinite(startMs)) return { deviceId: device, date, points: [] };
  const endMs = startMs + 86_400_000;
  const limit = Math.min(8000, Math.max(100, Number(opts.limit) || 4000));

  const own = await dbQuery(
    `SELECT id, label, imei FROM tracker_devices
     WHERE tenant_id = $1 AND id = $2::uuid AND enabled = true`,
    [tenantId, device],
  );
  if (!own.rows[0]) return { deviceId: device, date, points: [], error: "Device not found" };

  const rows = await dbQuery(
    `SELECT lat, lon, speed, heading, ignition, odometer, recorded_at, source_protocol
     FROM vehicle_fixes
     WHERE tenant_id = $1
       AND device_id = $2::uuid
       AND recorded_at >= $3::timestamptz
       AND recorded_at < $4::timestamptz
     ORDER BY recorded_at ASC
     LIMIT $5`,
    [tenantId, device, new Date(startMs).toISOString(), new Date(endMs).toISOString(), limit],
  );

  return {
    deviceId: device,
    date,
    tzOffset: offset,
    label: own.rows[0].label || own.rows[0].imei,
    imei: own.rows[0].imei,
    points: rows.rows.map((r) => ({
      lat: Number(r.lat),
      lon: Number(r.lon),
      speed: r.speed == null ? null : Number(r.speed),
      heading: r.heading == null ? null : Number(r.heading),
      ignition: r.ignition == null ? null : Boolean(r.ignition),
      odometerKm: r.odometer == null ? null : Number(r.odometer),
      recordedAt:
        r.recorded_at instanceof Date ? r.recorded_at.toISOString() : String(r.recorded_at),
      sourceProtocol: r.source_protocol || "",
    })),
  };
}
