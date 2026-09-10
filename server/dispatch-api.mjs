/**
 * Phase F+ — Dispatch desk (jobs, orders, capacity, POD photos).
 * GET/POST /api/dispatch/jobs
 * GET/PATCH /api/dispatch/jobs/:id
 * POST /api/dispatch/jobs/:id/assign-orders
 * POST /api/dispatch/jobs/:id/optimize-stops
 * GET/POST /api/dispatch/orders
 * PATCH /api/dispatch/orders/:id
 * GET /api/dispatch/stops/:stopId/photos
 * GET /api/dispatch/photos/:id
 * GET /api/dispatch/field-users
 */
import crypto from "node:crypto";
import { databaseUrlConfigured, dbQuery } from "./db.mjs";
import { mergeEntitlements, moduleEnabled } from "./entitlements.mjs";
import { resolveDbTenant } from "./maintenance-api.mjs";
import { optimizeOpenTour } from "./route-optimize.mjs";
import { getObject, objectStorageConfigured, putObject } from "./storage.mjs";
import { securityHeaders } from "./proxy-lt.mjs";

const STATUSES = ["draft", "assigned", "en_route", "arrived", "done", "cancelled"];
const STOP_STATUSES = ["pending", "arrived", "done", "skipped"];
const ORDER_STATUSES = ["pending", "assigned", "cancelled"];

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

function readBody(req, limit = 512_000) {
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
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** YYYY-MM-DD or null. */
function parseServiceDate(v) {
  const s = String(v || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T12:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return s;
}

function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatServiceDate(rowVal) {
  if (!rowVal) return "";
  if (rowVal instanceof Date) return rowVal.toISOString().slice(0, 10);
  return String(rowVal).slice(0, 10);
}

function publicStop(row) {
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

function capacityFrom(row, stops) {
  const volumeCapacityM3 =
    row.volume_capacity_m3 == null ? 12 : Number(row.volume_capacity_m3) || 12;
  const weightCapacityKg =
    row.weight_capacity_kg == null ? 1500 : Number(row.weight_capacity_kg) || 1500;
  let volumeUsed = 0;
  let weightUsed = 0;
  for (const s of stops) {
    if (s.volume_m3 != null) volumeUsed += Number(s.volume_m3) || 0;
    else if (s.volumeM3 != null) volumeUsed += Number(s.volumeM3) || 0;
    if (s.weight_kg != null) weightUsed += Number(s.weight_kg) || 0;
    else if (s.weightKg != null) weightUsed += Number(s.weightKg) || 0;
  }
  const utilV = volumeCapacityM3 > 0 ? (volumeUsed / volumeCapacityM3) * 100 : 0;
  const utilW = weightCapacityKg > 0 ? (weightUsed / weightCapacityKg) * 100 : 0;
  const utilizationPct = Math.round(Math.max(utilV, utilW) * 10) / 10;
  return {
    volumeCapacityM3,
    weightCapacityKg,
    volumeUsed: Math.round(volumeUsed * 1000) / 1000,
    weightUsed: Math.round(weightUsed * 10) / 10,
    utilizationPct,
  };
}

function publicJob(row, stops = []) {
  const cap = capacityFrom(row, stops);
  return {
    id: row.id,
    status: row.status,
    title: row.title || "",
    notes: row.notes || "",
    armadaUserId: row.armada_user_id == null ? null : Number(row.armada_user_id),
    armadaUsername: row.armada_username || "",
    userDisplayName: row.user_display_name || "",
    assignedFieldUserId: row.assigned_field_user_id || null,
    assigneeUsername: row.assignee_username || "",
    assigneeDisplayName: row.assignee_display_name || "",
    assignedAt: row.assigned_at || null,
    startedAt: row.started_at || null,
    arrivedAt: row.arrived_at || null,
    completedAt: row.completed_at || null,
    fieldNote: row.field_note || "",
    serviceDate: formatServiceDate(row.service_date) || todayYmd(),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...cap,
    stops: stops.map(publicStop),
  };
}

function publicOrder(row) {
  return {
    id: row.id,
    externalRef: row.external_ref || "",
    customerName: row.customer_name || "",
    address: row.address || "",
    lat: row.lat == null ? null : Number(row.lat),
    lon: row.lon == null ? null : Number(row.lon),
    zone: row.zone || "",
    volumeM3: row.volume_m3 == null ? null : Number(row.volume_m3),
    weightKg: row.weight_kg == null ? null : Number(row.weight_kg),
    windowStart: row.window_start || "",
    windowEnd: row.window_end || "",
    serviceDate: formatServiceDate(row.service_date) || todayYmd(),
    status: row.status || "pending",
    jobId: row.job_id || null,
    stopId: row.stop_id || null,
    notes: row.notes || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function publicDispatchPhoto(row, urlPrefix = "/api/dispatch/photos") {
  return {
    id: row.id,
    stopId: row.stop_id || null,
    contentType: row.content_type || "",
    bytes: row.bytes == null ? null : Number(row.bytes),
    caption: row.caption || "",
    createdAt: row.created_at,
    url: `${urlPrefix}/${row.id}`,
  };
}

async function loadStops(jobId) {
  const rows = await dbQuery(
    `SELECT id, order_id, sort_order, name, address, lat, lon, notes, zone,
            volume_m3, weight_kg, window_start, window_end,
            status, arrived_at, completed_at
     FROM dispatch_stops WHERE job_id = $1 ORDER BY sort_order ASC, created_at ASC`,
    [jobId],
  );
  return rows.rows;
}

async function loadJob(tenantId, jobId) {
  const found = await dbQuery(
    `SELECT j.*,
            u.username AS assignee_username,
            u.display_name AS assignee_display_name
     FROM dispatch_jobs j
     LEFT JOIN field_users u ON u.id = j.assigned_field_user_id
     WHERE j.id = $1 AND j.tenant_id = $2`,
    [jobId, tenantId],
  );
  return found.rows[0] || null;
}

async function requireDispatchModule(tenantId) {
  const row = await dbQuery(`SELECT entitlements FROM tenants WHERE id = $1`, [tenantId]);
  const ent = mergeEntitlements(row.rows[0]?.entitlements);
  return moduleEnabled(ent, "dispatch");
}

function normalizeStops(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (let i = 0; i < raw.length && out.length < 50; i++) {
    const s = raw[i];
    if (!s || typeof s !== "object") continue;
    const lat = s.lat == null || s.lat === "" ? null : Number(s.lat);
    const lon = s.lon == null || s.lon === "" ? null : Number(s.lon ?? s.lng);
    out.push({
      name: String(s.name || s.label || `Stop ${i + 1}`).trim().slice(0, 200) || `Stop ${i + 1}`,
      address: String(s.address || "").trim().slice(0, 500) || null,
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      notes: String(s.notes || "").trim().slice(0, 1000) || null,
      zone: String(s.zone || "").trim().slice(0, 80) || null,
      volumeM3: numOrNull(s.volumeM3 ?? s.volume_m3),
      weightKg: numOrNull(s.weightKg ?? s.weight_kg),
      windowStart: String(s.windowStart || s.window_start || "").trim().slice(0, 16) || null,
      windowEnd: String(s.windowEnd || s.window_end || "").trim().slice(0, 16) || null,
      orderId: s.orderId || s.order_id || null,
      sortOrder: Number.isInteger(Number(s.sortOrder)) ? Number(s.sortOrder) : i,
    });
  }
  return out;
}

async function replaceStops(jobId, stops) {
  await dbQuery(`UPDATE dispatch_orders SET stop_id = NULL, job_id = NULL, status = 'pending', updated_at = now()
                 WHERE job_id = $1 AND status = 'assigned'`, [jobId]);
  await dbQuery(`DELETE FROM dispatch_stops WHERE job_id = $1`, [jobId]);
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    const inserted = await dbQuery(
      `INSERT INTO dispatch_stops (
         job_id, sort_order, name, address, lat, lon, notes,
         zone, volume_m3, weight_kg, window_start, window_end, order_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [
        jobId,
        s.sortOrder ?? i,
        s.name,
        s.address,
        s.lat,
        s.lon,
        s.notes,
        s.zone,
        s.volumeM3,
        s.weightKg,
        s.windowStart,
        s.windowEnd,
        s.orderId,
      ],
    );
    if (s.orderId) {
      await dbQuery(
        `UPDATE dispatch_orders
         SET status = 'assigned', job_id = $1, stop_id = $2, updated_at = now()
         WHERE id = $3`,
        [jobId, inserted.rows[0].id, s.orderId],
      );
    }
  }
}

export async function saveDispatchStopPhoto(stopId, tenantId, { buffer, contentType, caption, fieldUserId }) {
  const ct = contentType || "image/jpeg";
  let key;
  let payload = null;
  if (objectStorageConfigured()) {
    key = `dispatch-pod/${tenantId}/${stopId}/${crypto.randomUUID()}`;
    await putObject(key, buffer, ct);
  } else {
    key = `inline/dispatch-pod/${tenantId}/${stopId}/${crypto.randomUUID()}`;
    payload = buffer;
  }
  const inserted = await dbQuery(
    `INSERT INTO dispatch_stop_photos
       (stop_id, storage_key, content_type, bytes, caption, uploaded_by_field_user_id, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, stop_id, content_type, bytes, caption, created_at`,
    [stopId, key, ct, buffer.length, caption || null, fieldUserId || null, payload],
  );
  return inserted.rows[0];
}

export async function loadDispatchPhotoBytes(photoId, tenantId) {
  const found = await dbQuery(
    `SELECT p.storage_key, p.content_type, p.payload
     FROM dispatch_stop_photos p
     JOIN dispatch_stops s ON s.id = p.stop_id
     JOIN dispatch_jobs j ON j.id = s.job_id
     WHERE p.id = $1 AND j.tenant_id = $2`,
    [photoId, tenantId],
  );
  const row = found.rows[0];
  if (!row) return null;
  if (row.payload) {
    const body = Buffer.isBuffer(row.payload) ? row.payload : Buffer.from(row.payload);
    return { body, contentType: row.content_type || "image/jpeg" };
  }
  const obj = await getObject(row.storage_key);
  return {
    body: obj.body,
    contentType: obj.contentType || row.content_type || "image/jpeg",
  };
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export async function handleDispatchRequest(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  if (!url.pathname.startsWith("/api/dispatch")) return false;

  try {
    if (!databaseUrlConfigured()) {
      json(res, 503, { error: "Database not configured" });
      return true;
    }
    const dbTenant = await resolveDbTenant(req);
    if (!dbTenant) {
      json(res, 401, { error: "Tenant key required (k=)" });
      return true;
    }
    if (!(await requireDispatchModule(dbTenant.id))) {
      json(res, 403, { error: "Dispatch module not enabled for this tenant" });
      return true;
    }

    if (url.pathname === "/api/dispatch/field-users" && req.method === "GET") {
      const rows = await dbQuery(
        `SELECT id, username, role, display_name, enabled
         FROM field_users
         WHERE tenant_id = $1 AND enabled = true
         ORDER BY lower(coalesce(nullif(display_name,''), username)) ASC
         LIMIT 200`,
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

    // —— Orders ——
    if (url.pathname === "/api/dispatch/orders" && req.method === "GET") {
      const status = String(url.searchParams.get("status") || "pending").toLowerCase();
      const date = parseServiceDate(url.searchParams.get("date")) || todayYmd();
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
      const clauses = ["tenant_id = $1", "service_date = $2"];
      const params = [dbTenant.id, date];
      if (status === "open" || status === "pending") {
        clauses.push(`status = 'pending'`);
      } else if (ORDER_STATUSES.includes(status)) {
        params.push(status);
        clauses.push(`status = $${params.length}`);
      } else if (status !== "all") {
        json(res, 400, { error: "Invalid order status filter" });
        return true;
      }
      params.push(limit);
      const rows = await dbQuery(
        `SELECT * FROM dispatch_orders
         WHERE ${clauses.join(" AND ")}
         ORDER BY updated_at DESC
         LIMIT $${params.length}`,
        params,
      );
      json(res, 200, { orders: rows.rows.map(publicOrder), serviceDate: date });
      return true;
    }

    if (url.pathname === "/api/dispatch/orders" && req.method === "POST") {
      const body = await readJson(req);
      const customerName = String(body.customerName || body.name || "").trim().slice(0, 200);
      if (!customerName) {
        json(res, 400, { error: "customerName is required" });
        return true;
      }
      const lat = numOrNull(body.lat);
      const lon = numOrNull(body.lon ?? body.lng);
      const serviceDate = parseServiceDate(body.serviceDate) || todayYmd();
      const inserted = await dbQuery(
        `INSERT INTO dispatch_orders (
           tenant_id, external_ref, customer_name, address, lat, lon, zone,
           volume_m3, weight_kg, window_start, window_end, notes, service_date
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          dbTenant.id,
          String(body.externalRef || "").trim().slice(0, 80) || null,
          customerName,
          String(body.address || "").trim().slice(0, 500) || null,
          lat,
          lon,
          String(body.zone || "").trim().slice(0, 80) || null,
          numOrNull(body.volumeM3),
          numOrNull(body.weightKg),
          String(body.windowStart || "").trim().slice(0, 16) || null,
          String(body.windowEnd || "").trim().slice(0, 16) || null,
          String(body.notes || "").trim().slice(0, 2000) || null,
          serviceDate,
        ],
      );
      json(res, 201, { order: publicOrder(inserted.rows[0]) });
      return true;
    }

    const orderOne = /^\/api\/dispatch\/orders\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (orderOne && req.method === "PATCH") {
      const existing = await dbQuery(
        `SELECT * FROM dispatch_orders WHERE id = $1 AND tenant_id = $2`,
        [orderOne[1], dbTenant.id],
      );
      if (!existing.rows[0]) {
        json(res, 404, { error: "Order not found" });
        return true;
      }
      const body = await readJson(req);
      const sets = [];
      const params = [];
      const map = {
        externalRef: ["external_ref", (v) => String(v || "").trim().slice(0, 80) || null],
        customerName: ["customer_name", (v) => String(v || "").trim().slice(0, 200)],
        address: ["address", (v) => String(v || "").trim().slice(0, 500) || null],
        zone: ["zone", (v) => String(v || "").trim().slice(0, 80) || null],
        notes: ["notes", (v) => String(v || "").trim().slice(0, 2000) || null],
        windowStart: ["window_start", (v) => String(v || "").trim().slice(0, 16) || null],
        windowEnd: ["window_end", (v) => String(v || "").trim().slice(0, 16) || null],
      };
      for (const [key, [col, fn]] of Object.entries(map)) {
        if (key in body) {
          const val = fn(body[key]);
          if (key === "customerName" && !val) {
            json(res, 400, { error: "customerName cannot be empty" });
            return true;
          }
          params.push(val);
          sets.push(`${col} = $${params.length}`);
        }
      }
      if ("serviceDate" in body) {
        const sd = parseServiceDate(body.serviceDate);
        if (!sd) {
          json(res, 400, { error: "Invalid serviceDate (use YYYY-MM-DD)" });
          return true;
        }
        params.push(sd);
        sets.push(`service_date = $${params.length}`);
      }
      if ("lat" in body) {
        params.push(numOrNull(body.lat));
        sets.push(`lat = $${params.length}`);
      }
      if ("lon" in body || "lng" in body) {
        params.push(numOrNull(body.lon ?? body.lng));
        sets.push(`lon = $${params.length}`);
      }
      if ("volumeM3" in body) {
        params.push(numOrNull(body.volumeM3));
        sets.push(`volume_m3 = $${params.length}`);
      }
      if ("weightKg" in body) {
        params.push(numOrNull(body.weightKg));
        sets.push(`weight_kg = $${params.length}`);
      }
      if ("status" in body) {
        const st = String(body.status || "").toLowerCase();
        if (!ORDER_STATUSES.includes(st)) {
          json(res, 400, { error: "Invalid order status" });
          return true;
        }
        params.push(st);
        sets.push(`status = $${params.length}`);
      }
      if (!sets.length) {
        json(res, 400, { error: "No fields to update" });
        return true;
      }
      sets.push(`updated_at = now()`);
      params.push(orderOne[1], dbTenant.id);
      const updated = await dbQuery(
        `UPDATE dispatch_orders SET ${sets.join(", ")}
         WHERE id = $${params.length - 1} AND tenant_id = $${params.length}
         RETURNING *`,
        params,
      );
      json(res, 200, { order: publicOrder(updated.rows[0]) });
      return true;
    }

    // —— Photos ——
    const stopPhotos = /^\/api\/dispatch\/stops\/([0-9a-f-]{36})\/photos$/i.exec(url.pathname);
    if (stopPhotos && req.method === "GET") {
      const ok = await dbQuery(
        `SELECT s.id FROM dispatch_stops s
         JOIN dispatch_jobs j ON j.id = s.job_id
         WHERE s.id = $1 AND j.tenant_id = $2`,
        [stopPhotos[1], dbTenant.id],
      );
      if (!ok.rows[0]) {
        json(res, 404, { error: "Stop not found" });
        return true;
      }
      const rows = await dbQuery(
        `SELECT id, stop_id, content_type, bytes, caption, created_at
         FROM dispatch_stop_photos WHERE stop_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [stopPhotos[1]],
      );
      json(res, 200, { photos: rows.rows.map((r) => publicDispatchPhoto(r)) });
      return true;
    }

    const photoGet = /^\/api\/dispatch\/photos\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (photoGet && req.method === "GET") {
      const loaded = await loadDispatchPhotoBytes(photoGet[1], dbTenant.id);
      if (!loaded) {
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

    // —— Jobs ——
    if (url.pathname === "/api/dispatch/jobs" && req.method === "GET") {
      const status = String(url.searchParams.get("status") || "open").toLowerCase();
      const date = parseServiceDate(url.searchParams.get("date")) || todayYmd();
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
      const clauses = ["j.tenant_id = $1", "j.service_date = $2"];
      const params = [dbTenant.id, date];
      if (status === "open") {
        clauses.push(`j.status IN ('draft','assigned','en_route','arrived')`);
      } else if (STATUSES.includes(status)) {
        params.push(status);
        clauses.push(`j.status = $${params.length}`);
      } else if (status !== "all") {
        json(res, 400, { error: "Invalid status filter" });
        return true;
      }
      params.push(limit);
      const rows = await dbQuery(
        `SELECT j.*,
                u.username AS assignee_username,
                u.display_name AS assignee_display_name
         FROM dispatch_jobs j
         LEFT JOIN field_users u ON u.id = j.assigned_field_user_id
         WHERE ${clauses.join(" AND ")}
         ORDER BY j.updated_at DESC
         LIMIT $${params.length}`,
        params,
      );
      const jobs = [];
      for (const row of rows.rows) {
        const stops = await loadStops(row.id);
        jobs.push(publicJob(row, stops));
      }
      json(res, 200, { jobs, serviceDate: date });
      return true;
    }

    if (url.pathname === "/api/dispatch/jobs" && req.method === "POST") {
      const body = await readJson(req);
      const title = String(body.title || "").trim().slice(0, 200);
      if (!title) {
        json(res, 400, { error: "title is required" });
        return true;
      }
      const notes = String(body.notes || "").trim().slice(0, 4000) || null;
      const armadaUserId =
        body.armadaUserId == null || body.armadaUserId === ""
          ? null
          : Number.isInteger(Number(body.armadaUserId)) && Number(body.armadaUserId) > 0
            ? Number(body.armadaUserId)
            : null;
      const armadaUsername = String(body.armadaUsername || "").trim().slice(0, 120) || null;
      const userDisplayName = String(body.userDisplayName || "").trim().slice(0, 200) || null;
      let assigneeId = body.assignedFieldUserId || null;
      if (assigneeId) {
        const ok = await dbQuery(
          `SELECT id FROM field_users WHERE id = $1 AND tenant_id = $2 AND enabled = true`,
          [assigneeId, dbTenant.id],
        );
        if (!ok.rows[0]) {
          json(res, 400, { error: "assignedFieldUserId not found" });
          return true;
        }
      }
      let status = String(body.status || (assigneeId ? "assigned" : "draft")).toLowerCase();
      if (!STATUSES.includes(status)) status = assigneeId ? "assigned" : "draft";
      if (assigneeId && status === "draft") status = "assigned";
      const volCap = numOrNull(body.volumeCapacityM3);
      const wtCap = numOrNull(body.weightCapacityKg);
      const serviceDate = parseServiceDate(body.serviceDate) || todayYmd();

      const inserted = await dbQuery(
        `INSERT INTO dispatch_jobs (
           tenant_id, status, title, notes,
           armada_user_id, armada_username, user_display_name,
           assigned_field_user_id, assigned_at,
           volume_capacity_m3, weight_capacity_kg, service_date
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,
           CASE WHEN $8::uuid IS NULL THEN NULL ELSE now() END,
           COALESCE($9, 12), COALESCE($10, 1500), $11
         )
         RETURNING id`,
        [
          dbTenant.id,
          status,
          title,
          notes,
          armadaUserId,
          armadaUsername,
          userDisplayName,
          assigneeId,
          volCap,
          wtCap,
          serviceDate,
        ],
      );
      const jobId = inserted.rows[0].id;
      await replaceStops(jobId, normalizeStops(body.stops));
      const row = await loadJob(dbTenant.id, jobId);
      const stops = await loadStops(jobId);
      json(res, 201, { job: publicJob(row, stops) });
      return true;
    }

    const assignOrders = /^\/api\/dispatch\/jobs\/([0-9a-f-]{36})\/assign-orders$/i.exec(
      url.pathname,
    );
    if (assignOrders && req.method === "POST") {
      const job = await loadJob(dbTenant.id, assignOrders[1]);
      if (!job) {
        json(res, 404, { error: "Job not found" });
        return true;
      }
      const body = await readJson(req);
      const orderIds = Array.isArray(body.orderIds) ? body.orderIds.map(String) : [];
      if (!orderIds.length) {
        json(res, 400, { error: "orderIds required" });
        return true;
      }
      const existingStops = await loadStops(job.id);
      let sortBase = existingStops.length;
      for (const oid of orderIds.slice(0, 50)) {
        const ord = await dbQuery(
          `SELECT * FROM dispatch_orders
           WHERE id = $1 AND tenant_id = $2 AND status = 'pending'`,
          [oid, dbTenant.id],
        );
        const o = ord.rows[0];
        if (!o) continue;
        const jobDate = formatServiceDate(job.service_date);
        const orderDate = formatServiceDate(o.service_date);
        if (jobDate && orderDate && jobDate !== orderDate) continue;
        const inserted = await dbQuery(
          `INSERT INTO dispatch_stops (
             job_id, sort_order, name, address, lat, lon, notes,
             zone, volume_m3, weight_kg, window_start, window_end, order_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           RETURNING id`,
          [
            job.id,
            sortBase++,
            o.customer_name || o.external_ref || `Stop ${sortBase}`,
            o.address,
            o.lat,
            o.lon,
            o.notes,
            o.zone,
            o.volume_m3,
            o.weight_kg,
            o.window_start,
            o.window_end,
            o.id,
          ],
        );
        await dbQuery(
          `UPDATE dispatch_orders
           SET status = 'assigned', job_id = $1, stop_id = $2, updated_at = now()
           WHERE id = $3`,
          [job.id, inserted.rows[0].id, o.id],
        );
      }
      if (job.status === "draft" && job.assigned_field_user_id) {
        await dbQuery(
          `UPDATE dispatch_jobs SET status = 'assigned', assigned_at = COALESCE(assigned_at, now()), updated_at = now()
           WHERE id = $1`,
          [job.id],
        );
      } else {
        await dbQuery(`UPDATE dispatch_jobs SET updated_at = now() WHERE id = $1`, [job.id]);
      }
      const row = await loadJob(dbTenant.id, job.id);
      json(res, 200, { job: publicJob(row, await loadStops(job.id)) });
      return true;
    }

    const optimizeStops = /^\/api\/dispatch\/jobs\/([0-9a-f-]{36})\/optimize-stops$/i.exec(
      url.pathname,
    );
    if (optimizeStops && req.method === "POST") {
      const job = await loadJob(dbTenant.id, optimizeStops[1]);
      if (!job) {
        json(res, 404, { error: "Job not found" });
        return true;
      }
      const stops = await loadStops(job.id);
      const withCoords = stops.filter(
        (s) => s.lat != null && s.lon != null && Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon)),
      );
      if (withCoords.length < 2) {
        json(res, 400, { error: "Need at least 2 stops with coordinates to optimize" });
        return true;
      }
      const points = withCoords.map((s) => ({ lat: Number(s.lat), lon: Number(s.lon) }));
      const { order } = optimizeOpenTour(points);
      for (let i = 0; i < order.length; i++) {
        const stop = withCoords[order[i]];
        await dbQuery(`UPDATE dispatch_stops SET sort_order = $1 WHERE id = $2`, [i, stop.id]);
      }
      // Keep stops without coords at the end
      let tail = order.length;
      for (const s of stops) {
        if (withCoords.some((c) => c.id === s.id)) continue;
        await dbQuery(`UPDATE dispatch_stops SET sort_order = $1 WHERE id = $2`, [tail++, s.id]);
      }
      await dbQuery(`UPDATE dispatch_jobs SET updated_at = now() WHERE id = $1`, [job.id]);
      const row = await loadJob(dbTenant.id, job.id);
      json(res, 200, {
        job: publicJob(row, await loadStops(job.id)),
        engine: "haversine",
      });
      return true;
    }

    const one = /^\/api\/dispatch\/jobs\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (one && req.method === "GET") {
      const row = await loadJob(dbTenant.id, one[1]);
      if (!row) {
        json(res, 404, { error: "Job not found" });
        return true;
      }
      json(res, 200, { job: publicJob(row, await loadStops(row.id)) });
      return true;
    }

    if (one && req.method === "PATCH") {
      const existing = await loadJob(dbTenant.id, one[1]);
      if (!existing) {
        json(res, 404, { error: "Job not found" });
        return true;
      }
      const body = await readJson(req);
      const sets = [];
      const params = [];

      if ("title" in body) {
        const title = String(body.title || "").trim().slice(0, 200);
        if (!title) {
          json(res, 400, { error: "title cannot be empty" });
          return true;
        }
        params.push(title);
        sets.push(`title = $${params.length}`);
      }
      if ("notes" in body) {
        params.push(String(body.notes || "").trim().slice(0, 4000) || null);
        sets.push(`notes = $${params.length}`);
      }
      if ("armadaUserId" in body) {
        const n = body.armadaUserId;
        params.push(
          n == null || n === ""
            ? null
            : Number.isInteger(Number(n)) && Number(n) > 0
              ? Number(n)
              : null,
        );
        sets.push(`armada_user_id = $${params.length}`);
      }
      if ("armadaUsername" in body) {
        params.push(String(body.armadaUsername || "").trim().slice(0, 120) || null);
        sets.push(`armada_username = $${params.length}`);
      }
      if ("userDisplayName" in body) {
        params.push(String(body.userDisplayName || "").trim().slice(0, 200) || null);
        sets.push(`user_display_name = $${params.length}`);
      }
      if ("assignedFieldUserId" in body) {
        let assigneeId = body.assignedFieldUserId || null;
        if (assigneeId) {
          const ok = await dbQuery(
            `SELECT id FROM field_users WHERE id = $1 AND tenant_id = $2 AND enabled = true`,
            [assigneeId, dbTenant.id],
          );
          if (!ok.rows[0]) {
            json(res, 400, { error: "assignedFieldUserId not found" });
            return true;
          }
        }
        params.push(assigneeId);
        sets.push(`assigned_field_user_id = $${params.length}`);
        if (assigneeId) {
          sets.push(`assigned_at = COALESCE(assigned_at, now())`);
          if (!("status" in body) && existing.status === "draft") {
            sets.push(`status = 'assigned'`);
          }
        } else {
          sets.push(`assigned_at = NULL`);
        }
      }
      if ("status" in body) {
        const status = String(body.status || "").toLowerCase();
        if (!STATUSES.includes(status)) {
          json(res, 400, { error: "Invalid status" });
          return true;
        }
        params.push(status);
        sets.push(`status = $${params.length}`);
        if (status === "en_route") sets.push(`started_at = COALESCE(started_at, now())`);
        if (status === "arrived") sets.push(`arrived_at = COALESCE(arrived_at, now())`);
        if (status === "done" || status === "cancelled") {
          sets.push(`completed_at = COALESCE(completed_at, now())`);
        }
      }
      if ("fieldNote" in body) {
        params.push(String(body.fieldNote || "").trim().slice(0, 2000) || null);
        sets.push(`field_note = $${params.length}`);
      }
      if ("volumeCapacityM3" in body) {
        params.push(numOrNull(body.volumeCapacityM3) ?? 12);
        sets.push(`volume_capacity_m3 = $${params.length}`);
      }
      if ("weightCapacityKg" in body) {
        params.push(numOrNull(body.weightCapacityKg) ?? 1500);
        sets.push(`weight_capacity_kg = $${params.length}`);
      }
      if ("serviceDate" in body) {
        const sd = parseServiceDate(body.serviceDate);
        if (!sd) {
          json(res, 400, { error: "Invalid serviceDate (use YYYY-MM-DD)" });
          return true;
        }
        params.push(sd);
        sets.push(`service_date = $${params.length}`);
      }
      if ("stops" in body) {
        await replaceStops(existing.id, normalizeStops(body.stops));
      }

      if (sets.length) {
        sets.push(`updated_at = now()`);
        params.push(existing.id, dbTenant.id);
        await dbQuery(
          `UPDATE dispatch_jobs SET ${sets.join(", ")}
           WHERE id = $${params.length - 1} AND tenant_id = $${params.length}`,
          params,
        );
      }

      const row = await loadJob(dbTenant.id, existing.id);
      json(res, 200, { job: publicJob(row, await loadStops(row.id)) });
      return true;
    }

    const stopPatch = /^\/api\/dispatch\/jobs\/([0-9a-f-]{36})\/stops\/([0-9a-f-]{36})$/i.exec(
      url.pathname,
    );
    if (stopPatch && req.method === "PATCH") {
      const job = await loadJob(dbTenant.id, stopPatch[1]);
      if (!job) {
        json(res, 404, { error: "Job not found" });
        return true;
      }
      const body = await readJson(req);
      const status = String(body.status || "").toLowerCase();
      if (!STOP_STATUSES.includes(status)) {
        json(res, 400, { error: "Invalid stop status" });
        return true;
      }
      const updated = await dbQuery(
        `UPDATE dispatch_stops s
         SET status = $1,
             arrived_at = CASE WHEN $1 = 'arrived' THEN COALESCE(arrived_at, now()) ELSE arrived_at END,
             completed_at = CASE WHEN $1 IN ('done','skipped') THEN COALESCE(completed_at, now()) ELSE completed_at END
         FROM dispatch_jobs j
         WHERE s.id = $2 AND s.job_id = j.id AND j.id = $3 AND j.tenant_id = $4
         RETURNING s.*`,
        [status, stopPatch[2], stopPatch[1], dbTenant.id],
      );
      if (!updated.rows[0]) {
        json(res, 404, { error: "Stop not found" });
        return true;
      }
      json(res, 200, {
        stop: publicStop(updated.rows[0]),
        job: publicJob(await loadJob(dbTenant.id, job.id), await loadStops(job.id)),
      });
      return true;
    }

    json(res, 404, { error: "Not found" });
    return true;
  } catch (err) {
    const status = err?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[dispatch]", message);
    json(res, status >= 400 && status < 600 ? status : 500, { error: message });
    return true;
  }
}
