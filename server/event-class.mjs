import { dbQuery } from "./db.mjs";

export const EVENT_CLASSES = ["safety", "warning", "asset", "none"];
export const EVENT_EMIT_ON = ["event", "rising", "falling", "change", "none"];

const SAFETY = { eventClass: "safety", raiseAlert: true, emitOn: "event" };
const WARNING = { eventClass: "warning", raiseAlert: true, emitOn: "event" };
const ASSET_CHANGE = { eventClass: "asset", raiseAlert: false, emitOn: "change" };
const ASSET_EVENT = { eventClass: "asset", raiseAlert: false, emitOn: "event" };
const NONE = { eventClass: "none", raiseAlert: false, emitOn: "none" };

export const DEFAULT_EVENT_CLASS_BY_TYPE = {
  green_driving: { ...SAFETY, label: "Green driving" },
  overspeed: { ...SAFETY, label: "Overspeed" },
  crash: { ...SAFETY, label: "Crash" },
  impact: { ...SAFETY, label: "Impact" },
  tilt: { ...SAFETY, label: "Tilt" },
  harsh_brake: { ...SAFETY, label: "Harsh brake" },
  harsh_accel: { ...SAFETY, label: "Harsh acceleration" },
  harsh_corner: { ...SAFETY, label: "Harsh corner" },
  ignition: { ...ASSET_CHANGE, label: "Ignition" },
  movement: { ...ASSET_CHANGE, label: "Movement" },
  trip: { ...ASSET_EVENT, label: "Trip" },
  door: { ...ASSET_EVENT, label: "Door" },
  idling: { ...ASSET_EVENT, label: "Idling" },
  geofence: { ...ASSET_EVENT, label: "Geofence" },
  autogeofence: { ...ASSET_EVENT, label: "Auto geofence" },
  power_ext: { ...WARNING, label: "External power" },
  unplug: { ...WARNING, label: "Unplug" },
  jamming: { ...WARNING, label: "Jamming" },
  gnss_antenna: { ...WARNING, label: "GNSS antenna" },
  battery_low: { ...WARNING, label: "Battery low" },
  towing: { ...WARNING, label: "Towing" },
  sos: { ...WARNING, label: "SOS" },
  fuel_theft: { ...WARNING, label: "Fuel theft" },
  sim_missing: { ...WARNING, label: "SIM missing" },
  ext_voltage: { ...WARNING, label: "External voltage" },
  bus_voltage: { ...WARNING, label: "Bus voltage" },
  video_loss: { ...NONE, label: "Video loss" },
  video_lost: { ...NONE, label: "Video lost" },
  snapshot: { ...NONE, label: "Snapshot" },
  photo: { ...NONE, label: "Photo" },
  media: { ...NONE, label: "Media" },
};

export function normalizeAlarmType(type) {
  return String(type || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function seedClassify(alarmType) {
  const key = normalizeAlarmType(alarmType);
  const seeded = DEFAULT_EVENT_CLASS_BY_TYPE[key];
  if (seeded) return { ...seeded, alarmType: key };
  if (key.startsWith("harsh_") || key.startsWith("adas_") || key.startsWith("dsm_")) {
    return { ...SAFETY, alarmType: key, label: alarmType || key };
  }
  if (key.includes("video") || key.includes("photo") || key.includes("snapshot")) {
    return { ...NONE, alarmType: key, label: alarmType || key };
  }
  return { ...WARNING, alarmType: key, label: alarmType || key };
}

export function classifyAlarmType(alarmType, override) {
  const base = seedClassify(alarmType);
  if (!override) return base;
  return {
    ...base,
    eventClass: EVENT_CLASSES.includes(override.eventClass) ? override.eventClass : base.eventClass,
    raiseAlert:
      override.raiseAlert == null
        ? override.eventClass === "safety" || override.eventClass === "warning"
        : Boolean(override.raiseAlert),
    emitOn: EVENT_EMIT_ON.includes(override.emitOn) ? override.emitOn : base.emitOn,
    label: override.label || base.label,
  };
}

export function publicEventMap(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id || null,
    profileId: row.profile_id || null,
    deviceId: row.device_id || null,
    alarmType: row.alarm_type,
    eventClass: row.event_class,
    raiseAlert: row.raise_alert !== false,
    emitOn: row.emit_on || "event",
    label: row.label || row.alarm_type,
  };
}

export async function listEventTypeCatalog() {
  try {
    const rows = await dbQuery(
      `SELECT alarm_type, label, event_class, raise_alert, emit_on
       FROM tracker_event_type_defs
       ORDER BY event_class, alarm_type`,
    );
    if (rows.rows.length) {
      return rows.rows.map((r) => ({
        alarmType: r.alarm_type,
        label: r.label || r.alarm_type,
        eventClass: r.event_class,
        raiseAlert: r.raise_alert !== false,
        emitOn: r.emit_on || "event",
      }));
    }
  } catch {
    /* table may not exist mid-migrate */
  }
  return Object.entries(DEFAULT_EVENT_CLASS_BY_TYPE).map(([alarmType, info]) => ({
    alarmType,
    label: info.label || alarmType,
    eventClass: info.eventClass,
    raiseAlert: info.raiseAlert,
    emitOn: info.emitOn,
  }));
}

export async function listEventClassMaps({ tenantId, profileId, deviceId } = {}) {
  try {
    const params = [];
    const where = [];
    if (deviceId) {
      params.push(deviceId);
      where.push(`device_id = $${params.length}`);
    } else if (profileId) {
      params.push(profileId);
      where.push(`profile_id = $${params.length} AND device_id IS NULL`);
    } else if (tenantId) {
      params.push(tenantId);
      where.push(`tenant_id = $${params.length} AND profile_id IS NULL AND device_id IS NULL`);
    } else {
      return [];
    }
    const rows = await dbQuery(
      `SELECT * FROM tracker_event_class_maps WHERE ${where.join(" AND ")} ORDER BY alarm_type`,
      params,
    );
    return rows.rows.map(publicEventMap);
  } catch {
    return [];
  }
}

export async function loadEventClassIndex(tenantId) {
  const catalog = await listEventTypeCatalog();
  const byType = new Map(catalog.map((c) => [c.alarmType, c]));
  /** @type {Map<string, any[]>} */
  const byDevice = new Map();
  /** @type {Map<string, any[]>} */
  const byProfile = new Map();
  /** @type {Map<string, any>} */
  const byTenant = new Map();
  try {
    const rows = await dbQuery(
      `SELECT * FROM tracker_event_class_maps
       WHERE tenant_id = $1 OR tenant_id IS NULL`,
      [tenantId],
    );
    for (const r of rows.rows) {
      const mapped = publicEventMap(r);
      if (r.device_id) {
        const list = byDevice.get(r.device_id) || [];
        list.push(mapped);
        byDevice.set(r.device_id, list);
      } else if (r.profile_id) {
        const list = byProfile.get(r.profile_id) || [];
        list.push(mapped);
        byProfile.set(r.profile_id, list);
      } else if (r.tenant_id) {
        byTenant.set(r.alarm_type, mapped);
      }
    }
  } catch {
    /* ignore */
  }
  return { byType, byDevice, byProfile, byTenant };
}

export function resolveEventClass(index, alarmType, { deviceId, profileId } = {}) {
  const key = normalizeAlarmType(alarmType);
  const pick = (row) =>
    row
      ? {
          eventClass: row.eventClass,
          raiseAlert: row.raiseAlert,
          emitOn: row.emitOn,
          label: row.label,
          alarmType: key,
        }
      : null;
  if (deviceId) {
    const hit = (index.byDevice.get(deviceId) || []).find((m) => m.alarmType === key);
    if (hit) return pick(hit);
  }
  if (profileId) {
    const hit = (index.byProfile.get(profileId) || []).find((m) => m.alarmType === key);
    if (hit) return pick(hit);
  }
  const tenantHit = index.byTenant.get(key);
  if (tenantHit) return pick(tenantHit);
  const cat = index.byType.get(key);
  if (cat) return pick(cat);
  return classifyAlarmType(key);
}

function missingEventTableError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (/does not exist|undefined table|no such table/i.test(msg)) {
    const e = new Error("Event class tables missing. Run npm run db:migrate.");
    e.status = 503;
    return e;
  }
  return null;
}

export async function upsertEventClassMap(tenantId, body) {
  const alarmType = normalizeAlarmType(body.alarmType || body.alarm_type);
  if (!alarmType) {
    const err = new Error("alarmType required");
    err.status = 400;
    throw err;
  }
  const eventClass = EVENT_CLASSES.includes(body.eventClass) ? body.eventClass : "warning";
  const emitOn = EVENT_EMIT_ON.includes(body.emitOn) ? body.emitOn : "event";
  const raiseAlert =
    body.raiseAlert == null
      ? eventClass === "safety" || eventClass === "warning"
      : Boolean(body.raiseAlert);
  const deviceId = body.deviceId || body.device_id || null;
  const profileId = body.profileId || body.profile_id || null;
  if (!deviceId && !profileId && !tenantId) {
    const err = new Error("tenant, profile, or device required");
    err.status = 400;
    throw err;
  }
  try {
    const existing = await dbQuery(
      deviceId
        ? `SELECT id FROM tracker_event_class_maps WHERE device_id = $1 AND alarm_type = $2`
        : profileId
          ? `SELECT id FROM tracker_event_class_maps WHERE profile_id = $1 AND device_id IS NULL AND alarm_type = $2`
          : `SELECT id FROM tracker_event_class_maps WHERE tenant_id = $1 AND profile_id IS NULL AND device_id IS NULL AND alarm_type = $2`,
      [deviceId || profileId || tenantId, alarmType],
    );
    if (existing.rows[0]) {
      const updated = await dbQuery(
        `UPDATE tracker_event_class_maps
         SET event_class = $2, raise_alert = $3, emit_on = $4, updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [existing.rows[0].id, eventClass, raiseAlert, emitOn],
      );
      return publicEventMap(updated.rows[0]);
    }
    const inserted = await dbQuery(
      `INSERT INTO tracker_event_class_maps (
         tenant_id, profile_id, device_id, alarm_type, event_class, raise_alert, emit_on
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [tenantId, profileId, deviceId, alarmType, eventClass, raiseAlert, emitOn],
    );
    return publicEventMap(inserted.rows[0]);
  } catch (err) {
    throw missingEventTableError(err) || err;
  }
}

export async function deleteEventClassMap(mapId) {
  const deleted = await dbQuery(
    `DELETE FROM tracker_event_class_maps WHERE id = $1 RETURNING id`,
    [mapId],
  );
  if (!deleted.rows[0]) {
    const err = new Error("Event class map not found");
    err.status = 404;
    throw err;
  }
  return true;
}

function asBool(v) {
  if (v === true || v === false) return v;
  if (v === 1 || v === "1" || v === "true") return true;
  if (v === 0 || v === "0" || v === "false") return false;
  return null;
}

function attrBool(attrs, keys) {
  if (!attrs || typeof attrs !== "object") return null;
  for (const k of keys) {
    if (attrs[k] !== undefined && attrs[k] !== null) {
      const b = asBool(attrs[k]);
      if (b !== null) return b;
    }
  }
  return null;
}

function shouldEmit(emitOn, prev, next) {
  if (next === null || prev === next) return false;
  if (emitOn === "change") return prev !== null;
  if (emitOn === "rising") return prev === false && next === true;
  if (emitOn === "falling") return prev === true && next === false;
  return false;
}

/**
 * Insert Asset Events when ignition/movement edges according to Device Mapper emit_on.
 * Debounces against a row of the same type in the last 3 seconds (protocol-inserted events).
 */
export async function emitParamEdgeEvents(deviceRow, prevFix, nextFix) {
  if (!deviceRow?.id || !deviceRow.tenant_id) return;
  let index;
  try {
    index = await loadEventClassIndex(deviceRow.tenant_id);
  } catch {
    return;
  }
  const prevMapped = prevFix?.mapped_attrs || prevFix?.mappedAttrs || {};
  const nextMapped = nextFix?.mappedAttrs || nextFix?.mapped_attrs || {};
  const prevRaw = prevFix?.raw_attrs || prevFix?.rawAttrs || {};
  const nextRaw = nextFix?.rawAttrs || nextFix?.raw_attrs || {};

  const pairs = [
    {
      type: "ignition",
      prev: asBool(prevFix?.ignition) ?? attrBool(prevMapped, ["ignition"]) ?? attrBool(prevRaw, ["ignition", "status.ignition"]),
      next:
        asBool(nextFix?.ignition) ??
        attrBool(nextMapped, ["ignition"]) ??
        attrBool(nextRaw, ["ignition", "status.ignition"]),
    },
    {
      type: "movement",
      prev: attrBool(prevMapped, ["movement", "status.moving"]) ?? attrBool(prevRaw, ["movement", "status.moving"]),
      next: attrBool(nextMapped, ["movement", "status.moving"]) ?? attrBool(nextRaw, ["movement", "status.moving"]),
    },
  ];

  for (const pair of pairs) {
    const info = resolveEventClass(index, pair.type, {
      deviceId: deviceRow.id,
      profileId: deviceRow.profile_id,
    });
    if (!shouldEmit(info.emitOn, pair.prev, pair.next)) continue;
    try {
      const recent = await dbQuery(
        `SELECT id FROM tracker_safety_events
         WHERE device_id = $1 AND alarm_type = $2 AND recorded_at > now() - interval '3 seconds'
         LIMIT 1`,
        [deviceRow.id, pair.type],
      );
      if (recent.rows[0]) continue;
      const recordedAt = nextFix?.recordedAt || nextFix?.recorded_at || new Date();
      await dbQuery(
        `INSERT INTO tracker_safety_events (
           tenant_id, device_id, recorded_at, alarm_type, alarm_level, lat, lon,
           source_protocol, raw_attrs, mapped_attrs
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)`,
        [
          deviceRow.tenant_id,
          deviceRow.id,
          recordedAt instanceof Date ? recordedAt.toISOString() : recordedAt,
          pair.type,
          0,
          nextFix?.lat ?? null,
          nextFix?.lon ?? null,
          nextFix?.sourceProtocol || deviceRow.protocol || "json",
          JSON.stringify({ [pair.type]: pair.next, emit_on: info.emitOn }),
          JSON.stringify({ [pair.type]: pair.next }),
        ],
      );
    } catch {
      /* table may not exist */
    }
  }
}
