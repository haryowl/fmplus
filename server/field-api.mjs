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
import { tenantByKey } from "./tenants.mjs";
import { fetchVehiclePositions } from "./vehicle-positions.mjs";
import {
  formatServiceDate as fieldYmd,
  parseServiceDate,
  todayServiceDate,
} from "./service-day.mjs";
import { dateForDayIndex, dayIndexForDate, spanDayCount } from "./dispatch-span.mjs";
import {
  checkPingRateLimit,
  insertDriverPings,
  MAX_PINGS_PER_BATCH,
  normalizePing,
  PING_MAX_BODY_BYTES,
} from "./driver-pings.mjs";

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

async function readJson(req, limit) {
  const raw = limit == null ? await readBody(req) : await readBody(req, limit);
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

function fieldCoordOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

function cleanPhonePair(lat, lon) {
  const a = fieldCoordOrNull(lat);
  const b = fieldCoordOrNull(lon);
  if (a == null || b == null) return null;
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  if (a === 0 && b === 0) return null;
  return { lat: a, lon: b };
}

function publicDispatchStop(row, jobServiceDate = "") {
  const dayIndex = Number(row.day_index) || 0;
  return {
    id: row.id,
    orderId: row.order_id || null,
    sortOrder: Number(row.sort_order) || 0,
    dayIndex,
    serviceDate: jobServiceDate ? dateForDayIndex(jobServiceDate, dayIndex) : "",
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
    serviceMinutes: row.service_minutes == null ? null : Number(row.service_minutes),
    proofRequired: row.proof_required === true,
    status: row.status || "pending",
    arrivedAt: row.arrived_at || null,
    completedAt: row.completed_at || null,
    startPhoneLat: fieldCoordOrNull(row.start_phone_lat),
    startPhoneLon: fieldCoordOrNull(row.start_phone_lon),
    startArmadaLat: fieldCoordOrNull(row.start_armada_lat),
    startArmadaLon: fieldCoordOrNull(row.start_armada_lon),
    completePhoneLat: fieldCoordOrNull(row.complete_phone_lat),
    completePhoneLon: fieldCoordOrNull(row.complete_phone_lon),
    completeArmadaLat: fieldCoordOrNull(row.complete_armada_lat),
    completeArmadaLon: fieldCoordOrNull(row.complete_armada_lon),
    skipReason: row.skip_reason || "",
    rescheduledTo: fieldYmd(row.rescheduled_to) || null,
    role: row.role === "pickup" ? "pickup" : "drop",
  };
}

function fieldCapacityFrom(row, stops) {
  const volumeCapacityM3 =
    row.volume_capacity_m3 == null ? 12 : Number(row.volume_capacity_m3) || 12;
  const weightCapacityKg =
    row.weight_capacity_kg == null ? 1500 : Number(row.weight_capacity_kg) || 1500;
  let volumeUsed = 0;
  let weightUsed = 0;
  const seenPair = new Set();
  for (const s of stops) {
    const role = s.role || "drop";
    const oid = s.order_id || "";
    if (role === "drop" && oid && seenPair.has(oid)) continue;
    if (role === "pickup" && oid) seenPair.add(oid);
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

function fieldRouteAnchor(lat, lon, label) {
  if (lat == null || lon == null) return null;
  const a = Number(lat);
  const b = Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return { lat: a, lon: b, label: String(label || "").trim() || "Start" };
}

/** Per-day workload of a tour, so the driver can see the legs either side of today. */
function dayLegsFromStops(allStops, serviceDate, endDate) {
  const count = spanDayCount(serviceDate, endDate);
  const legs = [];
  for (let day = 0; day < count; day += 1) {
    const rows = allStops.filter((s) => (Number(s.day_index) || 0) === day);
    legs.push({
      dayIndex: day,
      dayNumber: day + 1,
      serviceDate: dateForDayIndex(serviceDate, day),
      stopCount: rows.length,
      remaining: rows.filter((s) => s.status !== "done" && s.status !== "skipped").length,
    });
  }
  return legs;
}

/**
 * @param row dispatch_jobs row
 * @param stops dispatch_stops rows for the whole tour; narrowed to one day here
 * @param requestedDate the day the driver is looking at, for the "Day 2 of 3" label
 */
function publicDispatchJob(row, stops = [], requestedDate = "") {
  const pathMode = String(row.route_anchor_mode || "").toLowerCase();
  const serviceDate = fieldYmd(row.service_date);
  const endDate = fieldYmd(row.end_date) || serviceDate;
  const dayCount = spanDayCount(serviceDate, endDate);
  const dayIndex = requestedDate
    ? (dayIndexForDate(serviceDate, endDate, requestedDate) ?? 0)
    : 0;
  // A driver works one leg at a time; single-day jobs are entirely day 0.
  const dayStops = stops.filter((s) => (Number(s.day_index) || 0) === dayIndex);
  const cap = fieldCapacityFrom(row, dayStops);
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
    serviceDate,
    endDate,
    dayCount,
    dayNumber: dayIndex + 1,
    dayIndex,
    dayLegs: dayCount > 1 ? dayLegsFromStops(stops, serviceDate, endDate) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    routeAnchorMode: pathMode === "map" || pathMode === "sequence" ? pathMode : null,
    routeStart: fieldRouteAnchor(
      row.route_start_lat,
      row.route_start_lon,
      row.route_start_label || "Start",
    ),
    routeEnd: fieldRouteAnchor(
      row.route_end_lat,
      row.route_end_lon,
      row.route_end_label || "Return",
    ),
    ...cap,
    stops: dayStops.map((s) => publicDispatchStop(s, serviceDate)),
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

/** Every stop of a tour; publicDispatchJob narrows to the day being worked. */
async function loadDispatchStops(jobId) {
  const all = await dbQuery(
    `SELECT * FROM dispatch_stops WHERE job_id = $1 ORDER BY sort_order ASC, created_at ASC`,
    [jobId],
  );
  return all.rows;
}

async function resolveArmadaCoords(user, armadaUserId) {
  if (armadaUserId == null) return null;
  const vault = tenantByKey(user.tenantKey);
  if (!vault?.appId || !vault?.token) return null;
  const map = await fetchVehiclePositions(vault);
  const pos = map.get(Number(armadaUserId));
  if (!pos) return null;
  return { lat: pos.lat, lon: pos.lon };
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

    if (url.pathname === "/api/field/location" && req.method === "POST") {
      const user = await fieldFromRequest(req);
      if (!user) {
        json(res, 401, { error: "Not logged in" });
        return true;
      }
      if (!(await tenantMobileDispatchEnabled(user.tenantId))) {
        json(res, 403, { error: "Mobile Dispatch is not enabled for this tenant" });
        return true;
      }
      const limit = checkPingRateLimit(user.id);
      if (!limit.ok) {
        json(
          res,
          429,
          { error: "Too many location updates — slow down", retryAfterSec: limit.retryAfterSec },
          { "Retry-After": String(limit.retryAfterSec) },
        );
        return true;
      }
      const body = await readJson(req, PING_MAX_BODY_BYTES);
      const raw = Array.isArray(body.pings)
        ? body.pings
        : body.lat != null || body.latitude != null
          ? [body]
          : [];
      if (!raw.length) {
        json(res, 400, { error: "pings[] is required" });
        return true;
      }
      if (raw.length > MAX_PINGS_PER_BATCH) {
        json(res, 400, { error: `At most ${MAX_PINGS_PER_BATCH} pings per request` });
        return true;
      }
      const valid = [];
      const rejected = [];
      for (let i = 0; i < raw.length; i++) {
        const check = normalizePing(raw[i]);
        if (check.ok) valid.push(check.ping);
        else rejected.push({ index: i, reason: check.reason });
      }
      const accepted = valid.length
        ? await insertDriverPings(user.tenantId, user.id, valid)
        : 0;
      json(res, 200, {
        accepted,
        duplicates: valid.length - accepted,
        rejected,
        serverTime: new Date().toISOString(),
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

      if (url.pathname === "/api/field/dispatch/calendar" && req.method === "GET") {
        const fromParam = String(url.searchParams.get("from") || "").trim().slice(0, 10);
        const toParam = String(url.searchParams.get("to") || "").trim().slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fromParam) || !/^\d{4}-\d{2}-\d{2}$/.test(toParam)) {
          json(res, 400, { error: "from and to are required as YYYY-MM-DD" });
          return true;
        }
        // A multi-day tour is marked on every day it covers, so the driver's month
        // view does not go blank on days 2..N of a job.
        const rows = await dbQuery(
          `SELECT d::text AS service_date, COUNT(*)::int AS job_count
           FROM dispatch_jobs j
           CROSS JOIN LATERAL generate_series(
             GREATEST(j.service_date, $3::date),
             LEAST(COALESCE(j.end_date, j.service_date), $4::date),
             interval '1 day'
           ) AS d
           WHERE j.tenant_id = $1
             AND j.assigned_field_user_id = $2
             AND j.service_date <= $4::date
             AND COALESCE(j.end_date, j.service_date) >= $3::date
             AND j.status IN ('assigned', 'en_route', 'arrived', 'done')
           GROUP BY d
           ORDER BY d ASC`,
          [user.tenantId, user.id, fromParam, toParam],
        );
        const summaryRows = await dbQuery(
          `SELECT
             COUNT(*) FILTER (WHERE status = 'assigned')::int AS pending,
             COUNT(*) FILTER (WHERE status IN ('en_route', 'arrived'))::int AS in_progress,
             COUNT(*) FILTER (WHERE status = 'done')::int AS completed
           FROM dispatch_jobs
           WHERE tenant_id = $1
             AND assigned_field_user_id = $2
             AND service_date <= $4::date
             AND COALESCE(end_date, service_date) >= $3::date
             AND status IN ('assigned', 'en_route', 'arrived', 'done')`,
          [user.tenantId, user.id, fromParam, toParam],
        );
        const summary = summaryRows.rows[0] || {};
        json(res, 200, {
          from: fromParam,
          to: toParam,
          days: rows.rows.map((r) => ({
            date: fieldYmd(r.service_date),
            jobCount: Number(r.job_count) || 0,
          })),
          summary: {
            pending: Number(summary.pending) || 0,
            inProgress: Number(summary.in_progress) || 0,
            completed: Number(summary.completed) || 0,
          },
        });
        return true;
      }

      if (url.pathname === "/api/field/dispatch/jobs" && req.method === "GET") {
        const dateParam = String(url.searchParams.get("date") || "").trim().slice(0, 10);
        const serviceDate = parseServiceDate(dateParam) || todayServiceDate();
        const rows = await dbQuery(
          `SELECT * FROM dispatch_jobs
           WHERE tenant_id = $1
             AND assigned_field_user_id = $2
             AND $3::date BETWEEN service_date AND COALESCE(end_date, service_date)
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
          [user.tenantId, user.id, serviceDate],
        );
        const jobs = [];
        for (const row of rows.rows) {
          // publicDispatchJob narrows to the leg being worked and summarises the rest.
          jobs.push(publicDispatchJob(row, await loadDispatchStops(row.id), serviceDate));
        }
        json(res, 200, { jobs, serviceDate });
        return true;
      }

      const jobMatch = /^\/api\/field\/dispatch\/jobs\/([0-9a-f-]{36})$/i.exec(url.pathname);
      if (jobMatch && req.method === "GET") {
        const row = await loadAssignedDispatchJob(user.tenantId, jobMatch[1], user.id);
        if (!row) {
          json(res, 404, { error: "Job not found or not assigned to you" });
          return true;
        }
        json(res, 200, { job: publicDispatchJob(row, await loadDispatchStops(row.id), todayServiceDate()) });
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
        json(res, 200, { job: publicDispatchJob(row, await loadDispatchStops(row.id), todayServiceDate()) });
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
        const stopId = stopMatch[2];
        const existingStop = await dbQuery(
          `SELECT * FROM dispatch_stops WHERE id = $1 AND job_id = $2`,
          [stopId, job.id],
        );
        const stopRow = existingStop.rows[0];
        if (!stopRow) {
          json(res, 404, { error: "Stop not found" });
          return true;
        }

        const phone = cleanPhonePair(body.phoneLat ?? body.lat, body.phoneLon ?? body.lon ?? body.lng);

        // Notes-only update while in progress (no status change)
        if (!("status" in body) && "notes" in body) {
          if (stopRow.status !== "arrived" && stopRow.status !== "pending") {
            json(res, 400, { error: "Notes can only be updated before the stop is completed" });
            return true;
          }
          const updated = await dbQuery(
            `UPDATE dispatch_stops
             SET notes = $1
             WHERE id = $2 AND job_id = $3
             RETURNING *`,
            [String(body.notes || "").trim().slice(0, 2000) || null, stopId, job.id],
          );
          const row = await loadAssignedDispatchJob(user.tenantId, job.id, user.id);
          json(res, 200, {
            stop: publicDispatchStop(updated.rows[0], fieldYmd(job.service_date)),
            job: publicDispatchJob(row, await loadDispatchStops(row.id), todayServiceDate()),
          });
          return true;
        }

        const status = String(body.status || "").toLowerCase();
        if (!["arrived", "done", "skipped"].includes(status)) {
          json(res, 400, { error: "Stop status must be arrived, done, or skipped" });
          return true;
        }

        if (stopRow.role === "drop" && stopRow.order_id) {
          const pickup = await dbQuery(
            `SELECT status FROM dispatch_stops
             WHERE job_id = $1 AND order_id = $2 AND role = 'pickup' LIMIT 1`,
            [job.id, stopRow.order_id],
          );
          if (pickup.rows[0] && pickup.rows[0].status !== "done") {
            json(res, 400, { error: "Finish pickup before this drop" });
            return true;
          }
        }

        // Only a real status change needs vehicle evidence; resolving this
        // costs a full Armada usersstatus round-trip per call.
        const armada = await resolveArmadaCoords(user, job.armada_user_id);

        if (stopRow.status === "done") {
          json(res, 400, { error: "Completed stops cannot be changed" });
          return true;
        }
        if (stopRow.status === "skipped" && status !== "skipped") {
          json(res, 400, { error: "Skipped stops cannot be changed" });
          return true;
        }

        if (status === "done" && stopRow.proof_required === true) {
          const photos = await dbQuery(
            `SELECT id FROM dispatch_stop_photos WHERE stop_id = $1 LIMIT 1`,
            [stopId],
          );
          if (!photos.rows[0]) {
            json(res, 400, { error: "Proof photo is required before finishing this order" });
            return true;
          }
        }

        let skipReason = null;
        let rescheduleDate = null;
        if (status === "skipped") {
          skipReason = String(body.skipReason || body.reason || "").trim().slice(0, 500);
          if (!skipReason) {
            json(res, 400, { error: "Reason is required to skip / reschedule" });
            return true;
          }
          rescheduleDate = String(body.rescheduleDate || body.rescheduledTo || "")
            .trim()
            .slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(rescheduleDate)) {
            json(res, 400, { error: "rescheduleDate is required (YYYY-MM-DD)" });
            return true;
          }
          const jobDate = fieldYmd(job.service_date);
          if (jobDate && rescheduleDate < jobDate) {
            json(res, 400, { error: "Reschedule date cannot be before the job service date" });
            return true;
          }
        }

        // A reschedule that lands on a later day of this same tour is just a move
        // between legs: the stop and its order stay put, so no detach round-trip.
        let carryToDayIndex = null;
        if (status === "skipped") {
          const jobDate = fieldYmd(job.service_date);
          const jobEnd = fieldYmd(job.end_date) || jobDate;
          const target = dayIndexForDate(jobDate, jobEnd, rescheduleDate);
          if (target != null && target > (Number(stopRow.day_index) || 0)) {
            carryToDayIndex = target;
          }
        }

        // Moved-within-tour stops come back as open work on their new day.
        const nextStatus = carryToDayIndex != null ? "pending" : status;
        const sets = [`status = $1`];
        const params = [nextStatus];
        if (status === "arrived") {
          sets.push(`arrived_at = COALESCE(arrived_at, now())`);
          if (phone) {
            params.push(phone.lat, phone.lon);
            sets.push(`start_phone_lat = COALESCE(start_phone_lat, $${params.length - 1})`);
            sets.push(`start_phone_lon = COALESCE(start_phone_lon, $${params.length})`);
          }
          if (armada) {
            params.push(armada.lat, armada.lon);
            sets.push(`start_armada_lat = COALESCE(start_armada_lat, $${params.length - 1})`);
            sets.push(`start_armada_lon = COALESCE(start_armada_lon, $${params.length})`);
          }
        }
        if (status === "done" || status === "skipped") {
          sets.push(`completed_at = COALESCE(completed_at, now())`);
          sets.push(`arrived_at = COALESCE(arrived_at, now())`);
          if (phone) {
            params.push(phone.lat, phone.lon);
            sets.push(`complete_phone_lat = $${params.length - 1}`);
            sets.push(`complete_phone_lon = $${params.length}`);
          }
          if (armada) {
            params.push(armada.lat, armada.lon);
            sets.push(`complete_armada_lat = $${params.length - 1}`);
            sets.push(`complete_armada_lon = $${params.length}`);
          }
        }
        if (status === "skipped") {
          params.push(skipReason);
          sets.push(`skip_reason = $${params.length}`);
          params.push(rescheduleDate);
          sets.push(`rescheduled_to = $${params.length}::date`);
          if (carryToDayIndex != null) {
            const tail = await dbQuery(
              `SELECT COALESCE(MAX(sort_order), -1)::int AS m
               FROM dispatch_stops WHERE job_id = $1 AND day_index = $2 AND id <> $3`,
              [job.id, carryToDayIndex, stopId],
            );
            params.push(carryToDayIndex);
            sets.push(`day_index = $${params.length}`);
            params.push((tail.rows[0]?.m ?? -1) + 1);
            sets.push(`sort_order = $${params.length}`);
            sets.push(`planned_eta = NULL`, `arrived_at = NULL`);
          }
        }
        if ("notes" in body) {
          params.push(String(body.notes || "").trim().slice(0, 2000) || null);
          sets.push(`notes = $${params.length}`);
        }
        params.push(stopId, job.id);
        const updated = await dbQuery(
          `UPDATE dispatch_stops
           SET ${sets.join(", ")}
           WHERE id = $${params.length - 1} AND job_id = $${params.length}
           RETURNING *`,
          params,
        );
        if (!updated.rows[0]) {
          json(res, 404, { error: "Stop not found" });
          return true;
        }

        // Skipping pickup also returns/blocks the paired drop.
        if (status === "skipped" && stopRow.role === "pickup" && stopRow.order_id) {
          const mate = await dbQuery(
            `SELECT * FROM dispatch_stops
             WHERE job_id = $1 AND order_id = $2 AND role = 'drop' AND id <> $3 LIMIT 1`,
            [job.id, stopRow.order_id, stopId],
          );
          const drop = mate.rows[0];
          if (drop && drop.status !== "done" && drop.status !== "skipped") {
            if (carryToDayIndex != null) {
              const tail = await dbQuery(
                `SELECT COALESCE(MAX(sort_order), -1)::int AS m
                 FROM dispatch_stops WHERE job_id = $1 AND day_index = $2 AND id <> $3`,
                [job.id, carryToDayIndex, drop.id],
              );
              await dbQuery(
                `UPDATE dispatch_stops
                 SET status = 'pending', day_index = $1, sort_order = $2,
                     planned_eta = NULL, arrived_at = NULL, skip_reason = $3,
                     rescheduled_to = $4::date
                 WHERE id = $5 AND job_id = $6`,
                [
                  carryToDayIndex,
                  (tail.rows[0]?.m ?? -1) + 1,
                  skipReason,
                  rescheduleDate,
                  drop.id,
                  job.id,
                ],
              );
            } else {
              await dbQuery(
                `UPDATE dispatch_stops
                 SET status = 'skipped', completed_at = COALESCE(completed_at, now()),
                     arrived_at = COALESCE(arrived_at, now()), skip_reason = $1,
                     rescheduled_to = $2::date
                 WHERE id = $3 AND job_id = $4`,
                [skipReason, rescheduleDate, drop.id, job.id],
              );
            }
          }
        }

        // Reuse same order: detach and move to reschedule date (order number unchanged)
        if (status === "skipped" && carryToDayIndex == null && stopRow.order_id) {
          await dbQuery(
            `UPDATE dispatch_orders
             SET status = 'pending',
                 job_id = NULL,
                 stop_id = NULL,
                 service_date = $1::date,
                 updated_at = now()
             WHERE id = $2 AND tenant_id = $3`,
            [rescheduleDate, stopRow.order_id, user.tenantId],
          );
        }

        // Carried inside the tour: the order keeps its job but follows the new day.
        if (carryToDayIndex != null && stopRow.order_id) {
          await dbQuery(
            `UPDATE dispatch_orders
             SET service_date = $1::date, updated_at = now()
             WHERE id = $2 AND tenant_id = $3`,
            [rescheduleDate, stopRow.order_id, user.tenantId],
          );
        }

        // Auto-bump job to en_route when first stop progresses
        if (
          job.status === "assigned" &&
          (status === "arrived" || status === "done" || status === "skipped")
        ) {
          await dbQuery(
            `UPDATE dispatch_jobs
             SET status = 'en_route', started_at = COALESCE(started_at, now()), updated_at = now()
             WHERE id = $1 AND status = 'assigned'`,
            [job.id],
          );
        }
        const row = await loadAssignedDispatchJob(user.tenantId, job.id, user.id);
        json(res, 200, {
          stop: publicDispatchStop(updated.rows[0], fieldYmd(job.service_date)),
          job: publicDispatchJob(row, await loadDispatchStops(row.id), todayServiceDate()),
          gps: {
            phone: phone || null,
            armada: armada || null,
          },
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
