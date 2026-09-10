/**
 * Field-user login API under /api/field/*
 */
import { databaseUrlConfigured, dbQuery } from "./db.mjs";
import {
  clearFieldSessionCookieHeader,
  createFieldSession,
  destroyFieldSessionByToken,
  fieldCookieName,
  fieldFromRequest,
  fieldSessionCookieHeader,
  verifyPassword,
} from "./field-auth.mjs";
import { readCookies } from "./admin-auth.mjs";
import {
  loadDispatchPhotoBytes,
  publicDispatchPhoto,
  saveDispatchStopPhoto,
} from "./dispatch-api.mjs";
import { applyEventPatch, loadEventDetail, loadPhotoBytes, parseDataUrl, publicEvent, savePhoto } from "./maintenance-api.mjs";
import { securityHeaders } from "./proxy-lt.mjs";
import { mergeEntitlements } from "./entitlements.mjs";

const SELECT_COLS = `id, status, title, notes, armada_user_id, armada_username, user_display_name,
  lat, lon, notification_id, started_at, ended_at, odometer_km,
  service_point_id, service_point_name, service_point_lat, service_point_lon,
  assigned_field_user_id,
  remind_due_at, remind_interval_days, remind_interval_km, remind_baseline_odometer_km,
  remind_interval_hours, remind_hours_since_at,
  remind_before_days, remind_before_km, remind_before_hours, parent_event_id,
  approved_at, approved_by,
  created_at, updated_at`;

function send(res, status, headers, body) {
  res.writeHead(status, securityHeaders(headers));
  res.end(body);
}

function json(res, status, obj, extraHeaders = {}) {
  send(
    res,
    status,
    {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
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

async function readJson(req) {
  const raw = await readBody(req);
  const text = raw.toString("utf8");
  if (!text.trim()) return {};
  return JSON.parse(text);
}

function publicFieldUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    displayName: user.displayName || user.display_name || "",
    tenantKey: user.tenantKey || user.tenant_key,
    appId: user.appId ?? user.app_id,
    tenantId: user.tenantId || user.tenant_id,
  };
}

/** Open/closed jobs strictly assigned to this field user (same tenant). */
async function loadAssignedEventRow(tenantId, eventId, fieldUserId) {
  const found = await dbQuery(
    `SELECT ${SELECT_COLS} FROM service_events
     WHERE id = $1 AND tenant_id = $2 AND assigned_field_user_id = $3`,
    [eventId, tenantId, fieldUserId],
  );
  return found.rows[0] || null;
}

async function tenantMobileMaintenanceEnabled(tenantId) {
  const row = await dbQuery(`SELECT entitlements FROM tenants WHERE id = $1`, [tenantId]);
  const ent = mergeEntitlements(row.rows[0]?.entitlements);
  return ent.mobile?.maintenance === true;
}

async function tenantMobileDispatchEnabled(tenantId) {
  const row = await dbQuery(`SELECT entitlements FROM tenants WHERE id = $1`, [tenantId]);
  const ent = mergeEntitlements(row.rows[0]?.entitlements);
  return ent.mobile?.dispatch === true;
}

async function mobileFlagsForTenant(tenantId) {
  const row = await dbQuery(`SELECT entitlements FROM tenants WHERE id = $1`, [tenantId]);
  const ent = mergeEntitlements(row.rows[0]?.entitlements);
  return {
    mobileMaintenance: ent.mobile?.maintenance === true,
    managerMaintenance: ent.mobile?.managerMaintenance === true,
    mobileDispatch: ent.mobile?.dispatch === true,
  };
}

function publicDispatchStop(row) {
  return {
    id: row.id,
    orderId: row.order_id || null,
    sortOrder: Number(row.sort_order) || 0,
    name: row.name || "",
    address: row.address || "",
    lat: row.lat == null ? null : Number(row.lat),
    lon: row.lon == null ? null : Number(row.lon),
    notes: row.notes || "",
    zone: row.zone || "",
    volumeM3: row.volume_m3 == null ? null : Number(row.volume_m3),
    weightKg: row.weight_kg == null ? null : Number(row.weight_kg),
    windowStart: row.window_start || "",
    windowEnd: row.window_end || "",
    status: row.status || "pending",
    arrivedAt: row.arrived_at || null,
    completedAt: row.completed_at || null,
  };
}

function fieldCapacityFrom(row, stops) {
  const volumeCapacityM3 =
    row.volume_capacity_m3 == null ? 12 : Number(row.volume_capacity_m3) || 12;
  const weightCapacityKg =
    row.weight_capacity_kg == null ? 1500 : Number(row.weight_capacity_kg) || 1500;
  let volumeUsed = 0;
  let weightUsed = 0;
  for (const s of stops) {
    if (s.volume_m3 != null) volumeUsed += Number(s.volume_m3) || 0;
    if (s.weight_kg != null) weightUsed += Number(s.weight_kg) || 0;
  }
  const utilV = volumeCapacityM3 > 0 ? (volumeUsed / volumeCapacityM3) * 100 : 0;
  const utilW = weightCapacityKg > 0 ? (weightUsed / weightCapacityKg) * 100 : 0;
  return {
    volumeCapacityM3,
    weightCapacityKg,
    volumeUsed: Math.round(volumeUsed * 1000) / 1000,
    weightUsed: Math.round(weightUsed * 10) / 10,
    utilizationPct: Math.round(Math.max(utilV, utilW) * 10) / 10,
  };
}

function publicDispatchJob(row, stops = []) {
  const cap = fieldCapacityFrom(row, stops);
  return {
    id: row.id,
    status: row.status,
    title: row.title || "",
    notes: row.notes || "",
    armadaUserId: row.armada_user_id == null ? null : Number(row.armada_user_id),
    armadaUsername: row.armada_username || "",
    userDisplayName: row.user_display_name || "",
    assignedFieldUserId: row.assigned_field_user_id || null,
    assignedAt: row.assigned_at || null,
    startedAt: row.started_at || null,
    arrivedAt: row.arrived_at || null,
    completedAt: row.completed_at || null,
    fieldNote: row.field_note || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...cap,
    stops: stops.map(publicDispatchStop),
  };
}

async function loadAssignedDispatchJob(tenantId, jobId, fieldUserId) {
  const found = await dbQuery(
    `SELECT * FROM dispatch_jobs
     WHERE id = $1 AND tenant_id = $2 AND assigned_field_user_id = $3`,
    [jobId, tenantId, fieldUserId],
  );
  return found.rows[0] || null;
}

async function loadDispatchStops(jobId) {
  const rows = await dbQuery(
    `SELECT id, order_id, sort_order, name, address, lat, lon, notes, zone,
            volume_m3, weight_kg, window_start, window_end,
            status, arrived_at, completed_at
     FROM dispatch_stops WHERE job_id = $1 ORDER BY sort_order ASC, created_at ASC`,
    [jobId],
  );
  return rows.rows;
}

export async function handleFieldRequest(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  if (!url.pathname.startsWith("/api/field")) return false;

  if (!databaseUrlConfigured()) {
    json(res, 503, { error: "DATABASE_URL is not configured" });
    return true;
  }

  try {
    if (url.pathname === "/api/field/login" && req.method === "POST") {
      const body = await readJson(req);
      const tenantKey = String(body.tenantKey || body.k || "").trim();
      const username = String(body.username || "").trim();
      const password = String(body.password || "");
      if (!tenantKey || !username || !password) {
        json(res, 400, { error: "tenantKey, username, and password are required" });
        return true;
      }
      const found = await dbQuery(
        `SELECT u.id, u.username, u.password_hash, u.role, u.display_name, u.enabled,
                t.id AS tenant_id, t.key AS tenant_key, t.app_id, t.enabled AS tenant_enabled
         FROM field_users u
         JOIN tenants t ON t.id = u.tenant_id
         WHERE t.key = $1 AND u.username = $2`,
        [tenantKey, username],
      );
      const row = found.rows[0];
      if (
        !row ||
        row.enabled === false ||
        row.tenant_enabled === false ||
        !verifyPassword(password, row.password_hash)
      ) {
        json(res, 401, { error: "Invalid credentials" });
        return true;
      }
      const session = await createFieldSession(row.id);
      const maxAge = Math.floor((session.expiresAt.getTime() - Date.now()) / 1000);
      const flags = await mobileFlagsForTenant(row.tenant_id);
      json(
        res,
        200,
        {
          ok: true,
          user: publicFieldUser({
            id: row.id,
            username: row.username,
            role: row.role,
            displayName: row.display_name,
            tenantKey: row.tenant_key,
            tenantId: row.tenant_id,
            appId: Number(row.app_id),
          }),
          mobileMaintenance: flags.mobileMaintenance,
          managerMaintenance: flags.managerMaintenance,
          mobileDispatch: flags.mobileDispatch,
        },
        { "Set-Cookie": fieldSessionCookieHeader(session.token, maxAge) },
      );
      return true;
    }

    if (url.pathname === "/api/field/logout" && req.method === "POST") {
      const token = readCookies(req)[fieldCookieName()];
      if (token) await destroyFieldSessionByToken(token);
      json(res, 200, { ok: true }, { "Set-Cookie": clearFieldSessionCookieHeader() });
      return true;
    }

    if (url.pathname === "/api/field/me" && req.method === "GET") {
      const user = await fieldFromRequest(req);
      if (!user) {
        json(res, 401, { error: "Not logged in" });
        return true;
      }
      const flags = await mobileFlagsForTenant(user.tenantId);
      json(res, 200, {
        user: publicFieldUser(user),
        mobileMaintenance: flags.mobileMaintenance,
        managerMaintenance: flags.managerMaintenance,
        mobileDispatch: flags.mobileDispatch,
      });
      return true;
    }

    const photoGet = /^\/api\/field\/maintenance\/photos\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (photoGet && req.method === "GET") {
      const user = await fieldFromRequest(req);
      if (!user) {
        json(res, 401, { error: "Not logged in" });
        return true;
      }
      const found = await dbQuery(
        `SELECT p.id
         FROM service_event_photos p
         JOIN service_events e ON e.id = p.event_id
         WHERE p.id = $1 AND e.tenant_id = $2 AND e.assigned_field_user_id = $3`,
        [photoGet[1], user.tenantId, user.id],
      );
      if (!found.rows[0]) {
        json(res, 404, { error: "Photo not found" });
        return true;
      }
      const obj = await loadPhotoBytes(photoGet[1], user.tenantId);
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

    if (url.pathname.startsWith("/api/field/maintenance")) {
      const user = await fieldFromRequest(req);
      if (!user) {
        json(res, 401, { error: "Not logged in" });
        return true;
      }
      if (!(await tenantMobileMaintenanceEnabled(user.tenantId))) {
        json(res, 403, { error: "Maintenance PWA is disabled for this tenant" });
        return true;
      }

      if (url.pathname === "/api/field/maintenance/events" && req.method === "GET") {
        const rows = await dbQuery(
          `SELECT ${SELECT_COLS} FROM service_events
           WHERE tenant_id = $1
             AND assigned_field_user_id = $2
             AND (
               status IN ('due', 'in_progress')
               OR (
                 status IN ('done', 'skipped', 'approved')
                 AND COALESCE(ended_at, approved_at, updated_at) > now() - interval '180 days'
               )
             )
           ORDER BY
             CASE status
               WHEN 'in_progress' THEN 0
               WHEN 'due' THEN 1
               ELSE 2
             END,
             CASE WHEN status IN ('due', 'in_progress')
               THEN COALESCE(remind_due_at, created_at)
               ELSE COALESCE(ended_at, approved_at, updated_at)
             END ASC,
             created_at DESC
           LIMIT 200`,
          [user.tenantId, user.id],
        );
        json(res, 200, { events: rows.rows.map((r) => publicEvent(r)) });
        return true;
      }

      if (url.pathname === "/api/field/maintenance/catalog" && req.method === "GET") {
        const { ensureCatalog } = await import("./maintenance-catalog.mjs");
        const groups = await ensureCatalog(user.tenantId);
        json(res, 200, {
          groups: groups.map((g) => ({
            ...g,
            items: (g.items || []).filter((it) => it.enabled !== false),
          })),
        });
        return true;
      }

      const evMatch = /^\/api\/field\/maintenance\/events\/([0-9a-f-]{36})$/i.exec(url.pathname);
      if (evMatch && req.method === "GET") {
        const row = await loadAssignedEventRow(user.tenantId, evMatch[1], user.id);
        if (!row) {
          json(res, 404, { error: "Job not found or not assigned to you" });
          return true;
        }
        const detail = await loadEventDetail(user.tenantId, evMatch[1]);
        if (!detail || detail.assignedFieldUserId !== user.id) {
          json(res, 404, { error: "Job not found or not assigned to you" });
          return true;
        }
        detail.photos = (detail.photos || []).map((p) => ({
          ...p,
          url: `/api/field/maintenance/photos/${p.id}`,
        }));
        json(res, 200, { event: detail });
        return true;
      }

      if (evMatch && req.method === "PATCH") {
        const found = await loadAssignedEventRow(user.tenantId, evMatch[1], user.id);
        if (!found) {
          json(res, 404, { error: "Job not found or not assigned to you" });
          return true;
        }
        const body = await readJson(req);
        delete body.assignedFieldUserId;
        const { event: patched, nextEvent } = await applyEventPatch(found, body, user.tenantId, {
          tenantKey: user.tenantKey,
          actor: "field",
        });
        const event = {
          ...patched,
          photos: (patched.photos || []).map((p) => ({
            ...p,
            url: `/api/field/maintenance/photos/${p.id}`,
          })),
        };
        json(res, 200, { event, nextEvent: nextEvent || null });
        return true;
      }

      const photoPost = /^\/api\/field\/maintenance\/events\/([0-9a-f-]{36})\/photos$/i.exec(url.pathname);
      if (photoPost && req.method === "POST") {
        const found = await loadAssignedEventRow(user.tenantId, photoPost[1], user.id);
        if (!found) {
          json(res, 404, { error: "Job not found or not assigned to you" });
          return true;
        }
        if (found.status === "done" || found.status === "skipped" || found.status === "approved") {
          json(res, 403, { error: "Completed jobs can only be edited by a manager" });
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
        const photo = await savePhoto(photoPost[1], user.tenantId, {
          buffer: parsed.buffer,
          contentType: parsed.contentType,
          caption: String(body.caption || "").trim(),
          fieldUserId: user.id,
        });
        photo.url = `/api/field/maintenance/photos/${photo.id}`;
        json(res, 201, { photo });
        return true;
      }

      json(res, 404, { error: "Not found" });
      return true;
    }

    if (url.pathname.startsWith("/api/field/dispatch")) {
      const user = await fieldFromRequest(req);
      if (!user) {
        json(res, 401, { error: "Not logged in" });
        return true;
      }
      if (!(await tenantMobileDispatchEnabled(user.tenantId))) {
        json(res, 403, { error: "Dispatch PWA is disabled for this tenant" });
        return true;
      }

      if (url.pathname === "/api/field/dispatch/jobs" && req.method === "GET") {
        const rows = await dbQuery(
          `SELECT * FROM dispatch_jobs
           WHERE tenant_id = $1
             AND assigned_field_user_id = $2
             AND (
               status IN ('assigned', 'en_route', 'arrived')
               OR (
                 status IN ('done', 'cancelled')
                 AND COALESCE(completed_at, updated_at) > now() - interval '90 days'
               )
             )
           ORDER BY
             CASE status
               WHEN 'en_route' THEN 0
               WHEN 'arrived' THEN 1
               WHEN 'assigned' THEN 2
               ELSE 3
             END,
             updated_at DESC
           LIMIT 100`,
          [user.tenantId, user.id],
        );
        const jobs = [];
        for (const row of rows.rows) {
          jobs.push(publicDispatchJob(row, await loadDispatchStops(row.id)));
        }
        json(res, 200, { jobs });
        return true;
      }

      const jobMatch = /^\/api\/field\/dispatch\/jobs\/([0-9a-f-]{36})$/i.exec(url.pathname);
      if (jobMatch && req.method === "GET") {
        const row = await loadAssignedDispatchJob(user.tenantId, jobMatch[1], user.id);
        if (!row) {
          json(res, 404, { error: "Job not found or not assigned to you" });
          return true;
        }
        json(res, 200, { job: publicDispatchJob(row, await loadDispatchStops(row.id)) });
        return true;
      }

      if (jobMatch && req.method === "PATCH") {
        const existing = await loadAssignedDispatchJob(user.tenantId, jobMatch[1], user.id);
        if (!existing) {
          json(res, 404, { error: "Job not found or not assigned to you" });
          return true;
        }
        if (existing.status === "done" || existing.status === "cancelled") {
          json(res, 403, { error: "Completed jobs cannot be edited" });
          return true;
        }
        const body = await readJson(req);
        const allowed = ["en_route", "arrived", "done"];
        const sets = [];
        const params = [];
        if ("status" in body) {
          const status = String(body.status || "").toLowerCase();
          if (!allowed.includes(status)) {
            json(res, 400, { error: "Field may set status to en_route, arrived, or done" });
            return true;
          }
          params.push(status);
          sets.push(`status = $${params.length}`);
          if (status === "en_route") sets.push(`started_at = COALESCE(started_at, now())`);
          if (status === "arrived") sets.push(`arrived_at = COALESCE(arrived_at, now())`);
          if (status === "done") sets.push(`completed_at = COALESCE(completed_at, now())`);
        }
        if ("fieldNote" in body) {
          params.push(String(body.fieldNote || "").trim().slice(0, 2000) || null);
          sets.push(`field_note = $${params.length}`);
        }
        if (!sets.length) {
          json(res, 400, { error: "No fields to update" });
          return true;
        }
        sets.push(`updated_at = now()`);
        params.push(existing.id, user.tenantId, user.id);
        await dbQuery(
          `UPDATE dispatch_jobs SET ${sets.join(", ")}
           WHERE id = $${params.length - 2} AND tenant_id = $${params.length - 1}
             AND assigned_field_user_id = $${params.length}`,
          params,
        );
        const row = await loadAssignedDispatchJob(user.tenantId, existing.id, user.id);
        json(res, 200, { job: publicDispatchJob(row, await loadDispatchStops(row.id)) });
        return true;
      }

      const stopMatch =
        /^\/api\/field\/dispatch\/jobs\/([0-9a-f-]{36})\/stops\/([0-9a-f-]{36})$/i.exec(url.pathname);
      if (stopMatch && req.method === "PATCH") {
        const job = await loadAssignedDispatchJob(user.tenantId, stopMatch[1], user.id);
        if (!job) {
          json(res, 404, { error: "Job not found or not assigned to you" });
          return true;
        }
        if (job.status === "done" || job.status === "cancelled") {
          json(res, 403, { error: "Completed jobs cannot be edited" });
          return true;
        }
        const body = await readJson(req);
        const status = String(body.status || "").toLowerCase();
        if (!["arrived", "done", "skipped"].includes(status)) {
          json(res, 400, { error: "Stop status must be arrived, done, or skipped" });
          return true;
        }
        const updated = await dbQuery(
          `UPDATE dispatch_stops
           SET status = $1,
               arrived_at = CASE WHEN $1 = 'arrived' THEN COALESCE(arrived_at, now()) ELSE arrived_at END,
               completed_at = CASE WHEN $1 IN ('done','skipped') THEN COALESCE(completed_at, now()) ELSE completed_at END
           WHERE id = $2 AND job_id = $3
           RETURNING *`,
          [status, stopMatch[2], job.id],
        );
        if (!updated.rows[0]) {
          json(res, 404, { error: "Stop not found" });
          return true;
        }
        // Auto-bump job to en_route/arrived when first stop progresses
        if (job.status === "assigned" && (status === "arrived" || status === "done")) {
          await dbQuery(
            `UPDATE dispatch_jobs
             SET status = 'en_route', started_at = COALESCE(started_at, now()), updated_at = now()
             WHERE id = $1 AND status = 'assigned'`,
            [job.id],
          );
        }
        const row = await loadAssignedDispatchJob(user.tenantId, job.id, user.id);
        json(res, 200, {
          stop: publicDispatchStop(updated.rows[0]),
          job: publicDispatchJob(row, await loadDispatchStops(row.id)),
        });
        return true;
      }

      const stopPhotosList =
        /^\/api\/field\/dispatch\/jobs\/([0-9a-f-]{36})\/stops\/([0-9a-f-]{36})\/photos$/i.exec(
          url.pathname,
        );
      if (stopPhotosList && req.method === "GET") {
        const job = await loadAssignedDispatchJob(user.tenantId, stopPhotosList[1], user.id);
        if (!job) {
          json(res, 404, { error: "Job not found or not assigned to you" });
          return true;
        }
        const stopOk = await dbQuery(
          `SELECT id FROM dispatch_stops WHERE id = $1 AND job_id = $2`,
          [stopPhotosList[2], job.id],
        );
        if (!stopOk.rows[0]) {
          json(res, 404, { error: "Stop not found" });
          return true;
        }
        const rows = await dbQuery(
          `SELECT id, stop_id, content_type, bytes, caption, created_at
           FROM dispatch_stop_photos WHERE stop_id = $1 ORDER BY created_at DESC LIMIT 50`,
          [stopPhotosList[2]],
        );
        json(res, 200, {
          photos: rows.rows.map((r) => publicDispatchPhoto(r, "/api/field/dispatch/photos")),
        });
        return true;
      }

      if (stopPhotosList && req.method === "POST") {
        const job = await loadAssignedDispatchJob(user.tenantId, stopPhotosList[1], user.id);
        if (!job) {
          json(res, 404, { error: "Job not found or not assigned to you" });
          return true;
        }
        if (job.status === "done" || job.status === "cancelled") {
          json(res, 403, { error: "Completed jobs cannot be edited" });
          return true;
        }
        const stopOk = await dbQuery(
          `SELECT id FROM dispatch_stops WHERE id = $1 AND job_id = $2`,
          [stopPhotosList[2], job.id],
        );
        if (!stopOk.rows[0]) {
          json(res, 404, { error: "Stop not found" });
          return true;
        }
        const body = await readJson(req);
        const parsed = parseDataUrl(body.dataUrl || body.data || "");
        if (!parsed || !parsed.buffer?.length) {
          json(res, 400, { error: "dataUrl image required" });
          return true;
        }
        if (parsed.buffer.length > 8_000_000) {
          json(res, 413, { error: "Image too large" });
          return true;
        }
        const row = await saveDispatchStopPhoto(stopPhotosList[2], user.tenantId, {
          buffer: parsed.buffer,
          contentType: parsed.contentType,
          caption: String(body.caption || "").trim().slice(0, 200) || null,
          fieldUserId: user.id,
        });
        json(res, 201, {
          photo: publicDispatchPhoto(row, "/api/field/dispatch/photos"),
        });
        return true;
      }

      const fieldPhotoGet = /^\/api\/field\/dispatch\/photos\/([0-9a-f-]{36})$/i.exec(url.pathname);
      if (fieldPhotoGet && req.method === "GET") {
        const loaded = await loadDispatchPhotoBytes(fieldPhotoGet[1], user.tenantId);
        if (!loaded) {
          json(res, 404, { error: "Photo not found" });
          return true;
        }
        // Ensure photo belongs to a stop on a job assigned to this user
        const owned = await dbQuery(
          `SELECT p.id
           FROM dispatch_stop_photos p
           JOIN dispatch_stops s ON s.id = p.stop_id
           JOIN dispatch_jobs j ON j.id = s.job_id
           WHERE p.id = $1 AND j.tenant_id = $2 AND j.assigned_field_user_id = $3`,
          [fieldPhotoGet[1], user.tenantId, user.id],
        );
        if (!owned.rows[0]) {
          json(res, 404, { error: "Photo not found" });
          return true;
        }
        send(
          res,
          200,
          {
            "Content-Type": loaded.contentType,
            "Cache-Control": "private, max-age=3600",
          },
          loaded.body,
        );
        return true;
      }

      json(res, 404, { error: "Not found" });
      return true;
    }

    json(res, 404, { error: "Not found" });
    return true;
  } catch (err) {
    const status = err?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[field]", message);
    json(res, status >= 400 && status < 600 ? status : 500, { error: message });
    return true;
  }
}
