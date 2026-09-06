/**
 * Maintenance API (D0–D3) under /api/maintenance/*
 */
import crypto from "node:crypto";
import { databaseUrlConfigured, dbQuery } from "./db.mjs";
import { tenantFromRequest } from "./tenants.mjs";
import { securityHeaders } from "./proxy-lt.mjs";
import { getObject, objectStorageConfigured, putObject } from "./storage.mjs";
import { armadaFetch } from "./armada-fetch.mjs";
import {
  isPastDay,
  readCachedDay,
  tenantCacheScope,
  todayKeyFromOffset,
  writeCachedDay,
} from "./day-tracks-cache.mjs";
import { slimAsync } from "./slim-pool.mjs";
import { eachDateYmd, sumIgnitionOnHours } from "./ignition-hours.mjs";
import { evaluateKmInterval, findOdometerKmInStatus } from "./odometer-status.mjs";
import { canTransition, serviceDurationMinutes } from "./maintenance-lifecycle.mjs";

export { canTransition, serviceDurationMinutes } from "./maintenance-lifecycle.mjs";

const HOURS_LOOKBACK_DAYS = 90;
const DAY_FETCH_TIMEOUT_MS = 120_000;

const STATUSES = ["due", "in_progress", "done", "skipped"];
const LINE_KINDS = ["part", "labor", "other"];

function send(res, status, headers, body) {
  res.writeHead(status, securityHeaders(headers));
  res.end(body);
}

function json(res, status, obj) {
  send(
    res,
    status,
    {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    JSON.stringify(obj),
  );
}

/** @param {import('node:http').IncomingMessage} req */
function readBody(req, limit = 20_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("Body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Parse data URIs including charset params: data:image/jpeg;charset=utf-8;base64,... */
export function parseDataUrl(dataUrl) {
  const raw = String(dataUrl || "");
  const m = /^data:([^;,]+)?(?:;[^,]*)?;base64,([\s\S]+)$/i.exec(raw);
  if (!m) return null;
  const contentType = String(m[1] || "application/octet-stream").trim() || "application/octet-stream";
  const buffer = Buffer.from(String(m[2]).replace(/\s/g, ""), "base64");
  return { contentType, buffer };
}

async function readJson(req) {
  const raw = await readBody(req);
  const text = raw.toString("utf8");
  if (!text.trim()) return {};
  return JSON.parse(text);
}

export async function resolveDbTenant(req) {
  if (!databaseUrlConfigured()) return null;
  const fromHeader = tenantFromRequest(req);
  let key = fromHeader?.key || "";
  if (!key) {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      key = String(url.searchParams.get("k") || "").trim();
    } catch {
      key = "";
    }
  }
  if (!key) return null;
  const found = await dbQuery(
    `SELECT id, key FROM tenants WHERE key = $1 AND enabled = true`,
    [key],
  );
  const row = found.rows[0];
  if (!row) return null;
  return { id: row.id, key: row.key };
}

const SELECT_COLS = `id, status, title, notes, armada_user_id, armada_username, user_display_name,
  lat, lon, notification_id, started_at, ended_at, odometer_km,
  service_point_id, service_point_name, service_point_lat, service_point_lon,
  assigned_field_user_id,
  remind_due_at, remind_interval_days, remind_interval_km, remind_baseline_odometer_km,
  remind_interval_hours, remind_hours_since_at,
  remind_before_days, remind_before_km, remind_before_hours, parent_event_id,
  created_at, updated_at`;

export function publicLine(row) {
  const qty = Number(row.qty) || 0;
  const unitPrice = row.unit_price == null ? null : Number(row.unit_price);
  const unitCost = row.unit_cost == null ? null : Number(row.unit_cost);
  return {
    id: row.id,
    kind: row.kind,
    description: row.description || "",
    qty,
    unitPrice,
    unitCost,
    vendor: row.vendor || "",
    sortOrder: Number(row.sort_order) || 0,
    linePrice: unitPrice == null ? null : unitPrice * qty,
    lineCost: unitCost == null ? null : unitCost * qty,
  };
}

export function publicPhoto(row) {
  return {
    id: row.id,
    contentType: row.content_type || "",
    bytes: row.bytes == null ? null : Number(row.bytes),
    caption: row.caption || "",
    createdAt: row.created_at,
    url: `/api/maintenance/photos/${row.id}`,
  };
}

export function publicEvent(row, extras = {}) {
  const startedAt = row.started_at || null;
  const endedAt = row.ended_at || null;
  return {
    id: row.id,
    status: row.status,
    title: row.title || "",
    notes: row.notes || "",
    armadaUserId: row.armada_user_id == null ? null : Number(row.armada_user_id),
    armadaUsername: row.armada_username || "",
    userDisplayName: row.user_display_name || "",
    lat: row.lat == null ? null : Number(row.lat),
    lon: row.lon == null ? null : Number(row.lon),
    notificationId: row.notification_id || null,
    startedAt,
    endedAt,
    serviceDurationMinutes: serviceDurationMinutes(startedAt, endedAt),
    odometerKm: row.odometer_km == null ? null : Number(row.odometer_km),
    servicePointId: row.service_point_id || null,
    servicePointName: row.service_point_name || "",
    servicePointLat: row.service_point_lat == null ? null : Number(row.service_point_lat),
    servicePointLon: row.service_point_lon == null ? null : Number(row.service_point_lon),
    assignedFieldUserId: row.assigned_field_user_id || null,
    remindDueAt: row.remind_due_at || null,
    remindIntervalDays:
      row.remind_interval_days == null ? null : Number(row.remind_interval_days),
    remindIntervalKm:
      row.remind_interval_km == null ? null : Number(row.remind_interval_km),
    remindBaselineOdometerKm:
      row.remind_baseline_odometer_km == null ? null : Number(row.remind_baseline_odometer_km),
    remindIntervalHours:
      row.remind_interval_hours == null ? null : Number(row.remind_interval_hours),
    remindHoursSinceAt: row.remind_hours_since_at || null,
    remindBeforeDays: row.remind_before_days == null ? null : Number(row.remind_before_days),
    remindBeforeKm: row.remind_before_km == null ? null : Number(row.remind_before_km),
    remindBeforeHours: row.remind_before_hours == null ? null : Number(row.remind_before_hours),
    parentEventId: row.parent_event_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extras,
  };
}

/**
 * Work-order lifecycle (CMMS-style):
 *   due → in_progress (Start)
 *   in_progress → due (Cancel start, before Done)
 *   in_progress → done (Done; requires Start)
 *   due|in_progress → skipped
 *   done|skipped → due (Reopen — manager only)
 * Done is never allowed directly from due.
 */
// canTransition + serviceDurationMinutes imported from maintenance-lifecycle.mjs

export async function loadLines(eventId) {
  const rows = await dbQuery(
    `SELECT id, kind, description, qty, unit_price, unit_cost, vendor, sort_order
     FROM service_event_lines WHERE event_id = $1 ORDER BY sort_order ASC, created_at ASC`,
    [eventId],
  );
  return rows.rows.map(publicLine);
}

export async function loadPhotos(eventId) {
  const rows = await dbQuery(
    `SELECT id, content_type, bytes, caption, created_at
     FROM service_event_photos WHERE event_id = $1 ORDER BY created_at DESC`,
    [eventId],
  );
  return rows.rows.map(publicPhoto);
}

function rollup(lines) {
  let priceTotal = 0;
  let costTotal = 0;
  let hasPrice = false;
  let hasCost = false;
  for (const line of lines) {
    if (line.linePrice != null) {
      priceTotal += line.linePrice;
      hasPrice = true;
    }
    if (line.lineCost != null) {
      costTotal += line.lineCost;
      hasCost = true;
    }
  }
  return {
    priceTotal: hasPrice ? priceTotal : null,
    costTotal: hasCost ? costTotal : null,
  };
}

export async function loadEventDetail(tenantId, eventId) {
  const found = await dbQuery(
    `SELECT ${SELECT_COLS} FROM service_events WHERE id = $1 AND tenant_id = $2`,
    [eventId, tenantId],
  );
  const row = found.rows[0];
  if (!row) return null;
  const lines = await loadLines(eventId);
  const photos = await loadPhotos(eventId);
  return publicEvent(row, { lines, photos, ...rollup(lines) });
}

export async function replaceLines(eventId, linesInput) {
  const list = Array.isArray(linesInput) ? linesInput : [];
  await dbQuery(`DELETE FROM service_event_lines WHERE event_id = $1`, [eventId]);
  let i = 0;
  for (const raw of list) {
    const kind = LINE_KINDS.includes(String(raw.kind || "")) ? String(raw.kind) : "other";
    const description = String(raw.description || "").trim().slice(0, 500);
    const qty = Number(raw.qty);
    const unitPrice = raw.unitPrice == null || raw.unitPrice === "" ? null : Number(raw.unitPrice);
    const unitCost = raw.unitCost == null || raw.unitCost === "" ? null : Number(raw.unitCost);
    const vendor = String(raw.vendor || "").trim().slice(0, 200) || null;
    await dbQuery(
      `INSERT INTO service_event_lines (event_id, kind, description, qty, unit_price, unit_cost, vendor, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        eventId,
        kind,
        description,
        Number.isFinite(qty) && qty > 0 ? qty : 1,
        Number.isFinite(unitPrice) ? unitPrice : null,
        Number.isFinite(unitCost) ? unitCost : null,
        vendor,
        i,
      ],
    );
    i += 1;
  }
  return loadLines(eventId);
}

/**
 * @param {object} current
 * @param {object} body
 * @param {string} tenantId
 * @param {{ tenantKey?: string, vaultTenant?: { key: string, appId: number, token: string }, actor?: "field" | "manager" }} [opts]
 */
export async function applyEventPatch(current, body, tenantId, opts = {}) {
  const actor = opts.actor === "field" ? "field" : "manager";
  const prevStatus = current.status;

  if (actor === "field" && (prevStatus === "done" || prevStatus === "skipped")) {
    const err = new Error("Completed jobs can only be edited by a manager");
    err.status = 403;
    throw err;
  }

  let status = current.status;
  if (body.status !== undefined) {
    status = String(body.status || "").trim();
    if (!STATUSES.includes(status)) {
      const err = new Error(`status must be one of: ${STATUSES.join(", ")}`);
      err.status = 400;
      throw err;
    }
    if (!canTransition(current.status, status)) {
      const err = new Error(
        status === "done" && current.status === "due"
          ? "Start the job before marking Done"
          : `Cannot transition from ${current.status} to ${status}`,
      );
      err.status = 400;
      throw err;
    }
    if (actor === "field" && (status === "due") && prevStatus !== "in_progress" && prevStatus !== "due") {
      const err = new Error("Only a manager can reopen a completed job");
      err.status = 403;
      throw err;
    }
  }

  const title =
    body.title !== undefined ? String(body.title || "").trim().slice(0, 200) || current.title : current.title;
  const notes = body.notes !== undefined ? String(body.notes || "").trim() || null : current.notes;

  let startedAt = current.started_at;
  let endedAt = current.ended_at;
  if (status === "in_progress" && !startedAt) startedAt = new Date().toISOString();
  if (status === "due" && body.status !== undefined && prevStatus === "in_progress") {
    // Cancel start — clear clock so a later Start begins fresh service time.
    startedAt = null;
    endedAt = null;
  } else if (status === "due" && body.status !== undefined && (prevStatus === "done" || prevStatus === "skipped")) {
    // Manager reopen
    startedAt = null;
    endedAt = null;
  }
  if (status === "done") {
    // Heal jobs stuck in_progress without a clock (e.g. old Start bug cleared started_at).
    if (!startedAt && prevStatus === "in_progress") {
      startedAt = current.updated_at || new Date().toISOString();
    }
    if (!startedAt) {
      const err = new Error("Start the job before marking Done");
      err.status = 400;
      throw err;
    }
    if (prevStatus !== "done") endedAt = new Date().toISOString();
  } else if (status === "skipped" && prevStatus !== "skipped") {
    endedAt = new Date().toISOString();
  }

  // Manager may correct timestamps on a plain Save.
  // Never let empty form fields wipe the clock during Start / Done / Skip / Cancel.
  if (actor === "manager" && body.status === undefined) {
    if (body.startedAt !== undefined) {
      startedAt = body.startedAt ? new Date(String(body.startedAt)).toISOString() : null;
    }
    if (body.endedAt !== undefined) {
      endedAt = body.endedAt ? new Date(String(body.endedAt)).toISOString() : null;
    }
  } else if (actor === "manager") {
    if (body.startedAt) startedAt = new Date(String(body.startedAt)).toISOString();
    if (body.endedAt) endedAt = new Date(String(body.endedAt)).toISOString();
  }

  if (status === "done" && !startedAt) {
    const err = new Error("Start the job before marking Done");
    err.status = 400;
    throw err;
  }

  let odometerKm = current.odometer_km;
  if (body.odometerKm !== undefined) {
    const n = Number(body.odometerKm);
    odometerKm = Number.isFinite(n) ? n : null;
  }

  let servicePointId = current.service_point_id;
  let servicePointName = current.service_point_name;
  let servicePointLat = current.service_point_lat;
  let servicePointLon = current.service_point_lon;

  if (body.servicePointId !== undefined) {
    servicePointId = body.servicePointId || null;
    if (servicePointId) {
      const sp = await dbQuery(
        `SELECT id, name, lat, lon FROM service_points WHERE id = $1 AND tenant_id = $2`,
        [servicePointId, tenantId],
      );
      if (!sp.rows[0]) {
        const err = new Error("Service point not found");
        err.status = 404;
        throw err;
      }
      servicePointName = sp.rows[0].name;
      servicePointLat = sp.rows[0].lat;
      servicePointLon = sp.rows[0].lon;
    }
  }
  if (body.servicePointName !== undefined) {
    servicePointName = String(body.servicePointName || "").trim() || null;
  }
  if (body.servicePointLat !== undefined) {
    const n = Number(body.servicePointLat);
    servicePointLat = Number.isFinite(n) ? n : null;
  }
  if (body.servicePointLon !== undefined) {
    const n = Number(body.servicePointLon);
    servicePointLon = Number.isFinite(n) ? n : null;
  }

  // Upsert catalog when name + coords provided without id
  if (body.upsertServicePoint && servicePointName) {
    const existing = await dbQuery(
      `SELECT id FROM service_points WHERE tenant_id = $1 AND lower(name) = lower($2) LIMIT 1`,
      [tenantId, servicePointName],
    );
    if (existing.rows[0]) {
      servicePointId = existing.rows[0].id;
      await dbQuery(
        `UPDATE service_points SET lat = COALESCE($2, lat), lon = COALESCE($3, lon), updated_at = now() WHERE id = $1`,
        [servicePointId, servicePointLat, servicePointLon],
      );
    } else {
      const created = await dbQuery(
        `INSERT INTO service_points (tenant_id, name, lat, lon) VALUES ($1,$2,$3,$4) RETURNING id`,
        [tenantId, servicePointName, servicePointLat, servicePointLon],
      );
      servicePointId = created.rows[0].id;
    }
  }

  const prevAssigned = current.assigned_field_user_id || null;
  let assignedFieldUserId = current.assigned_field_user_id;
  if (body.assignedFieldUserId !== undefined) {
    assignedFieldUserId = body.assignedFieldUserId || null;
    if (assignedFieldUserId) {
      const fu = await dbQuery(
        `SELECT id FROM field_users WHERE id = $1 AND tenant_id = $2 AND enabled = true`,
        [assignedFieldUserId, tenantId],
      );
      if (!fu.rows[0]) {
        const err = new Error("Field user not found");
        err.status = 404;
        throw err;
      }
    }
  }

  let remindDueAt = current.remind_due_at;
  if (body.remindDueAt !== undefined) {
    remindDueAt = body.remindDueAt ? new Date(String(body.remindDueAt)).toISOString() : null;
  }
  let remindIntervalDays = current.remind_interval_days;
  if (body.remindIntervalDays !== undefined) {
    const n = Number(body.remindIntervalDays);
    remindIntervalDays = Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }
  let remindIntervalKm = current.remind_interval_km;
  if (body.remindIntervalKm !== undefined) {
    const n = Number(body.remindIntervalKm);
    remindIntervalKm = Number.isFinite(n) && n > 0 ? n : null;
  }
  let remindBaselineOdometerKm = current.remind_baseline_odometer_km;
  if (body.remindBaselineOdometerKm !== undefined) {
    const n = Number(body.remindBaselineOdometerKm);
    remindBaselineOdometerKm = Number.isFinite(n) ? n : null;
  }
  let remindIntervalHours = current.remind_interval_hours;
  if (body.remindIntervalHours !== undefined) {
    const n = Number(body.remindIntervalHours);
    remindIntervalHours = Number.isFinite(n) && n > 0 ? n : null;
  }
  let remindHoursSinceAt = current.remind_hours_since_at;
  if (body.remindHoursSinceAt !== undefined) {
    remindHoursSinceAt = body.remindHoursSinceAt
      ? new Date(String(body.remindHoursSinceAt)).toISOString()
      : null;
  }
  if (remindIntervalHours && !remindHoursSinceAt) {
    remindHoursSinceAt = current.created_at || new Date().toISOString();
  }

  let remindBeforeDays = current.remind_before_days;
  if (body.remindBeforeDays !== undefined) {
    const n = Number(body.remindBeforeDays);
    remindBeforeDays = Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  }
  let remindBeforeKm = current.remind_before_km;
  if (body.remindBeforeKm !== undefined) {
    const n = Number(body.remindBeforeKm);
    remindBeforeKm = Number.isFinite(n) && n >= 0 ? n : null;
  }
  let remindBeforeHours = current.remind_before_hours;
  if (body.remindBeforeHours !== undefined) {
    const n = Number(body.remindBeforeHours);
    remindBeforeHours = Number.isFinite(n) && n >= 0 ? n : null;
  }

  await dbQuery(
    `UPDATE service_events SET
       status = $3, title = $4, notes = $5, started_at = $6, ended_at = $7, odometer_km = $8,
       service_point_id = $9, service_point_name = $10, service_point_lat = $11, service_point_lon = $12,
       assigned_field_user_id = $13,
       remind_due_at = $14, remind_interval_days = $15, remind_interval_km = $16,
       remind_baseline_odometer_km = $17,
       remind_interval_hours = $18, remind_hours_since_at = $19,
       remind_before_days = $20, remind_before_km = $21, remind_before_hours = $22,
       updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING ${SELECT_COLS}`,
    [
      current.id,
      tenantId,
      status,
      title,
      notes,
      startedAt,
      endedAt,
      odometerKm,
      servicePointId,
      servicePointName,
      servicePointLat,
      servicePointLon,
      assignedFieldUserId,
      remindDueAt,
      remindIntervalDays,
      remindIntervalKm,
      remindBaselineOdometerKm,
      remindIntervalHours,
      remindHoursSinceAt,
      remindBeforeDays,
      remindBeforeKm,
      remindBeforeHours,
    ],
  );

  if (Array.isArray(body.lines)) {
    await replaceLines(current.id, body.lines);
  }

  const event = await loadEventDetail(tenantId, current.id);
  let nextEvent = null;

  if (
    event &&
    assignedFieldUserId &&
    String(assignedFieldUserId) !== String(prevAssigned || "")
  ) {
    try {
      const { fanOutEventReminder } = await import("./maintenance-remind.mjs");
      await fanOutEventReminder({
        tenantId,
        tenantKey: opts.tenantKey || opts.vaultTenant?.key || "",
        event,
        kind: "assigned",
        title: `Job assigned · ${event.userDisplayName || event.armadaUsername || "Vehicle"}`,
        body: `${event.title} was assigned to you.`,
        payload: { assignedFieldUserId },
      });
    } catch (err) {
      console.error("[maintenance] assigned notify", err);
    }
  }

  if (prevStatus !== "done" && status === "done" && event) {
    try {
      nextEvent = await spawnNextDueEvent(event, tenantId, {
        vaultTenant: opts.vaultTenant,
        completionOdo: odometerKm,
      });
    } catch (err) {
      console.error("[maintenance] spawn next due", err);
      nextEvent = null;
    }
    if (nextEvent) {
      try {
        const { fanOutEventReminder } = await import("./maintenance-remind.mjs");
        await fanOutEventReminder({
          tenantId,
          tenantKey: opts.tenantKey || opts.vaultTenant?.key || "",
          event: nextEvent,
          kind: "next_due",
          title: `Next maintenance due · ${nextEvent.userDisplayName || nextEvent.armadaUsername || "Vehicle"}`,
          body: `${nextEvent.title} scheduled after completion.`,
          payload: { parentEventId: event.id },
        });
      } catch (err) {
        console.error("[maintenance] next_due notify", err);
      }
    }
  }

  return { event, nextEvent };
}

function scheduleConfigured(ev) {
  return Boolean(
    (ev.remindIntervalDays != null && ev.remindIntervalDays > 0) ||
      (ev.remindIntervalKm != null && ev.remindIntervalKm > 0) ||
      (ev.remindIntervalHours != null && ev.remindIntervalHours > 0) ||
      (ev.remindDueAt && ev.remindIntervalDays),
  );
}

/**
 * @param {ReturnType<typeof publicEvent>} completed
 * @param {string} tenantId
 */
async function spawnNextDueEvent(completed, tenantId, { vaultTenant, completionOdo } = {}) {
  if (!scheduleConfigured(completed)) return null;

  // One open follow-up per completed job — avoids duplicate next-due after double Done/races.
  const existingOpen = await dbQuery(
    `SELECT ${SELECT_COLS} FROM service_events
     WHERE parent_event_id = $1 AND status IN ('due', 'in_progress')
     ORDER BY created_at ASC LIMIT 1`,
    [completed.id],
  );
  if (existingOpen.rows[0]) return publicEvent(existingOpen.rows[0]);

  let nextBaseline = completionOdo ?? completed.odometerKm ?? completed.remindBaselineOdometerKm;
  if (
    (nextBaseline == null || !Number.isFinite(nextBaseline)) &&
    completed.remindIntervalKm != null &&
    vaultTenant?.token &&
    completed.armadaUserId
  ) {
    try {
      const km = await computeKmAccrued(completed, vaultTenant);
      if (km.currentOdoKm != null) nextBaseline = km.currentOdoKm;
    } catch {
      /* ignore */
    }
  }
  if (
    nextBaseline == null &&
    completed.remindBaselineOdometerKm != null &&
    completed.remindIntervalKm != null
  ) {
    nextBaseline = completed.remindBaselineOdometerKm + completed.remindIntervalKm;
  }

  let nextDueAt = null;
  const ended = completed.endedAt || new Date().toISOString();
  if (completed.remindIntervalDays != null && completed.remindIntervalDays > 0) {
    const base = Date.parse(completed.remindDueAt || ended);
    if (Number.isFinite(base)) {
      nextDueAt = new Date(base + completed.remindIntervalDays * 86400000).toISOString();
    }
  } else if (completed.remindDueAt && completed.remindIntervalDays) {
    const base = Date.parse(completed.remindDueAt);
    if (Number.isFinite(base)) {
      nextDueAt = new Date(base + completed.remindIntervalDays * 86400000).toISOString();
    }
  }

  const inserted = await dbQuery(
    `INSERT INTO service_events (
       tenant_id, status, title, notes, armada_user_id, armada_username, user_display_name,
       lat, lon, odometer_km, assigned_field_user_id,
       remind_due_at, remind_interval_days, remind_interval_km, remind_baseline_odometer_km,
       remind_interval_hours, remind_hours_since_at,
       remind_before_days, remind_before_km, remind_before_hours, parent_event_id
     ) VALUES (
       $1,'due',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
     ) RETURNING ${SELECT_COLS}`,
    [
      tenantId,
      completed.title,
      null,
      completed.armadaUserId,
      completed.armadaUsername || null,
      completed.userDisplayName || null,
      completed.lat,
      completed.lon,
      nextBaseline,
      completed.assignedFieldUserId,
      nextDueAt,
      completed.remindIntervalDays,
      completed.remindIntervalKm,
      nextBaseline,
      completed.remindIntervalHours,
      completed.remindIntervalHours ? new Date().toISOString() : null,
      completed.remindBeforeDays,
      completed.remindBeforeKm,
      completed.remindBeforeHours,
      completed.id,
    ],
  );
  return publicEvent(inserted.rows[0]);
}

export async function savePhoto(eventId, tenantId, { buffer, contentType, caption, fieldUserId }) {
  const ct = contentType || "image/jpeg";
  let key;
  let payload = null;
  if (objectStorageConfigured()) {
    key = `pom/${tenantId}/${eventId}/${crypto.randomUUID()}`;
    await putObject(key, buffer, ct);
  } else {
    // Persist in Postgres when MinIO/S3 is not configured (common on small VPS).
    key = `inline/${tenantId}/${eventId}/${crypto.randomUUID()}`;
    payload = buffer;
  }
  const inserted = await dbQuery(
    `INSERT INTO service_event_photos
       (event_id, storage_key, content_type, bytes, caption, uploaded_by_field_user_id, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, content_type, bytes, caption, created_at`,
    [eventId, key, ct, buffer.length, caption || null, fieldUserId || null, payload],
  );
  return publicPhoto(inserted.rows[0]);
}

/** Load photo bytes from inline DB payload or object storage. */
export async function loadPhotoBytes(photoId, tenantId) {
  const found = await dbQuery(
    `SELECT p.storage_key, p.content_type, p.payload
     FROM service_event_photos p
     JOIN service_events e ON e.id = p.event_id
     WHERE p.id = $1 AND e.tenant_id = $2`,
    [photoId, tenantId],
  );
  const row = found.rows[0];
  if (!row) return null;
  if (row.payload) {
    const body = Buffer.isBuffer(row.payload) ? row.payload : Buffer.from(row.payload);
    return {
      body,
      contentType: row.content_type || "image/jpeg",
    };
  }
  const obj = await getObject(row.storage_key);
  return {
    body: obj.body,
    contentType: obj.contentType || row.content_type || "image/jpeg",
  };
}

async function loadDayTrackPoints(vaultTenant, userId, date, todayYmd) {
  const scope = tenantCacheScope(vaultTenant.key);
  const cached = await readCachedDay(scope, vaultTenant.appId, userId, date);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      /* fetch fresh */
    }
  }
  if (!vaultTenant.token) return [];
  const url = `https://armada.id/lt/api/v.1/applications/${vaultTenant.appId}/users/${userId}/tracks?Date=${encodeURIComponent(date)}&Filtered=true`;
  try {
    const res = await armadaFetch(url, {
      method: "GET",
      headers: {
        authorization: vaultTenant.token,
        accept: "application/json",
      },
      timeoutMs: DAY_FETCH_TIMEOUT_MS,
    });
    if (res.status === 404) return [];
    if (!res.ok) return [];
    const raw = res.buffer || (await res.text());
    const slim = await slimAsync(raw);
    if (isPastDay(date, todayYmd)) {
      await writeCachedDay(scope, vaultTenant.appId, userId, date, slim).catch(() => {});
    }
    try {
      const parsed = JSON.parse(slim);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  } catch {
    return [];
  }
}

/**
 * @param {object} eventRow public or DB-shaped event with camel or snake fields
 * @param {import('./tenants.mjs').Tenant} vaultTenant
 */
export async function computeHoursAccrued(eventRow, vaultTenant) {
  const userId = Number(eventRow.armadaUserId ?? eventRow.armada_user_id);
  const intervalHours = Number(eventRow.remindIntervalHours ?? eventRow.remind_interval_hours);
  let sinceAt = eventRow.remindHoursSinceAt ?? eventRow.remind_hours_since_at;
  if (!sinceAt) sinceAt = eventRow.createdAt ?? eventRow.created_at;

  if (!Number.isInteger(userId) || userId < 1) {
    return { hoursAccrued: null, intervalHours: null, due: false, lookbackCapped: false, reason: "no_vehicle" };
  }
  if (!Number.isFinite(intervalHours) || intervalHours <= 0) {
    return { hoursAccrued: null, intervalHours: null, due: false, lookbackCapped: false, reason: "no_interval" };
  }
  const sinceMs = Date.parse(String(sinceAt || ""));
  if (!Number.isFinite(sinceMs)) {
    return {
      hoursAccrued: null,
      intervalHours,
      due: false,
      lookbackCapped: false,
      reason: "no_since",
    };
  }

  const todayYmd = todayKeyFromOffset("+00:00");
  const lookbackStart = new Date();
  lookbackStart.setUTCDate(lookbackStart.getUTCDate() - HOURS_LOOKBACK_DAYS);
  const lookbackMs = lookbackStart.getTime();
  const lookbackCapped = sinceMs < lookbackMs;
  const windowStartMs = Math.max(sinceMs, lookbackMs);
  const fromYmd = new Date(windowStartMs).toISOString().slice(0, 10);
  const dates = eachDateYmd(fromYmd, todayYmd);

  let hoursAccrued = 0;
  let daysLoaded = 0;
  for (const date of dates) {
    const points = await loadDayTrackPoints(vaultTenant, userId, date, todayYmd);
    if (points.length) {
      hoursAccrued += sumIgnitionOnHours(points, {
        sinceMs: windowStartMs,
        untilMs: null,
      });
      daysLoaded += 1;
    }
  }

  const rounded = Math.round(hoursAccrued * 100) / 100;
  return {
    hoursAccrued: rounded,
    intervalHours,
    due: rounded >= intervalHours,
    lookbackCapped,
    daysLoaded,
    daysRequested: dates.length,
    sinceAt: new Date(sinceMs).toISOString(),
    reason: null,
  };
}

/**
 * Live km interval check from Armada /usersstatus odometerAcc.
 * @param {ReturnType<typeof publicEvent>} event
 * @param {{ appId: number, token: string }} vaultTenant
 */
export async function computeKmAccrued(event, vaultTenant) {
  const userId = Number(event.armadaUserId);
  const intervalKm = event.remindIntervalKm;
  let baselineKm = event.remindBaselineOdometerKm;
  if (baselineKm == null && event.odometerKm != null) baselineKm = event.odometerKm;

  if (!Number.isInteger(userId) || userId < 1) {
    return { ...evaluateKmInterval({ currentOdoKm: null, baselineKm, intervalKm }), reason: "no_vehicle" };
  }
  if (intervalKm == null || !(intervalKm > 0)) {
    return evaluateKmInterval({ currentOdoKm: null, baselineKm, intervalKm: null });
  }

  const url = `https://armada.id/lt/api/v.1/applications/${vaultTenant.appId}/usersstatus`;
  try {
    const res = await armadaFetch(url, {
      method: "GET",
      headers: {
        authorization: vaultTenant.token,
        accept: "application/json",
      },
      timeoutMs: 45_000,
    });
    if (!res.ok) {
      return {
        ...evaluateKmInterval({ currentOdoKm: null, baselineKm, intervalKm }),
        reason: `status_${res.status}`,
      };
    }
    const raw = await res.json();
    const currentOdoKm = findOdometerKmInStatus(raw, userId);
    return evaluateKmInterval({ currentOdoKm, baselineKm, intervalKm });
  } catch (err) {
    return {
      ...evaluateKmInterval({ currentOdoKm: null, baselineKm, intervalKm }),
      reason: err instanceof Error ? err.message : "status_fetch_failed",
    };
  }
}

export async function handleMaintenanceRequest(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  if (!url.pathname.startsWith("/api/maintenance")) return false;

  if (!databaseUrlConfigured()) {
    json(res, 503, { error: "DATABASE_URL is not configured" });
    return true;
  }

  try {
    // Photo binary (auth via tenant header still required)
    const photoMatch = /^\/api\/maintenance\/photos\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (photoMatch && req.method === "GET") {
      const dbTenant = await resolveDbTenant(req);
      if (!dbTenant) {
        json(res, 401, { error: "Unknown embed tenant" });
        return true;
      }
      const obj = await loadPhotoBytes(photoMatch[1], dbTenant.id);
      if (!obj) {
        json(res, 404, { error: "Photo not found" });
        return true;
      }
      send(
        res,
        200,
        {
          "Content-Type": obj.contentType || "image/jpeg",
          "Cache-Control": "private, max-age=3600",
        },
        obj.body,
      );
      return true;
    }

    const dbTenant = await resolveDbTenant(req);
    if (!dbTenant) {
      json(res, 401, { error: "Unknown embed tenant (k= required for maintenance)" });
      return true;
    }

    if (url.pathname === "/api/maintenance/field-users" && req.method === "GET") {
      const rows = await dbQuery(
        `SELECT id, username, role, display_name, enabled
         FROM field_users WHERE tenant_id = $1 ORDER BY username ASC`,
        [dbTenant.id],
      );
      json(res, 200, {
        users: rows.rows.map((r) => ({
          id: r.id,
          username: r.username,
          role: r.role,
          displayName: r.display_name || "",
          enabled: r.enabled !== false,
        })),
      });
      return true;
    }

    if (url.pathname === "/api/maintenance/service-points" && req.method === "GET") {
      const q = String(url.searchParams.get("q") || "").trim();
      const params = [dbTenant.id];
      let where = "tenant_id = $1";
      if (q) {
        params.push(`%${q}%`);
        where += ` AND name ILIKE $${params.length}`;
      }
      const rows = await dbQuery(
        `SELECT id, name, lat, lon, notes, point_type, armada_poi_id, armada_poi_name, created_at
         FROM service_points WHERE ${where} ORDER BY name ASC LIMIT 100`,
        params,
      );
      json(res, 200, {
        points: rows.rows.map((r) => ({
          id: r.id,
          name: r.name,
          lat: r.lat == null ? null : Number(r.lat),
          lon: r.lon == null ? null : Number(r.lon),
          notes: r.notes || "",
          pointType: r.point_type || "",
          armadaPoiId: r.armada_poi_id,
          armadaPoiName: r.armada_poi_name || "",
        })),
      });
      return true;
    }

    if (url.pathname === "/api/maintenance/service-points" && req.method === "POST") {
      const body = await readJson(req);
      const name = String(body.name || "").trim();
      if (!name) {
        json(res, 400, { error: "name is required" });
        return true;
      }
      const lat = body.lat == null || body.lat === "" ? null : Number(body.lat);
      const lon = body.lon == null || body.lon === "" ? null : Number(body.lon);
      const notes = String(body.notes || "").trim() || null;
      const pointType = String(body.pointType || body.type || "").trim() || null;
      const inserted = await dbQuery(
        `INSERT INTO service_points (tenant_id, name, lat, lon, notes, point_type)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, name, lat, lon, notes, point_type, armada_poi_id, armada_poi_name`,
        [
          dbTenant.id,
          name.slice(0, 200),
          Number.isFinite(lat) ? lat : null,
          Number.isFinite(lon) ? lon : null,
          notes,
          pointType,
        ],
      );
      const r = inserted.rows[0];
      json(res, 201, {
        point: {
          id: r.id,
          name: r.name,
          lat: r.lat == null ? null : Number(r.lat),
          lon: r.lon == null ? null : Number(r.lon),
          notes: r.notes || "",
          pointType: r.point_type || "",
        },
      });
      return true;
    }

    if (url.pathname === "/api/maintenance/events" && req.method === "GET") {
      const status = String(url.searchParams.get("status") || "open").toLowerCase();
      const healthFilter = String(url.searchParams.get("health") || "").toLowerCase();
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
      const clauses = ["tenant_id = $1"];
      const params = [dbTenant.id];
      if (healthFilter === "completed" || status === "completed") {
        params.push("done");
        clauses.push(`status = $${params.length}`);
      } else if (status === "open") clauses.push("status IN ('due', 'in_progress')");
      else if (STATUSES.includes(status)) {
        params.push(status);
        clauses.push(`status = $${params.length}`);
      } else if (status !== "all") {
        json(res, 400, { error: "Invalid status filter" });
        return true;
      }
      params.push(limit);
      const rows = await dbQuery(
        `SELECT ${SELECT_COLS} FROM service_events
         WHERE ${clauses.join(" AND ")}
         ORDER BY created_at DESC LIMIT $${params.length}`,
        params,
      );
      let events = rows.rows.map((r) => publicEvent(r));
      const vaultTenant = tenantFromRequest(req);
      const { enrichEventsWithSchedule, summarizeSchedule } = await import("./maintenance-schedule.mjs");
      events = await enrichEventsWithSchedule(events, vaultTenant || null);
      const summary = summarizeSchedule(events);
      if (healthFilter && ["upcoming", "due", "overdue", "ok", "none"].includes(healthFilter)) {
        events = events.filter((e) => e.scheduleHealth === healthFilter);
      }
      if (["upcoming", "due", "overdue"].includes(healthFilter) || healthFilter === "") {
        events = [...events].sort(
          (a, b) => (b.scheduleUrgency ?? 0) - (a.scheduleUrgency ?? 0),
        );
      }
      json(res, 200, { events, summary });
      return true;
    }

    if (url.pathname === "/api/maintenance/schedule-summary" && req.method === "GET") {
      const vaultTenant = tenantFromRequest(req);
      const openRows = await dbQuery(
        `SELECT ${SELECT_COLS} FROM service_events
         WHERE tenant_id = $1 AND status IN ('due', 'in_progress')
         ORDER BY created_at DESC LIMIT 200`,
        [dbTenant.id],
      );
      const doneCount = await dbQuery(
        `SELECT count(*)::int AS n FROM service_events WHERE tenant_id = $1 AND status = 'done'`,
        [dbTenant.id],
      );
      const { enrichEventsWithSchedule, summarizeSchedule } = await import("./maintenance-schedule.mjs");
      const enriched = await enrichEventsWithSchedule(
        openRows.rows.map((r) => publicEvent(r)),
        vaultTenant || null,
      );
      const summary = summarizeSchedule(enriched);
      summary.completed = doneCount.rows[0]?.n || 0;

      const serviceAvg = await dbQuery(
        `SELECT
           count(*)::int AS n,
           ROUND(AVG(EXTRACT(EPOCH FROM (ended_at - started_at)) / 60.0))::int AS avg_minutes
         FROM service_events
         WHERE tenant_id = $1
           AND status = 'done'
           AND started_at IS NOT NULL
           AND ended_at IS NOT NULL
           AND ended_at >= started_at
           AND ended_at >= (CURRENT_DATE - 90)::timestamptz`,
        [dbTenant.id],
      );
      summary.avgServiceMinutes = serviceAvg.rows[0]?.avg_minutes ?? null;
      summary.serviceTimeSamples = serviceAvg.rows[0]?.n || 0;

      const days = 14;
      const timelineRows = await dbQuery(
        `WITH days AS (
           SELECT generate_series(
             (CURRENT_DATE - ($2::int - 1))::date,
             CURRENT_DATE::date,
             '1 day'::interval
           )::date AS day
         ),
         completed AS (
           SELECT (COALESCE(ended_at, updated_at) AT TIME ZONE 'UTC')::date AS day, count(*)::int AS n
           FROM service_events
           WHERE tenant_id = $1 AND status = 'done'
             AND COALESCE(ended_at, updated_at) >= (CURRENT_DATE - ($2::int - 1))::timestamptz
           GROUP BY 1
         ),
         opened AS (
           SELECT (created_at AT TIME ZONE 'UTC')::date AS day, count(*)::int AS n
           FROM service_events
           WHERE tenant_id = $1
             AND created_at >= (CURRENT_DATE - ($2::int - 1))::timestamptz
           GROUP BY 1
         )
         SELECT d.day::text AS day,
                COALESCE(c.n, 0)::int AS completed,
                COALESCE(o.n, 0)::int AS opened
         FROM days d
         LEFT JOIN completed c ON c.day = d.day
         LEFT JOIN opened o ON o.day = d.day
         ORDER BY d.day ASC`,
        [dbTenant.id, days],
      );

      json(res, 200, {
        summary,
        healthBars: {
          labels: ["Upcoming", "Due", "Overdue", "On track", "Unscheduled"],
          values: [
            summary.upcoming,
            summary.due,
            summary.overdue,
            summary.ok || 0,
            summary.none || 0,
          ],
          keys: ["upcoming", "due", "overdue", "ok", "none"],
        },
        timeline: {
          days,
          labels: timelineRows.rows.map((r) => String(r.day).slice(5)), // MM-DD
          completed: timelineRows.rows.map((r) => Number(r.completed) || 0),
          opened: timelineRows.rows.map((r) => Number(r.opened) || 0),
        },
      });
      return true;
    }

    if (url.pathname === "/api/maintenance/events" && req.method === "POST") {
      const body = await readJson(req);
      const title = String(body.title || "").trim();
      if (!title) {
        json(res, 400, { error: "title is required" });
        return true;
      }
      const notes = String(body.notes || "").trim() || null;
      const armadaUsername = String(body.armadaUsername || body.username || "").trim() || null;
      const userDisplayName = String(body.userDisplayName || body.displayName || "").trim() || null;
      const userIdRaw = Number(body.armadaUserId ?? body.userId);
      const armadaUserId = Number.isInteger(userIdRaw) && userIdRaw > 0 ? userIdRaw : null;
      const lat = body.lat == null || body.lat === "" ? null : Number(body.lat);
      const lon = body.lon == null || body.lon === "" ? null : Number(body.lon);
      const odoRaw = body.odometerKm == null || body.odometerKm === "" ? null : Number(body.odometerKm);
      const remindDueAt = body.remindDueAt ? new Date(String(body.remindDueAt)).toISOString() : null;
      const intervalDaysRaw = Number(body.remindIntervalDays);
      const remindIntervalDays =
        Number.isFinite(intervalDaysRaw) && intervalDaysRaw > 0 ? Math.round(intervalDaysRaw) : null;
      const intervalKmRaw = Number(body.remindIntervalKm);
      const remindIntervalKm =
        Number.isFinite(intervalKmRaw) && intervalKmRaw > 0 ? intervalKmRaw : null;
      const baselineRaw =
        body.remindBaselineOdometerKm == null || body.remindBaselineOdometerKm === ""
          ? odoRaw
          : Number(body.remindBaselineOdometerKm);
      const remindBaseline =
        Number.isFinite(baselineRaw) ? baselineRaw : Number.isFinite(odoRaw) ? odoRaw : null;
      const intervalHoursRaw = Number(body.remindIntervalHours);
      const remindIntervalHours =
        Number.isFinite(intervalHoursRaw) && intervalHoursRaw > 0 ? intervalHoursRaw : null;
      let remindHoursSinceAt = body.remindHoursSinceAt
        ? new Date(String(body.remindHoursSinceAt)).toISOString()
        : null;
      if (remindIntervalHours && !remindHoursSinceAt) {
        remindHoursSinceAt = new Date().toISOString();
      }
      if (remindHoursSinceAt && Number.isNaN(Date.parse(remindHoursSinceAt))) {
        remindHoursSinceAt = null;
      }
      const beforeDaysRaw = Number(body.remindBeforeDays);
      const remindBeforeDays =
        Number.isFinite(beforeDaysRaw) && beforeDaysRaw >= 0 ? Math.round(beforeDaysRaw) : null;
      const beforeKmRaw = Number(body.remindBeforeKm);
      const remindBeforeKm = Number.isFinite(beforeKmRaw) && beforeKmRaw >= 0 ? beforeKmRaw : null;
      const beforeHoursRaw = Number(body.remindBeforeHours);
      const remindBeforeHours =
        Number.isFinite(beforeHoursRaw) && beforeHoursRaw >= 0 ? beforeHoursRaw : null;
      const inserted = await dbQuery(
        `INSERT INTO service_events (
           tenant_id, status, title, notes, armada_user_id, armada_username, user_display_name, lat, lon, odometer_km,
           remind_due_at, remind_interval_days, remind_interval_km, remind_baseline_odometer_km,
           remind_interval_hours, remind_hours_since_at,
           remind_before_days, remind_before_km, remind_before_hours
         ) VALUES ($1, 'due', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         RETURNING ${SELECT_COLS}`,
        [
          dbTenant.id,
          title.slice(0, 200),
          notes,
          armadaUserId,
          armadaUsername,
          userDisplayName,
          Number.isFinite(lat) ? lat : null,
          Number.isFinite(lon) ? lon : null,
          Number.isFinite(odoRaw) ? odoRaw : null,
          remindDueAt && !Number.isNaN(Date.parse(remindDueAt)) ? remindDueAt : null,
          remindIntervalDays,
          remindIntervalKm,
          remindBaseline,
          remindIntervalHours,
          remindHoursSinceAt,
          remindBeforeDays,
          remindBeforeKm,
          remindBeforeHours,
        ],
      );
      json(res, 201, { event: publicEvent(inserted.rows[0]) });
      return true;
    }

    if (url.pathname === "/api/maintenance/reminders" && req.method === "GET") {
      const status = String(url.searchParams.get("status") || "open").toLowerCase();
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));
      const clauses = ["tenant_id = $1"];
      const params = [dbTenant.id];
      if (status === "open") clauses.push("acked_at IS NULL");
      else if (status === "acked") clauses.push("acked_at IS NOT NULL");
      else if (status !== "all") {
        json(res, 400, { error: "Invalid status filter" });
        return true;
      }
      params.push(limit);
      const rows = await dbQuery(
        `SELECT * FROM maintenance_reminders
         WHERE ${clauses.join(" AND ")}
         ORDER BY created_at DESC LIMIT $${params.length}`,
        params,
      );
      const { publicReminder } = await import("./maintenance-remind.mjs");
      json(res, 200, { reminders: rows.rows.map(publicReminder) });
      return true;
    }

    const remindAck = /^\/api\/maintenance\/reminders\/([0-9a-f-]{36})\/ack$/i.exec(url.pathname);
    if (remindAck && req.method === "POST") {
      const updated = await dbQuery(
        `UPDATE maintenance_reminders SET acked_at = now()
         WHERE id = $1 AND tenant_id = $2
         RETURNING *`,
        [remindAck[1], dbTenant.id],
      );
      if (!updated.rows[0]) {
        json(res, 404, { error: "Reminder not found" });
        return true;
      }
      const { publicReminder } = await import("./maintenance-remind.mjs");
      json(res, 200, { reminder: publicReminder(updated.rows[0]) });
      return true;
    }

    if (url.pathname === "/api/maintenance/reminders/evaluate" && req.method === "POST") {
      const vaultTenant = tenantFromRequest(req);
      if (!vaultTenant?.token) {
        json(res, 503, { error: "No Armada token for this tenant" });
        return true;
      }
      const { evaluateTenantReminders } = await import("./maintenance-remind.mjs");
      const result = await evaluateTenantReminders(dbTenant.id, vaultTenant);
      json(res, 200, result);
      return true;
    }

    const hoursMatch = /^\/api\/maintenance\/events\/([0-9a-f-]{36})\/hours-accrued$/i.exec(url.pathname);
    if (hoursMatch && req.method === "GET") {
      const found = await dbQuery(`SELECT ${SELECT_COLS} FROM service_events WHERE id = $1 AND tenant_id = $2`, [
        hoursMatch[1],
        dbTenant.id,
      ]);
      if (!found.rows[0]) {
        json(res, 404, { error: "Service event not found" });
        return true;
      }
      const vaultTenant = tenantFromRequest(req);
      if (!vaultTenant?.token) {
        json(res, 503, { error: "No Armada token for this tenant" });
        return true;
      }
      const result = await computeHoursAccrued(publicEvent(found.rows[0]), vaultTenant);
      json(res, 200, result);
      return true;
    }

    const kmMatch = /^\/api\/maintenance\/events\/([0-9a-f-]{36})\/km-accrued$/i.exec(url.pathname);
    if (kmMatch && req.method === "GET") {
      const found = await dbQuery(`SELECT ${SELECT_COLS} FROM service_events WHERE id = $1 AND tenant_id = $2`, [
        kmMatch[1],
        dbTenant.id,
      ]);
      if (!found.rows[0]) {
        json(res, 404, { error: "Service event not found" });
        return true;
      }
      const vaultTenant = tenantFromRequest(req);
      if (!vaultTenant?.token) {
        json(res, 503, { error: "No Armada token for this tenant" });
        return true;
      }
      const result = await computeKmAccrued(publicEvent(found.rows[0]), vaultTenant);
      json(res, 200, result);
      return true;
    }

    const linesMatch = /^\/api\/maintenance\/events\/([0-9a-f-]{36})\/lines$/i.exec(url.pathname);
    if (linesMatch && req.method === "PUT") {
      const id = linesMatch[1];
      const found = await dbQuery(`SELECT id FROM service_events WHERE id = $1 AND tenant_id = $2`, [
        id,
        dbTenant.id,
      ]);
      if (!found.rows[0]) {
        json(res, 404, { error: "Service event not found" });
        return true;
      }
      const body = await readJson(req);
      const lines = await replaceLines(id, body.lines);
      json(res, 200, { lines, ...rollup(lines) });
      return true;
    }

    const photoPostMatch = /^\/api\/maintenance\/events\/([0-9a-f-]{36})\/photos$/i.exec(url.pathname);
    if (photoPostMatch && req.method === "POST") {
      const id = photoPostMatch[1];
      const found = await dbQuery(`SELECT id FROM service_events WHERE id = $1 AND tenant_id = $2`, [
        id,
        dbTenant.id,
      ]);
      if (!found.rows[0]) {
        json(res, 404, { error: "Service event not found" });
        return true;
      }
      const body = await readJson(req);
      const parsed = parseDataUrl(body.dataUrl || body.data || "");
      if (!parsed) {
        json(res, 400, { error: "dataUrl (base64 data URI) required" });
        return true;
      }
      if (parsed.buffer.length < 32 || parsed.buffer.length > 12_000_000) {
        json(res, 400, { error: "Image must be between 32B and 12MB" });
        return true;
      }
      const photo = await savePhoto(id, dbTenant.id, {
        buffer: parsed.buffer,
        contentType: parsed.contentType,
        caption: String(body.caption || "").trim(),
      });
      json(res, 201, { photo });
      return true;
    }

    const eventMatch = /^\/api\/maintenance\/events\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (eventMatch && req.method === "GET") {
      const detail = await loadEventDetail(dbTenant.id, eventMatch[1]);
      if (!detail) {
        json(res, 404, { error: "Service event not found" });
        return true;
      }
      const vaultTenant = tenantFromRequest(req);
      let hoursByEventId = {};
      if (detail.remindIntervalHours && vaultTenant?.token) {
        try {
          const hrs = await computeHoursAccrued(detail, vaultTenant);
          if (hrs.hoursAccrued != null) hoursByEventId = { [detail.id]: hrs.hoursAccrued };
        } catch {
          /* ignore */
        }
      }
      const { enrichEventsWithSchedule } = await import("./maintenance-schedule.mjs");
      const [enriched] = await enrichEventsWithSchedule([detail], vaultTenant || null, {
        hoursByEventId,
      });
      json(res, 200, { event: { ...detail, ...enriched } });
      return true;
    }

    if (eventMatch && req.method === "PATCH") {
      const found = await dbQuery(
        `SELECT ${SELECT_COLS} FROM service_events WHERE id = $1 AND tenant_id = $2`,
        [eventMatch[1], dbTenant.id],
      );
      if (!found.rows[0]) {
        json(res, 404, { error: "Service event not found" });
        return true;
      }
      const body = await readJson(req);
      const vaultTenant = tenantFromRequest(req);
      const { event, nextEvent } = await applyEventPatch(found.rows[0], body, dbTenant.id, {
        tenantKey: dbTenant.key,
        vaultTenant: vaultTenant || undefined,
        actor: "manager",
      });
      json(res, 200, { event, nextEvent: nextEvent || null });
      return true;
    }

    json(res, 404, { error: "Not found" });
    return true;
  } catch (err) {
    const status = err?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[maintenance]", message);
    json(res, status >= 400 && status < 600 ? status : 500, { error: message });
    return true;
  }
}
