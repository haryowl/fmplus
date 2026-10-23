/**
 * Device Manager: canonical params, profiles, remap rules, commands, safety events.
 */
import { formatAvlParamValue, mergeAvlEventAttrs } from "./avl-io-enums.mjs";
import { dbQuery } from "./db.mjs";

/** Protocol-scoped command types (mirrors Admin COMMAND_TYPE_OPTIONS). */
const COMMAND_TYPE_PROTOCOLS = {
  jt808_8103: ["jt808", "subiao"],
  jt808_8104: ["jt808", "subiao"],
  jt808_8105: ["jt808", "subiao"],
  jt808_8106: ["jt808", "subiao"],
  jt808_8107: ["jt808", "subiao"],
  jt808_8108: ["jt808", "subiao"],
  query_param_ids: ["jt808", "subiao"],
  terminal_upgrade: ["jt808", "subiao"],
  jt808_8201: ["jt808", "subiao"],
  jt808_8202: ["jt808", "subiao"],
  jt808_8203: ["jt808", "subiao"],
  jt808_8204: ["jt808", "subiao"],
  jt808_8500: ["jt808", "subiao"],
  jt808_8600: ["jt808", "subiao"],
  jt808_8601: ["jt808", "subiao"],
  jt808_8602: ["jt808", "subiao"],
  jt808_8603: ["jt808", "subiao"],
  jt808_8604: ["jt808", "subiao"],
  jt808_8605: ["jt808", "subiao"],
  jt808_8606: ["jt808", "subiao"],
  jt808_8607: ["jt808", "subiao"],
  jt808_8608: ["jt808", "subiao"],
  jt808_8801: ["jt808", "subiao"],
  jt808_8802: ["jt808", "subiao"],
  jt808_8803: ["jt808", "subiao"],
  jt808_8804: ["jt808", "subiao"],
  jt808_8805: ["jt808", "subiao"],
  record_audio: ["jt808", "subiao"],
  jt808_8700: ["jt808", "subiao"],
  jt808_8702: ["jt808", "subiao"],
  jt808_9101: ["jt808", "subiao"],
  jt808_9102: ["jt808", "subiao"],
  jt808_8301: ["jt808", "subiao"],
  jt808_8302: ["jt808", "subiao"],
  jt808_8303: ["jt808", "subiao"],
  jt808_8304: ["jt808", "subiao"],
  jt808_8400: ["jt808", "subiao"],
  jt808_8401: ["jt808", "subiao"],
  jt808_8900: ["jt808", "subiao"],
  event_set: ["jt808", "subiao"],
  question: ["jt808", "subiao"],
  info: ["jt808", "subiao"],
  info_menu: ["jt808", "subiao"],
  phone_callback: ["jt808", "subiao"],
  phonebook: ["jt808", "subiao"],
  geofence_del: ["jt808", "subiao"],
  geofence_set: ["jt808", "subiao"],
  geofence_query: ["jt808", "subiao"],
  route_set: ["jt808", "subiao"],
  route_del: ["jt808", "subiao"],
  av_live: ["jt808", "subiao"],
  av_control: ["jt808", "subiao"],
  alarm_confirm: ["jt808", "subiao"],
  multimedia_retrieve: ["jt808", "subiao"],
  multimedia_upload: ["jt808", "subiao"],
  multimedia_control: ["jt808", "subiao"],
  transparent: ["jt808", "subiao"],
  teltonika_codec14: ["teltonika"],
  teltonika_codec13: ["teltonika"],
  jt808: ["jt808", "subiao"],
  terminal_control: ["jt808", "subiao"],
  param: ["jt808", "subiao"],
  control: ["jt808", "subiao"],
  vehicle_control: ["jt808", "subiao"],
  query_params: ["jt808", "subiao"],
  query_attrs: ["jt808", "subiao"],
  query_location: ["jt808", "subiao"],
  camera: ["jt808", "subiao"],
  track: ["jt808", "subiao"],
  driver_query: ["jt808", "subiao"],
  driving_record: ["jt808", "subiao"],
  link_detect: ["jt808", "subiao"],
  teltonika_codec12: ["teltonika"],
  concox_gprs: ["concox"],
  ruptela_sms: ["ruptela"],
  ruptela_105: ["ruptela"],
  ruptela_107: ["ruptela"],
  config: ["ruptela", "jt808", "subiao"],
  galileosky_text: ["galileosky"],
};

/** @returns {string} empty when ok, else human error */
export function commandTypeProtocolMismatch(protocol, commandType) {
  if (!commandType || commandType === "text" || commandType === "raw") return "";
  const allowed = COMMAND_TYPE_PROTOCOLS[commandType];
  if (!allowed) return "";
  if (allowed.includes(protocol)) return "";
  return `commandType ${commandType} is not valid for protocol ${protocol}`;
}

export function publicParamDef(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id || null,
    category: row.category,
    valueType: row.value_type,
    unit: row.unit || "",
    label: row.label || row.id,
    description: row.description || "",
    system: !row.tenant_id,
    eventClass: row.event_class || "none",
    raiseAlert: row.raise_alert === true,
    emitOn: row.emit_on || "event",
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

export async function listParamDefs(tenantId) {
  const rows = tenantId
    ? await dbQuery(
        `SELECT * FROM tracker_param_defs
         WHERE tenant_id IS NULL OR tenant_id = $1
         ORDER BY (tenant_id IS NOT NULL), category, id`,
        [tenantId],
      )
    : await dbQuery(`SELECT * FROM tracker_param_defs ORDER BY category, id`);
  return rows.rows.map(publicParamDef);
}

const PARAM_CATEGORIES = ["avl", "safety", "video", "other"];
const PARAM_VALUE_TYPES = ["bool", "number", "string"];

export async function createParamDef(tenantId, body) {
  const id = String(body.id || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "_")
    .slice(0, 64);
  if (!id || id.length < 2) {
    const err = new Error("Param id required (min 2 chars, a-z 0-9 _ . -)");
    err.status = 400;
    throw err;
  }
  const category = PARAM_CATEGORIES.includes(body.category) ? body.category : "other";
  const valueType = PARAM_VALUE_TYPES.includes(body.valueType) ? body.valueType : "number";
  try {
    const inserted = await dbQuery(
      `INSERT INTO tracker_param_defs (id, tenant_id, category, value_type, unit, label, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        id,
        tenantId,
        category,
        valueType,
        String(body.unit || "").trim().slice(0, 32),
        String(body.label || id).trim().slice(0, 120),
        String(body.description || "").trim().slice(0, 500),
      ],
    );
    return publicParamDef(inserted.rows[0]);
  } catch (e) {
    if (e && (e.code === "23505" || /unique/i.test(String(e.message)))) {
      const err = new Error(`Param id already exists: ${id}`);
      err.status = 409;
      throw err;
    }
    throw e;
  }
}

export async function updateParamDef(tenantId, paramId, body) {
  const existing = await dbQuery(
    `SELECT * FROM tracker_param_defs WHERE id = $1`,
    [paramId],
  );
  const row = existing.rows[0];
  if (!row) {
    const err = new Error("Param not found");
    err.status = 404;
    throw err;
  }
  if (!row.tenant_id || row.tenant_id !== tenantId) {
    const err = new Error("Only tenant-owned params can be edited");
    err.status = 403;
    throw err;
  }
  const category = PARAM_CATEGORIES.includes(body.category) ? body.category : row.category;
  const valueType = PARAM_VALUE_TYPES.includes(body.valueType) ? body.valueType : row.value_type;
  const updated = await dbQuery(
    `UPDATE tracker_param_defs
     SET category = $2, value_type = $3, unit = $4, label = $5, description = $6
     WHERE id = $1 AND tenant_id = $7
     RETURNING *`,
    [
      paramId,
      category,
      valueType,
      body.unit !== undefined ? String(body.unit).trim().slice(0, 32) : row.unit,
      body.label !== undefined ? String(body.label).trim().slice(0, 120) : row.label,
      body.description !== undefined
        ? String(body.description).trim().slice(0, 500)
        : row.description,
      tenantId,
    ],
  );
  return publicParamDef(updated.rows[0]);
}

export async function deleteParamDef(tenantId, paramId) {
  const deleted = await dbQuery(
    `DELETE FROM tracker_param_defs
     WHERE id = $1 AND tenant_id = $2
     RETURNING id`,
    [paramId, tenantId],
  );
  if (!deleted.rows[0]) {
    const err = new Error("Param not found or is a system seed (cannot delete)");
    err.status = 404;
    throw err;
  }
  await dbQuery(`DELETE FROM tracker_param_maps WHERE app_param_id = $1`, [paramId]);
  return true;
}

export async function updateProfile(tenantId, profileId, body) {
  const existing = await dbQuery(`SELECT * FROM tracker_device_profiles WHERE id = $1`, [
    profileId,
  ]);
  const row = existing.rows[0];
  if (!row) {
    const err = new Error("Profile not found");
    err.status = 404;
    throw err;
  }
  if (!row.tenant_id || row.tenant_id !== tenantId) {
    const err = new Error("Only tenant-owned profiles can be edited");
    err.status = 403;
    throw err;
  }
  const name =
    body.name !== undefined ? String(body.name).trim().slice(0, 120) : row.name;
  if (!name) {
    const err = new Error("Profile name required");
    err.status = 400;
    throw err;
  }
  const updated = await dbQuery(
    `UPDATE tracker_device_profiles
     SET name = $2, model = $3, notes = $4, completeness = $5, updated_at = now()
     WHERE id = $1 AND tenant_id = $6
     RETURNING *`,
    [
      profileId,
      name,
      body.model !== undefined ? String(body.model).trim().slice(0, 80) : row.model,
      body.notes !== undefined ? String(body.notes).trim().slice(0, 500) : row.notes,
      ["mvp", "partial", "certified", "experimental"].includes(body.completeness)
        ? body.completeness
        : row.completeness,
      tenantId,
    ],
  );
  return publicProfile(updated.rows[0]);
}

export async function deleteProfile(tenantId, profileId) {
  const deleted = await dbQuery(
    `DELETE FROM tracker_device_profiles
     WHERE id = $1 AND tenant_id = $2
     RETURNING id`,
    [profileId, tenantId],
  );
  if (!deleted.rows[0]) {
    const err = new Error("Profile not found or is a system seed (cannot delete)");
    err.status = 404;
    throw err;
  }
  return true;
}

export async function cloneProfile(tenantId, sourceProfileId, body = {}) {
  const src = await dbQuery(`SELECT * FROM tracker_device_profiles WHERE id = $1`, [
    sourceProfileId,
  ]);
  const row = src.rows[0];
  if (!row) {
    const err = new Error("Source profile not found");
    err.status = 404;
    throw err;
  }
  if (row.tenant_id && row.tenant_id !== tenantId) {
    const err = new Error("Cannot clone another tenant profile");
    err.status = 403;
    throw err;
  }
  const name =
    String(body.name || `${row.name} (copy)`).trim().slice(0, 120) || `${row.name} (copy)`;
  const inserted = await dbQuery(
    `INSERT INTO tracker_device_profiles (tenant_id, name, protocol, model, completeness, notes)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [
      tenantId,
      name,
      row.protocol,
      body.model !== undefined ? String(body.model).trim().slice(0, 80) : row.model,
      row.completeness || "mvp",
      body.notes !== undefined ? String(body.notes).trim().slice(0, 500) : row.notes,
    ],
  );
  const profile = publicProfile(inserted.rows[0]);
  await dbQuery(
    `INSERT INTO tracker_param_maps (profile_id, vendor_key, app_param_id, transform, transform_arg, enabled)
     SELECT $1, vendor_key, app_param_id, transform, transform_arg, enabled
     FROM tracker_param_maps WHERE profile_id = $2`,
    [profile.id, sourceProfileId],
  );
  return profile;
}

export async function listTerminalEvents(tenantId, { deviceId, limit = 40 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 40, 1), 200);
  const params = [tenantId];
  let deviceClause = "";
  if (deviceId) {
    params.push(deviceId);
    deviceClause = ` AND vf.device_id = $${params.length}`;
  }
  params.push(lim);
  // Registered uplink fixes for this tenant…
  const fixRows = await dbQuery(
    `SELECT vf.device_id::text AS device_id, vf.recorded_at, vf.lat, vf.lon, vf.speed, vf.heading,
            vf.ignition, vf.source_protocol, vf.raw_attrs, vf.mapped_attrs,
            d.imei, d.label, d.protocol AS device_protocol,
            'fix'::text AS kind, NULL::text AS remote
     FROM vehicle_fixes vf
     JOIN tracker_devices d ON d.id = vf.device_id
     WHERE vf.tenant_id = $1${deviceClause}
     ORDER BY vf.recorded_at DESC
     LIMIT $${params.length}`,
    params,
  );
  /** @type {Array<Record<string, unknown>>} */
  let merged = fixRows.rows.map((r) => ({
    kind: "fix",
    deviceId: r.device_id,
    imei: r.imei,
    label: r.label || "",
    protocol: r.source_protocol || r.device_protocol || "",
    recordedAt: r.recorded_at,
    lat: r.lat != null ? Number(r.lat) : null,
    lon: r.lon != null ? Number(r.lon) : null,
    speed: r.speed != null ? Number(r.speed) : null,
    heading: r.heading != null ? Number(r.heading) : null,
    ignition: r.ignition,
    remote: null,
    rawAttrs: r.raw_attrs || {},
    mappedAttrs: r.mapped_attrs || {},
  }));

  // …plus unregistered gateway connection attempts (global quarantine log).
  // Skip when filtering to a registered device id.
  if (!deviceId) {
    try {
      const evRows = await dbQuery(
        `SELECT id::text AS event_id, kind, imei, protocol, remote, detail, created_at
         FROM tracker_gateway_events
         WHERE kind IN ('unknown_imei', 'unknown_imei_rate_limited')
         ORDER BY created_at DESC
         LIMIT $1`,
        [lim],
      );
      for (const r of evRows.rows) {
        merged.push({
          kind: "unregistered",
          eventId: r.event_id,
          deviceId: null,
          imei: r.imei || "",
          label: "",
          protocol: r.protocol || "",
          recordedAt: r.created_at,
          lat: null,
          lon: null,
          speed: null,
          heading: null,
          ignition: null,
          remote: r.remote || null,
          rawAttrs: r.detail || {},
          mappedAttrs: {},
        });
      }
    } catch {
      // Migration 184 not applied yet — fall through to quarantine snapshot.
    }
    // Also surface current quarantine rows (covers hits before event logging existed).
    const qRows = await dbQuery(
      `SELECT imei, protocol, last_remote, hit_count, last_seen_at
       FROM tracker_unassigned
       ORDER BY last_seen_at DESC
       LIMIT $1`,
      [lim],
    );
    const seenImei = new Set(
      merged.filter((e) => e.kind === "unregistered" && e.imei).map((e) => String(e.imei)),
    );
    for (const r of qRows.rows) {
      const imei = String(r.imei || "");
      if (!imei || seenImei.has(imei)) continue;
      seenImei.add(imei);
      merged.push({
        kind: "unregistered",
        eventId: `unassigned:${imei}`,
        deviceId: null,
        imei,
        label: "",
        protocol: r.protocol || "",
        recordedAt: r.last_seen_at,
        lat: null,
        lon: null,
        speed: null,
        heading: null,
        ignition: null,
        remote: r.last_remote || null,
        rawAttrs: { hitCount: r.hit_count, source: "tracker_unassigned" },
        mappedAttrs: {},
      });
    }
    merged.sort((a, b) => {
      const ta = a.recordedAt ? new Date(a.recordedAt).getTime() : 0;
      const tb = b.recordedAt ? new Date(b.recordedAt).getTime() : 0;
      return tb - ta;
    });
    merged = merged.slice(0, lim);
  }

  return merged;
}

export function formatParamValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Opaque AVL dumps — never promote into mapper “live values” unless includeRaw. */
function isOpaqueVendorKey(key) {
  const k = String(key || "");
  return (
    k.startsWith("io.") ||
    k.startsWith("tag.") ||
    k.startsWith("add.") ||
    k.startsWith("avl.") ||
    k.startsWith("0x")
  );
}

/**
 * Flatten one fix’s typed + mapped (+ optional raw) into Admin/Fleet Live param rows.
 * Same filter rules as listDeviceParamValues.
 */
export function flattenFixParamRows({
  deviceId,
  imei = "",
  label = "",
  protocol = "",
  lat = null,
  lon = null,
  speed = null,
  heading = null,
  ignition = null,
  recordedAt = null,
  mappedAttrs = {},
  rawAttrs = {},
  defById = new Map(),
  protoKeys = new Map(),
  includeRaw = false,
}) {
  /** @type {Array<Record<string, unknown>>} */
  const rows = [];
  /** @type {Set<string>} */
  const emitted = new Set();
  const updatedAt = recordedAt;
  const mapped =
    mappedAttrs && typeof mappedAttrs === "object" && !Array.isArray(mappedAttrs) ? mappedAttrs : {};
  const raw = rawAttrs && typeof rawAttrs === "object" && !Array.isArray(rawAttrs) ? rawAttrs : {};

  const typed = [
    ["lat", lat != null ? Number(lat) : null, "Latitude (°)", "position"],
    ["lon", lon != null ? Number(lon) : null, "Longitude (°)", "position"],
    ["speed", speed != null ? Number(speed) : null, "Speed (km/h)", "position"],
    ["heading", heading != null ? Number(heading) : null, "Heading / GPS Angle (°)", "position"],
    ["ignition", ignition == null ? null : Boolean(ignition), "Ignition", "avl"],
  ];
  for (const [paramId, value, fallbackLabel, category] of typed) {
    if (value === null) continue;
    const def = defById.get(paramId);
    emitted.add(paramId);
    rows.push({
      deviceId,
      imei,
      label,
      protocol,
      paramId,
      paramLabel: def?.label || fallbackLabel || paramId,
      category: def?.category || category || "position",
      unit: def?.unit || "",
      value: formatParamValue(formatAvlParamValue(paramId, value)),
      source: "typed",
      updatedAt,
    });
  }

  for (const [paramId, value] of Object.entries(mapped)) {
    if (value === null || value === undefined) continue;
    if (paramId === "tags" || paramId === "io" || typeof value === "object") continue;
    if (isOpaqueVendorKey(paramId)) continue;
    if (emitted.has(paramId)) continue;
    const def = defById.get(paramId);
    emitted.add(paramId);
    rows.push({
      deviceId,
      imei,
      label,
      protocol,
      paramId,
      paramLabel: def?.label || protoKeys.get(paramId) || paramId,
      category: def?.category || "mapped",
      unit: def?.unit || "",
      value: formatParamValue(formatAvlParamValue(paramId, value)),
      source: def ? "mapped" : "mapped_extra",
      updatedAt,
    });
  }

  for (const [vendorKey, value] of Object.entries(raw)) {
    if (value === null || value === undefined) continue;
    if (vendorKey === "tags" || vendorKey === "io" || typeof value === "object") continue;
    if (emitted.has(vendorKey)) continue;
    if (isOpaqueVendorKey(vendorKey)) continue;
    const def = defById.get(vendorKey);
    const protoLabel = protoKeys.get(vendorKey);
    const isCooked = Boolean(def) || protoLabel != null || vendorKey.includes(".");
    if (!isCooked) continue;
    emitted.add(vendorKey);
    rows.push({
      deviceId,
      imei,
      label,
      protocol,
      paramId: vendorKey,
      paramLabel: def?.label || protoLabel || vendorKey,
      category: def?.category || "mapped",
      unit: def?.unit || "",
      value: formatParamValue(formatAvlParamValue(vendorKey, value)),
      source: def ? "mapped" : "mapped_extra",
      updatedAt,
    });
  }

  if (includeRaw) {
    for (const [vendorKey, value] of Object.entries(raw)) {
      if (value === null || value === undefined) continue;
      if (vendorKey === "tags" || typeof value === "object") continue;
      if (emitted.has(vendorKey)) continue;
      rows.push({
        deviceId,
        imei,
        label,
        protocol,
        paramId: vendorKey,
        paramLabel: vendorKey,
        category: "raw",
        unit: "",
        value: formatParamValue(formatAvlParamValue(vendorKey, value)),
        source: "raw",
        updatedAt,
      });
    }
  }

  return rows;
}

/**
 * Params for one historical vehicle_fixes row (Fleet Live History click).
 */
export async function listFixParamValues(tenantId, { deviceId, recordedAt, includeRaw = false } = {}) {
  if (!deviceId || !recordedAt) {
    const err = new Error("deviceId and recordedAt required");
    err.status = 400;
    throw err;
  }
  const at = new Date(recordedAt);
  if (Number.isNaN(at.getTime())) {
    const err = new Error("Invalid recordedAt");
    err.status = 400;
    throw err;
  }
  const [fixRows, paramDefs, protocolParamRows] = await Promise.all([
    dbQuery(
      `SELECT d.id::text AS device_id, d.imei, d.label, d.protocol,
              vf.lat, vf.lon, vf.speed, vf.heading, vf.ignition, vf.recorded_at,
              vf.raw_attrs, vf.mapped_attrs
       FROM tracker_devices d
       JOIN vehicle_fixes vf ON vf.device_id = d.id
       WHERE d.tenant_id = $1 AND d.id = $2::uuid
         AND vf.recorded_at >= $3::timestamptz - interval '2 seconds'
         AND vf.recorded_at <= $3::timestamptz + interval '2 seconds'
       ORDER BY abs(extract(epoch from (vf.recorded_at - $3::timestamptz))) ASC
       LIMIT 1`,
      [tenantId, deviceId, at.toISOString()],
    ),
    listParamDefs(tenantId),
    dbQuery(`SELECT protocol, vendor_key, label FROM tracker_protocol_params`),
  ]);
  const row = fixRows.rows[0];
  if (!row) {
    return { params: paramDefs, rows: [], recordedAt: null };
  }
  const defById = new Map(paramDefs.map((p) => [p.id, p]));
  const protoKeys = new Map();
  for (const r of protocolParamRows.rows) {
    if (String(r.protocol || "") !== String(row.protocol || "")) continue;
    protoKeys.set(String(r.vendor_key), String(r.label || r.vendor_key));
  }
  const recorded = row.recorded_at ? new Date(row.recorded_at).toISOString() : null;
  return {
    params: paramDefs,
    recordedAt: recorded,
    rows: flattenFixParamRows({
      deviceId: row.device_id,
      imei: row.imei || "",
      label: row.label || "",
      protocol: row.protocol || "",
      lat: row.lat,
      lon: row.lon,
      speed: row.speed,
      heading: row.heading,
      ignition: row.ignition,
      recordedAt: recorded,
      mappedAttrs: row.mapped_attrs,
      rawAttrs: row.raw_attrs,
      defById,
      protoKeys,
      includeRaw,
    }),
  };
}

/**
 * Flat table rows: one device × app-param (or raw vendor key) with latest value.
 * Used by Admin "Live values" tab.
 */
export async function listDeviceParamValues(tenantId, { deviceId, includeRaw = false } = {}) {
  const params = [tenantId];
  let deviceClause = "";
  if (deviceId) {
    params.push(deviceId);
    deviceClause = ` AND d.id = $${params.length}`;
  }
  const [deviceRows, paramDefs, protocolParamRows] = await Promise.all([
    dbQuery(
      `SELECT d.id::text AS device_id, d.imei, d.label, d.protocol, d.last_seen_at,
              lf.lat, lf.lon, lf.speed, lf.heading, lf.ignition, lf.recorded_at,
              lf.raw_attrs, lf.mapped_attrs, lf.updated_at AS last_fix_updated_at
       FROM tracker_devices d
       LEFT JOIN vehicle_last_fix lf ON lf.device_id = d.id
       WHERE d.tenant_id = $1${deviceClause}
       ORDER BY lower(COALESCE(NULLIF(d.label, ''), d.imei)) ASC`,
      params,
    ),
    listParamDefs(tenantId),
    dbQuery(`SELECT protocol, vendor_key, label FROM tracker_protocol_params`),
  ]);
  const defById = new Map(paramDefs.map((p) => [p.id, p]));
  /** @type {Map<string, Map<string, string>>} */
  const protocolVendors = new Map();
  for (const r of protocolParamRows.rows) {
    const proto = String(r.protocol || "");
    if (!protocolVendors.has(proto)) protocolVendors.set(proto, new Map());
    protocolVendors.get(proto).set(String(r.vendor_key), String(r.label || r.vendor_key));
  }
  /** @type {Array<Record<string, unknown>>} */
  const rows = [];

  for (const d of deviceRows.rows) {
    const protocol = d.protocol || "";
    const protoKeys = protocolVendors.get(protocol) || new Map();
    const updatedAt = d.last_fix_updated_at || d.recorded_at || d.last_seen_at || null;
    rows.push(
      ...flattenFixParamRows({
        deviceId: d.device_id,
        imei: d.imei || "",
        label: d.label || "",
        protocol,
        lat: d.lat,
        lon: d.lon,
        speed: d.speed,
        heading: d.heading,
        ignition: d.ignition,
        recordedAt: updatedAt,
        mappedAttrs: d.mapped_attrs,
        rawAttrs: d.raw_attrs,
        defById,
        protoKeys,
        includeRaw,
      }),
    );
  }

  return { params: paramDefs, rows };
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
  const hexRaw = String(body.payloadHex || body.hex || "").replace(/[^0-9a-fA-F]/g, "");
  if (hexRaw.length % 2 === 1) {
    const err = new Error("payloadHex must have an even number of hex digits");
    err.status = 400;
    throw err;
  }
  const protocol = device.rows[0].protocol;
  let commandType = [
    "raw",
    "text",
    "jt808",
    "jt808_8103",
    "jt808_8104",
    "jt808_8105",
    "jt808_8106",
    "jt808_8107",
    "jt808_8108",
    "jt808_8201",
    "jt808_8202",
    "jt808_8203",
    "jt808_8204",
    "jt808_8500",
    "jt808_8600",
    "jt808_8601",
    "jt808_8602",
    "jt808_8603",
    "jt808_8604",
    "jt808_8605",
    "jt808_8606",
    "jt808_8607",
    "jt808_8608",
    "jt808_8801",
    "jt808_8802",
    "jt808_8803",
    "jt808_8804",
    "jt808_8805",
    "jt808_8700",
    "jt808_8702",
    "jt808_9101",
    "jt808_9102",
    "jt808_8301",
    "jt808_8302",
    "jt808_8303",
    "jt808_8304",
    "jt808_8400",
    "jt808_8401",
    "jt808_8900",
    "terminal_control",
    "terminal_upgrade",
    "teltonika_codec12",
    "teltonika_codec13",
    "teltonika_codec14",
    "concox_gprs",
    "ruptela_sms",
    "ruptela_105",
    "ruptela_107",
    "galileosky_text",
    "param",
    "control",
    "vehicle_control",
    "query_params",
    "query_param_ids",
    "query_attrs",
    "query_location",
    "config",
    "camera",
    "multimedia_retrieve",
    "multimedia_control",
    "record_audio",
    "track",
    "driver_query",
    "driving_record",
    "link_detect",
    "geofence_del",
    "geofence_set",
    "geofence_query",
    "route_set",
    "route_del",
    "av_live",
    "av_control",
    "alarm_confirm",
    "event_set",
    "question",
    "info",
    "info_menu",
    "phone_callback",
    "phonebook",
    "multimedia_upload",
    "transparent",
  ].includes(body.commandType)
    ? body.commandType
    : "text";
  const mismatch = commandTypeProtocolMismatch(protocol, commandType);
  if (mismatch) {
    const err = new Error(mismatch);
    err.status = 400;
    throw err;
  }
  const inserted = await dbQuery(
    `INSERT INTO tracker_commands (
       tenant_id, device_id, protocol, command_type, payload_text, payload_hex, status
     ) VALUES ($1,$2,$3,$4,$5,$6,'pending') RETURNING *`,
    [
      tenantId,
      deviceId,
      protocol,
      commandType,
      String(body.payloadText || body.text || "").slice(0, 4000),
      hexRaw.slice(0, 8000),
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
    payloadHex: r.payload_hex || "",
    responseText: r.response_text,
    corrId: r.corr_id || "",
    createdAt: r.created_at,
    sentAt: r.sent_at,
    completedAt: r.completed_at,
  }));
}

/** Cancel a pending (or unsent) command; sent commands cannot be pulled back from the wire. */
export async function cancelCommand(tenantId, deviceId, commandId) {
  const updated = await dbQuery(
    `UPDATE tracker_commands
     SET status = 'failed',
         response_text = 'cancelled by admin',
         completed_at = now()
     WHERE tenant_id = $1 AND device_id = $2 AND id = $3
       AND status = 'pending'
     RETURNING id, status`,
    [tenantId, deviceId, commandId],
  );
  if (!updated.rows[0]) {
    const err = new Error("Pending command not found (already sent or completed)");
    err.status = 404;
    throw err;
  }
  return { id: updated.rows[0].id, status: updated.rows[0].status };
}

/**
 * Classify safety / multimedia event as picture | video | audio | other.
 * Uses mapped media_kind / media_type (JT808) and attachment hints.
 */
export function classifySafetyMediaKind(row) {
  const mapped =
    row.mapped_attrs && typeof row.mapped_attrs === "object" && !Array.isArray(row.mapped_attrs)
      ? row.mapped_attrs
      : {};
  const kind = String(mapped.media_kind || mapped.mediaKind || "")
    .trim()
    .toLowerCase();
  if (kind === "picture" || kind === "image" || kind === "photo" || kind === "jpg" || kind === "jpeg") {
    return "picture";
  }
  if (kind === "video" || kind === "clip" || kind === "mp4") return "video";
  if (kind === "audio" || kind === "sound") return "audio";

  const mediaType = Number(mapped.media_type ?? mapped.mediaType);
  // JT808 0x0801 media_type: 0 image, 1 audio, 2 video
  if (mediaType === 0) return "picture";
  if (mediaType === 1) return "audio";
  if (mediaType === 2) return "video";

  const alarm = String(row.alarm_type || "").toLowerCase();
  if (/photo|picture|image|snapshot|camera/.test(alarm)) return "picture";
  if (/video|clip|dvr|mdvr/.test(alarm)) return "video";
  if (/audio|voice|mic/.test(alarm)) return "audio";

  const att = String(row.attachment_id || "").toLowerCase();
  if (/\.(jpe?g|png|gif|webp)(\?|$)/.test(att)) return "picture";
  if (/\.(mp4|webm|mov|mkv)(\?|$)/.test(att)) return "video";
  if (/\.(mp3|wav|aac|ogg)(\?|$)/.test(att)) return "audio";

  if (att || mapped.media_id != null || mapped.media_hex || mapped.media_channel != null) {
    return "picture"; // default multimedia event → pictures tab
  }
  return "other";
}

export function safetyEventHasMedia(row) {
  const kind = classifySafetyMediaKind(row);
  if (kind !== "other") return true;
  const mapped =
    row.mapped_attrs && typeof row.mapped_attrs === "object" && !Array.isArray(row.mapped_attrs)
      ? row.mapped_attrs
      : {};
  return Boolean(
    (row.attachment_id && String(row.attachment_id).trim()) ||
      mapped.media_id != null ||
      mapped.media_hex ||
      mapped.media_channel != null ||
      mapped.media_type != null,
  );
}

export async function listSafetyEvents(
  tenantId,
  { deviceId, groupIds, from, to, mediaOnly = false, limit = 50 } = {},
) {
  const lim = Math.min(Number(limit) || 50, 500);
  const groups = Array.isArray(groupIds) ? groupIds.filter(Boolean) : [];
  const params = [tenantId];
  const where = ["e.tenant_id = $1"];

  if (deviceId) {
    params.push(deviceId);
    where.push(`e.device_id = $${params.length}`);
  }
  if (groups.length) {
    params.push(groups);
    where.push(
      `EXISTS (
         SELECT 1 FROM tracker_device_group_members m
         WHERE m.device_id = e.device_id AND m.group_id = ANY($${params.length}::uuid[])
       )`,
    );
  }
  if (from) {
    const ms = Date.parse(from);
    if (Number.isFinite(ms)) {
      params.push(new Date(ms).toISOString());
      where.push(`e.recorded_at >= $${params.length}::timestamptz`);
    }
  }
  if (to) {
    const ms = Date.parse(to);
    if (Number.isFinite(ms)) {
      params.push(new Date(ms).toISOString());
      where.push(`e.recorded_at <= $${params.length}::timestamptz`);
    }
  }

  params.push(lim);
  const rows = await dbQuery(
    `SELECT e.*, vf.mapped_attrs AS fix_mapped, vf.raw_attrs AS fix_raw
     FROM tracker_safety_events e
     LEFT JOIN LATERAL (
       SELECT mapped_attrs, raw_attrs
       FROM vehicle_fixes vf
       WHERE vf.tenant_id = e.tenant_id
         AND vf.device_id = e.device_id
         AND vf.recorded_at BETWEEN e.recorded_at - interval '2 seconds'
                                AND e.recorded_at + interval '2 seconds'
       ORDER BY abs(extract(epoch from (vf.recorded_at - e.recorded_at)))
       LIMIT 1
     ) vf ON true
     WHERE ${where.join(" AND ")}
     ORDER BY e.recorded_at DESC
     LIMIT $${params.length}`,
    params,
  );

  const filtered = mediaOnly ? rows.rows.filter((r) => safetyEventHasMedia(r)) : rows.rows;
  const toDto = (r, cls) => ({
    id: String(r.id),
    deviceId: r.device_id,
    recordedAt: r.recorded_at,
    alarmType: r.alarm_type,
    alarmLevel: r.alarm_level,
    lat: r.lat == null ? null : Number(r.lat),
    lon: r.lon == null ? null : Number(r.lon),
    attachmentId: r.attachment_id || "",
    sourceProtocol: r.source_protocol,
    rawAttrs: {
      ...(r.raw_attrs && typeof r.raw_attrs === "object" && !Array.isArray(r.raw_attrs)
        ? r.raw_attrs
        : {}),
      ...mergeAvlEventAttrs(r.fix_raw, r.fix_mapped, r.mapped_attrs, r.raw_attrs),
    },
    mappedAttrs: r.mapped_attrs,
    mediaKind: classifySafetyMediaKind(r),
    eventClass: cls.eventClass,
    raiseAlert: cls.raiseAlert,
    emitOn: cls.emitOn,
  });
  try {
    const { loadEventClassIndex, resolveEventClass } = await import("./event-class.mjs");
    const classIndex = await loadEventClassIndex(tenantId);
    return filtered.map((r) =>
      toDto(r, resolveEventClass(classIndex, r.alarm_type, { deviceId: r.device_id })),
    );
  } catch {
    const { classifyAlarmType } = await import("./event-class.mjs").catch(() => ({
      classifyAlarmType: () => ({ eventClass: "warning", raiseAlert: true, emitOn: "event" }),
    }));
    return filtered.map((r) => toDto(r, classifyAlarmType(r.alarm_type)));
  }
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
