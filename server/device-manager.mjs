/**
 * Device Manager: canonical params, profiles, remap rules, commands, safety events.
 */
import { dbQuery } from "./db.mjs";

export function publicParamDef(row) {
  if (!row) return null;
  return {
    id: row.id,
    category: row.category,
    valueType: row.value_type,
    unit: row.unit || "",
    label: row.label || row.id,
    description: row.description || "",
  };
}

export function publicProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id || null,
    name: row.name,
    protocol: row.protocol,
    model: row.model || "",
    completeness: row.completeness || "mvp",
    notes: row.notes || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function publicMapRule(row) {
  if (!row) return null;
  return {
    id: row.id,
    profileId: row.profile_id || null,
    deviceId: row.device_id || null,
    vendorKey: row.vendor_key,
    appParamId: row.app_param_id,
    transform: row.transform || "identity",
    transformArg: row.transform_arg || {},
    enabled: row.enabled !== false,
  };
}

export async function listParamDefs() {
  const rows = await dbQuery(
    `SELECT * FROM tracker_param_defs ORDER BY category, id`,
  );
  return rows.rows.map(publicParamDef);
}

export async function listProtocolParams(protocol) {
  const rows = protocol
    ? await dbQuery(
        `SELECT * FROM tracker_protocol_params WHERE protocol = $1 ORDER BY vendor_key`,
        [protocol],
      )
    : await dbQuery(`SELECT * FROM tracker_protocol_params ORDER BY protocol, vendor_key`);
  return rows.rows.map((r) => ({
    protocol: r.protocol,
    vendorKey: r.vendor_key,
    label: r.label || r.vendor_key,
    valueType: r.value_type,
    description: r.description || "",
  }));
}

export async function listProfiles(tenantId) {
  const rows = await dbQuery(
    `SELECT * FROM tracker_device_profiles
     WHERE tenant_id IS NULL OR tenant_id = $1
     ORDER BY protocol, name`,
    [tenantId],
  );
  return rows.rows.map(publicProfile);
}

export async function createProfile(tenantId, body) {
  const name = String(body.name || "").trim().slice(0, 120);
  const protocol = String(body.protocol || "other").trim().toLowerCase();
  if (!name) {
    const err = new Error("Profile name required");
    err.status = 400;
    throw err;
  }
  const inserted = await dbQuery(
    `INSERT INTO tracker_device_profiles (tenant_id, name, protocol, model, completeness, notes)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [
      tenantId,
      name,
      protocol,
      String(body.model || "").trim().slice(0, 80),
      ["mvp", "partial", "certified", "experimental"].includes(body.completeness)
        ? body.completeness
        : "mvp",
      String(body.notes || "").trim().slice(0, 500),
    ],
  );
  return publicProfile(inserted.rows[0]);
}

export async function listMapRules({ profileId, deviceId }) {
  if (deviceId) {
    const rows = await dbQuery(
      `SELECT * FROM tracker_param_maps WHERE device_id = $1 ORDER BY vendor_key`,
      [deviceId],
    );
    return rows.rows.map(publicMapRule);
  }
  if (profileId) {
    const rows = await dbQuery(
      `SELECT * FROM tracker_param_maps WHERE profile_id = $1 ORDER BY vendor_key`,
      [profileId],
    );
    return rows.rows.map(publicMapRule);
  }
  return [];
}

export async function upsertMapRule(body) {
  const vendorKey = String(body.vendorKey || "").trim();
  const appParamId = String(body.appParamId || "").trim();
  if (!vendorKey || !appParamId) {
    const err = new Error("vendorKey and appParamId required");
    err.status = 400;
    throw err;
  }
  if (!body.profileId && !body.deviceId) {
    const err = new Error("profileId or deviceId required");
    err.status = 400;
    throw err;
  }
  const transform = [
    "identity",
    "scale",
    "offset",
    "enum_map",
    "bit_mask",
    "invert_bool",
  ].includes(body.transform)
    ? body.transform
    : "identity";
  const inserted = await dbQuery(
    `INSERT INTO tracker_param_maps (
       profile_id, device_id, vendor_key, app_param_id, transform, transform_arg, enabled
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
     RETURNING *`,
    [
      body.profileId || null,
      body.deviceId || null,
      vendorKey,
      appParamId,
      transform,
      JSON.stringify(body.transformArg || {}),
      body.enabled !== false,
    ],
  );
  return publicMapRule(inserted.rows[0]);
}

export async function deleteMapRule(ruleId) {
  const deleted = await dbQuery(
    `DELETE FROM tracker_param_maps WHERE id = $1 RETURNING id`,
    [ruleId],
  );
  if (!deleted.rows[0]) {
    const err = new Error("Map rule not found");
    err.status = 404;
    throw err;
  }
  return true;
}

export async function previewRemap(rawAttrs, { deviceId, profileId }) {
  const rules = await listMapRules({ deviceId, profileId });
  const mapped = {};
  const raw = rawAttrs && typeof rawAttrs === "object" ? rawAttrs : {};
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const val = lookupRaw(raw, rule.vendorKey);
    if (val === undefined) continue;
    mapped[rule.appParamId] = applyTransform(val, rule.transform, rule.transformArg);
  }
  return { mapped, rulesApplied: rules.length };
}

function lookupRaw(raw, key) {
  if (Object.prototype.hasOwnProperty.call(raw, key)) return raw[key];
  if (raw.io && key.startsWith("io.")) return raw.io[key.slice(3)];
  if (raw.tags && key.startsWith("tag.")) return raw.tags[key.slice(4)];
  if (raw.add && key.startsWith("add.")) return raw.add[key.slice(4)];
  return undefined;
}

function applyTransform(v, transform, arg = {}) {
  const num = Number(v);
  switch (transform) {
    case "invert_bool":
      return !Boolean(Number(v) || v === true);
    case "scale":
      return num * (Number(arg.scale) || 1);
    case "offset":
      return num + (Number(arg.offset) || 0);
    case "bit_mask": {
      const mask = Number(arg.mask) || 1;
      return (Number(v) & mask) !== 0;
    }
    case "enum_map":
      return arg.map && Object.prototype.hasOwnProperty.call(arg.map, String(v))
        ? arg.map[String(v)]
        : v;
    default:
      return v;
  }
}

/** Apply remap during Node HTTP ingest (mirrors Go store.Ingest). */
export async function applyDeviceRemap(deviceId, profileId, rawAttrs) {
  const { mapped } = await previewRemap(rawAttrs || {}, { deviceId, profileId });
  const typed = {};
  if (mapped.ignition !== undefined) typed.ignition = Boolean(mapped.ignition);
  if (mapped.odometer_km !== undefined) typed.odometer = Number(mapped.odometer_km);
  if (mapped.speed_kmh !== undefined) typed.speed = Number(mapped.speed_kmh);
  if (mapped.heading_deg !== undefined) typed.heading = Number(mapped.heading_deg);
  if (mapped.satellites !== undefined) typed.satellites = Number(mapped.satellites);
  return { mapped, typed };
}

export async function enqueueCommand(tenantId, deviceId, body) {
  const device = await dbQuery(
    `SELECT id, protocol FROM tracker_devices WHERE tenant_id = $1 AND id = $2`,
    [tenantId, deviceId],
  );
  if (!device.rows[0]) {
    const err = new Error("Device not found");
    err.status = 404;
    throw err;
  }
  const inserted = await dbQuery(
    `INSERT INTO tracker_commands (
       tenant_id, device_id, protocol, command_type, payload_text, payload_hex, status
     ) VALUES ($1,$2,$3,$4,$5,$6,'pending') RETURNING *`,
    [
      tenantId,
      deviceId,
      device.rows[0].protocol,
      [
        "raw",
        "text",
        "jt808",
        "jt808_8103",
        "jt808_8500",
        "teltonika_codec12",
        "concox_gprs",
        "ruptela_sms",
        "param",
        "control",
        "vehicle_control",
      ].includes(body.commandType)
        ? body.commandType
        : "text",
      String(body.payloadText || body.text || "").slice(0, 4000),
      String(body.payloadHex || "").replace(/[^0-9a-fA-F]/g, "").slice(0, 8000),
    ],
  );
  const row = inserted.rows[0];
  return {
    id: row.id,
    deviceId: row.device_id,
    status: row.status,
    commandType: row.command_type,
    createdAt: row.created_at,
  };
}

export async function listCommands(tenantId, deviceId, limit = 50) {
  const rows = await dbQuery(
    `SELECT * FROM tracker_commands
     WHERE tenant_id = $1 AND device_id = $2
     ORDER BY created_at DESC LIMIT $3`,
    [tenantId, deviceId, Math.min(limit, 200)],
  );
  return rows.rows.map((r) => ({
    id: r.id,
    status: r.status,
    commandType: r.command_type,
    payloadText: r.payload_text,
    responseText: r.response_text,
    createdAt: r.created_at,
    sentAt: r.sent_at,
    completedAt: r.completed_at,
  }));
}

export async function listSafetyEvents(tenantId, { deviceId, limit = 50 } = {}) {
  const lim = Math.min(Number(limit) || 50, 200);
  const rows = deviceId
    ? await dbQuery(
        `SELECT * FROM tracker_safety_events
         WHERE tenant_id = $1 AND device_id = $2
         ORDER BY recorded_at DESC LIMIT $3`,
        [tenantId, deviceId, lim],
      )
    : await dbQuery(
        `SELECT * FROM tracker_safety_events
         WHERE tenant_id = $1
         ORDER BY recorded_at DESC LIMIT $2`,
        [tenantId, lim],
      );
  return rows.rows.map((r) => ({
    id: String(r.id),
    deviceId: r.device_id,
    recordedAt: r.recorded_at,
    alarmType: r.alarm_type,
    alarmLevel: r.alarm_level,
    lat: r.lat,
    lon: r.lon,
    attachmentId: r.attachment_id,
    sourceProtocol: r.source_protocol,
    rawAttrs: r.raw_attrs,
    mappedAttrs: r.mapped_attrs,
  }));
}

export async function lastFixPreview(tenantId, deviceId) {
  const rows = await dbQuery(
    `SELECT raw_attrs, mapped_attrs, lat, lon, recorded_at, source_protocol
     FROM vehicle_last_fix WHERE tenant_id = $1 AND device_id = $2`,
    [tenantId, deviceId],
  );
  const row = rows.rows[0];
  if (!row) return null;
  return {
    lat: Number(row.lat),
    lon: Number(row.lon),
    recordedAt: row.recorded_at,
    sourceProtocol: row.source_protocol,
    rawAttrs: row.raw_attrs || {},
    mappedAttrs: row.mapped_attrs || {},
  };
}
