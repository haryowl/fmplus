/**
 * Phase F+ — Dispatch desk (jobs, orders, capacity, POD photos).
 * GET/POST /api/dispatch/jobs
 * GET/PATCH /api/dispatch/jobs/:id
 * POST /api/dispatch/jobs/:id/assign-orders
 * POST /api/dispatch/jobs/:id/optimize-stops
 * POST /api/dispatch/jobs/:id/stops/:stopId/return
 * GET/POST /api/dispatch/orders
 * PATCH/DELETE /api/dispatch/orders/:id
 * GET /api/dispatch/stops/:stopId/photos
 * GET /api/dispatch/photos/:id
 * GET /api/dispatch/field-users
 * GET/PUT /api/dispatch/vehicle-capacities
 * PUT /api/dispatch/vehicle-capacities/:armadaUserId
 * GET/PUT /api/dispatch/depot
 * GET/POST /api/dispatch/depots · PATCH/DELETE /api/dispatch/depots/:id
 * POST /api/dispatch/plan-day — CVRP auto-plan (fleet + depot / multi-depot modes)
 */
import crypto from "node:crypto";
import { databaseUrlConfigured, dbQuery } from "./db.mjs";
import { mergeEntitlements, moduleEnabled } from "./entitlements.mjs";
import { resolveDbTenant } from "./maintenance-api.mjs";
import {
  assignVehiclesToDepots,
  partitionOrdersByNearestDepot,
  planCvrp,
} from "./cvrp-plan.mjs";
import { optimizeOpenTour } from "./route-optimize.mjs";
import { buildRouteForPoints } from "./route-plan-api.mjs";
import { getDistanceMatrix } from "./routing-matrix.mjs";
import { parseRoutingOptions } from "./routing-options.mjs";
import { normalizePlateParity } from "./ganjil-genap.mjs";
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

function publicDepot(row) {
  return {
    id: row.id,
    name: row.name || "Depot",
    lat: Number(row.lat),
    lon: Number(row.lon),
    isDefault: Boolean(row.is_default),
    updatedAt: row.updated_at || null,
  };
}

async function syncTenantDefaultDepot(tenantId, lat, lon) {
  await dbQuery(
    `UPDATE tenants SET dispatch_depot_lat = $1, dispatch_depot_lon = $2, updated_at = now()
     WHERE id = $3`,
    [lat, lon, tenantId],
  );
}

async function clearOtherDefaultDepots(tenantId, keepId) {
  await dbQuery(
    `UPDATE dispatch_depots SET is_default = false, updated_at = now()
     WHERE tenant_id = $1 AND id <> $2 AND is_default = true`,
    [tenantId, keepId],
  );
}

async function ensureDefaultDepotFromLegacy(tenantId) {
  const existing = await dbQuery(
    `SELECT id FROM dispatch_depots WHERE tenant_id = $1 LIMIT 1`,
    [tenantId],
  );
  if (existing.rows.length) return;
  const legacy = await dbQuery(
    `SELECT dispatch_depot_lat, dispatch_depot_lon FROM tenants WHERE id = $1`,
    [tenantId],
  );
  const r = legacy.rows[0] || {};
  const lat = r.dispatch_depot_lat == null ? null : Number(r.dispatch_depot_lat);
  const lon = r.dispatch_depot_lon == null ? null : Number(r.dispatch_depot_lon);
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
  await dbQuery(
    `INSERT INTO dispatch_depots (tenant_id, name, lat, lon, is_default)
     VALUES ($1, 'Default', $2, $3, true)`,
    [tenantId, lat, lon],
  );
}

async function listDepotsForTenant(tenantId) {
  await ensureDefaultDepotFromLegacy(tenantId);
  const rows = await dbQuery(
    `SELECT id, name, lat, lon, is_default, updated_at
     FROM dispatch_depots
     WHERE tenant_id = $1
     ORDER BY is_default DESC, name ASC, created_at ASC
     LIMIT 50`,
    [tenantId],
  );
  return rows.rows.map(publicDepot);
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

/** Reorder stop sort_order using road/haversine matrix; optional depot as fixed start. */
async function reorderJobStopsRoad(jobId, depot = null, routing = null) {
  const stops = await loadStops(jobId);
  const withCoords = stops.filter(
    (s) =>
      s.lat != null &&
      s.lon != null &&
      Number.isFinite(Number(s.lat)) &&
      Number.isFinite(Number(s.lon)),
  );
  if (withCoords.length === 0) return null;

  const useDepot =
    depot && Number.isFinite(Number(depot.lat)) && Number.isFinite(Number(depot.lon));

  if (!useDepot && withCoords.length < 2) return null;

  const customerPoints = withCoords.map((s) => ({
    lat: Number(s.lat),
    lon: Number(s.lon),
  }));
  const points = useDepot
    ? [{ lat: Number(depot.lat), lon: Number(depot.lon) }, ...customerPoints]
    : customerPoints;
  const matrix = await getDistanceMatrix(points, routing);
  const { order } = optimizeOpenTour(points, matrix.matrixKm);

  const customerOrder = useDepot
    ? order.filter((i) => i !== 0).map((i) => i - 1)
    : order;

  for (let i = 0; i < customerOrder.length; i++) {
    const stop = withCoords[customerOrder[i]];
    if (!stop) continue;
    await dbQuery(`UPDATE dispatch_stops SET sort_order = $1 WHERE id = $2`, [i, stop.id]);
  }
  let tail = customerOrder.length;
  for (const s of stops) {
    if (withCoords.some((c) => c.id === s.id)) continue;
    await dbQuery(`UPDATE dispatch_stops SET sort_order = $1 WHERE id = $2`, [tail++, s.id]);
  }
  return matrix;
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

/** Unlink order from its job stop (removes the stop). */
async function detachOrderFromJob(order) {
  if (!order) return;
  const stopId = order.stop_id || null;
  await dbQuery(
    `UPDATE dispatch_orders
     SET stop_id = NULL, job_id = NULL, updated_at = now()
     WHERE id = $1`,
    [order.id],
  );
  if (stopId) {
    await dbQuery(`DELETE FROM dispatch_stops WHERE id = $1`, [stopId]);
  }
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

    // —— Vehicle capacity presets (keyed by Armada user id) ——
    if (url.pathname === "/api/dispatch/vehicle-capacities" && req.method === "GET") {
      const rows = await dbQuery(
        `SELECT armada_user_id, volume_capacity_m3, weight_capacity_kg, label, depot_id, plate_parity, updated_at
         FROM vehicle_capacities
         WHERE tenant_id = $1
         ORDER BY armada_user_id ASC
         LIMIT 500`,
        [dbTenant.id],
      );
      json(res, 200, {
        capacities: rows.rows.map((r) => ({
          armadaUserId: Number(r.armada_user_id),
          volumeCapacityM3: Number(r.volume_capacity_m3) || 12,
          weightCapacityKg: Number(r.weight_capacity_kg) || 1500,
          label: r.label || "",
          depotId: r.depot_id || null,
          plateParity: normalizePlateParity(r.plate_parity || "unknown"),
          updatedAt: r.updated_at,
        })),
      });
      return true;
    }

    const vehicleCapOne = /^\/api\/dispatch\/vehicle-capacities\/(\d+)$/i.exec(url.pathname);
    if (vehicleCapOne && req.method === "PUT") {
      const armadaUserId = Number(vehicleCapOne[1]);
      if (!Number.isInteger(armadaUserId) || armadaUserId <= 0) {
        json(res, 400, { error: "Invalid armada user id" });
        return true;
      }
      const body = await readJson(req);
      const vol = numOrNull(body.volumeCapacityM3);
      const wt = numOrNull(body.weightCapacityKg);
      if (vol == null || vol <= 0 || wt == null || wt <= 0) {
        json(res, 400, { error: "volumeCapacityM3 and weightCapacityKg must be > 0" });
        return true;
      }
      const label = String(body.label || "").trim().slice(0, 200) || null;
      const hasDepotField = Object.prototype.hasOwnProperty.call(body, "depotId");
      let depotId = null;
      if (hasDepotField) {
        if (body.depotId != null && body.depotId !== "") {
          const did = String(body.depotId);
          const ok = await dbQuery(
            `SELECT id FROM dispatch_depots WHERE id = $1 AND tenant_id = $2`,
            [did, dbTenant.id],
          );
          if (!ok.rows.length) {
            json(res, 400, { error: "Unknown depotId" });
            return true;
          }
          depotId = ok.rows[0].id;
        }
      }
      const hasPlateField = Object.prototype.hasOwnProperty.call(body, "plateParity");
      const plateParity = hasPlateField
        ? normalizePlateParity(body.plateParity)
        : null;
      const upserted = await dbQuery(
        `INSERT INTO vehicle_capacities (
           tenant_id, armada_user_id, volume_capacity_m3, weight_capacity_kg, label, depot_id, plate_parity, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (tenant_id, armada_user_id) DO UPDATE SET
           volume_capacity_m3 = EXCLUDED.volume_capacity_m3,
           weight_capacity_kg = EXCLUDED.weight_capacity_kg,
           label = COALESCE(EXCLUDED.label, vehicle_capacities.label),
           depot_id = CASE WHEN $8 THEN EXCLUDED.depot_id ELSE vehicle_capacities.depot_id END,
           plate_parity = CASE WHEN $9 THEN EXCLUDED.plate_parity ELSE vehicle_capacities.plate_parity END,
           updated_at = now()
         RETURNING armada_user_id, volume_capacity_m3, weight_capacity_kg, label, depot_id, plate_parity, updated_at`,
        [
          dbTenant.id,
          armadaUserId,
          vol,
          wt,
          label,
          depotId,
          plateParity === "unknown" ? null : plateParity,
          hasDepotField,
          hasPlateField,
        ],
      );
      const r = upserted.rows[0];
      json(res, 200, {
        capacity: {
          armadaUserId: Number(r.armada_user_id),
          volumeCapacityM3: Number(r.volume_capacity_m3) || 12,
          weightCapacityKg: Number(r.weight_capacity_kg) || 1500,
          label: r.label || "",
          depotId: r.depot_id || null,
          plateParity: normalizePlateParity(r.plate_parity || "unknown"),
          updatedAt: r.updated_at,
        },
      });
      return true;
    }

    // —— Tenant depot (CVRP default / single) ——
    if (url.pathname === "/api/dispatch/depot" && req.method === "GET") {
      const depots = await listDepotsForTenant(dbTenant.id);
      const def = depots.find((d) => d.isDefault) || depots[0] || null;
      if (def) {
        json(res, 200, { depot: { lat: def.lat, lon: def.lon, id: def.id, name: def.name } });
        return true;
      }
      const row = await dbQuery(
        `SELECT dispatch_depot_lat, dispatch_depot_lon FROM tenants WHERE id = $1`,
        [dbTenant.id],
      );
      const r = row.rows[0] || {};
      const lat = r.dispatch_depot_lat == null ? null : Number(r.dispatch_depot_lat);
      const lon = r.dispatch_depot_lon == null ? null : Number(r.dispatch_depot_lon);
      json(res, 200, {
        depot:
          lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)
            ? { lat, lon }
            : null,
      });
      return true;
    }

    if (url.pathname === "/api/dispatch/depot" && req.method === "PUT") {
      const body = await readJson(req);
      const clear = body.depot === null || body.clear === true;
      if (clear) {
        await dbQuery(
          `UPDATE tenants SET dispatch_depot_lat = NULL, dispatch_depot_lon = NULL, updated_at = now()
           WHERE id = $1`,
          [dbTenant.id],
        );
        await dbQuery(
          `UPDATE dispatch_depots SET is_default = false, updated_at = now()
           WHERE tenant_id = $1 AND is_default = true`,
          [dbTenant.id],
        );
        json(res, 200, { depot: null });
        return true;
      }
      const lat = numOrNull(body.lat ?? body.depot?.lat);
      const lon = numOrNull(body.lon ?? body.depot?.lon);
      if (
        lat == null ||
        lon == null ||
        Math.abs(lat) > 90 ||
        Math.abs(lon) > 180
      ) {
        json(res, 400, { error: "Valid lat and lon required (or depot: null to clear)" });
        return true;
      }
      await syncTenantDefaultDepot(dbTenant.id, lat, lon);
      const existing = await dbQuery(
        `SELECT id FROM dispatch_depots WHERE tenant_id = $1 AND is_default = true LIMIT 1`,
        [dbTenant.id],
      );
      let depotRow;
      if (existing.rows[0]) {
        const upd = await dbQuery(
          `UPDATE dispatch_depots SET lat = $1, lon = $2, updated_at = now()
           WHERE id = $3
           RETURNING id, name, lat, lon, is_default, updated_at`,
          [lat, lon, existing.rows[0].id],
        );
        depotRow = upd.rows[0];
      } else {
        const ins = await dbQuery(
          `INSERT INTO dispatch_depots (tenant_id, name, lat, lon, is_default)
           VALUES ($1, 'Default', $2, $3, true)
           RETURNING id, name, lat, lon, is_default, updated_at`,
          [dbTenant.id, lat, lon],
        );
        depotRow = ins.rows[0];
      }
      json(res, 200, {
        depot: { lat, lon, id: depotRow.id, name: depotRow.name || "Default" },
      });
      return true;
    }

    // —— Named depots (multi-depot) ——
    if (url.pathname === "/api/dispatch/depots" && req.method === "GET") {
      const depots = await listDepotsForTenant(dbTenant.id);
      json(res, 200, { depots });
      return true;
    }

    if (url.pathname === "/api/dispatch/depots" && req.method === "POST") {
      const body = await readJson(req);
      const lat = numOrNull(body.lat);
      const lon = numOrNull(body.lon);
      if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        json(res, 400, { error: "Valid lat and lon required" });
        return true;
      }
      const name = String(body.name || "Depot").trim().slice(0, 80) || "Depot";
      const current = await listDepotsForTenant(dbTenant.id);
      if (current.length >= 20) {
        json(res, 400, { error: "Maximum 20 depots per tenant" });
        return true;
      }
      const makeDefault = body.isDefault === true || current.length === 0;
      if (makeDefault) {
        await dbQuery(
          `UPDATE dispatch_depots SET is_default = false, updated_at = now()
           WHERE tenant_id = $1 AND is_default = true`,
          [dbTenant.id],
        );
      }
      const ins = await dbQuery(
        `INSERT INTO dispatch_depots (tenant_id, name, lat, lon, is_default)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, lat, lon, is_default, updated_at`,
        [dbTenant.id, name, lat, lon, makeDefault],
      );
      if (makeDefault) {
        await syncTenantDefaultDepot(dbTenant.id, lat, lon);
      }
      json(res, 201, { depot: publicDepot(ins.rows[0]) });
      return true;
    }

    const depotOne = /^\/api\/dispatch\/depots\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (depotOne && req.method === "PATCH") {
      const depotId = depotOne[1];
      const body = await readJson(req);
      const existing = await dbQuery(
        `SELECT * FROM dispatch_depots WHERE id = $1 AND tenant_id = $2`,
        [depotId, dbTenant.id],
      );
      if (!existing.rows[0]) {
        json(res, 404, { error: "Depot not found" });
        return true;
      }
      const cur = existing.rows[0];
      const lat = body.lat != null ? numOrNull(body.lat) : Number(cur.lat);
      const lon = body.lon != null ? numOrNull(body.lon) : Number(cur.lon);
      if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        json(res, 400, { error: "Valid lat and lon required" });
        return true;
      }
      const name =
        body.name != null
          ? String(body.name).trim().slice(0, 80) || cur.name
          : cur.name;
      if (body.isDefault === true) {
        await clearOtherDefaultDepots(dbTenant.id, depotId);
        isDefault = true;
      }
      if (body.isDefault === false && isDefault) {
        // keep at least one default if this is the only depot
        const count = await dbQuery(
          `SELECT COUNT(*)::int AS n FROM dispatch_depots WHERE tenant_id = $1`,
          [dbTenant.id],
        );
        if ((count.rows[0]?.n || 0) > 1) isDefault = false;
      }
      const upd = await dbQuery(
        `UPDATE dispatch_depots
         SET name = $1, lat = $2, lon = $3, is_default = $4, updated_at = now()
         WHERE id = $5
         RETURNING id, name, lat, lon, is_default, updated_at`,
        [name, lat, lon, isDefault, depotId],
      );
      if (isDefault) {
        await syncTenantDefaultDepot(dbTenant.id, lat, lon);
      }
      json(res, 200, { depot: publicDepot(upd.rows[0]) });
      return true;
    }

    if (depotOne && req.method === "DELETE") {
      const depotId = depotOne[1];
      const existing = await dbQuery(
        `SELECT * FROM dispatch_depots WHERE id = $1 AND tenant_id = $2`,
        [depotId, dbTenant.id],
      );
      if (!existing.rows[0]) {
        json(res, 404, { error: "Depot not found" });
        return true;
      }
      const wasDefault = Boolean(existing.rows[0].is_default);
      await dbQuery(`DELETE FROM dispatch_depots WHERE id = $1`, [depotId]);
      if (wasDefault) {
        const next = await dbQuery(
          `SELECT id, lat, lon FROM dispatch_depots
           WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1`,
          [dbTenant.id],
        );
        if (next.rows[0]) {
          await dbQuery(
            `UPDATE dispatch_depots SET is_default = true, updated_at = now() WHERE id = $1`,
            [next.rows[0].id],
          );
          await syncTenantDefaultDepot(dbTenant.id, Number(next.rows[0].lat), Number(next.rows[0].lon));
        } else {
          await dbQuery(
            `UPDATE tenants SET dispatch_depot_lat = NULL, dispatch_depot_lon = NULL, updated_at = now()
             WHERE id = $1`,
            [dbTenant.id],
          );
        }
      }
      json(res, 200, { ok: true });
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
        if (st === "cancelled" || st === "pending") {
          if (existing.rows[0].stop_id || existing.rows[0].job_id) {
            await detachOrderFromJob(existing.rows[0]);
          }
          sets.push(`job_id = NULL`);
          sets.push(`stop_id = NULL`);
        }
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
      const row = updated.rows[0];
      // Keep linked stop in sync when dispatcher edits an assigned order
      if (row.stop_id && row.status === "assigned") {
        await dbQuery(
          `UPDATE dispatch_stops SET
             name = COALESCE($1, name),
             address = $2,
             lat = $3,
             lon = $4,
             zone = $5,
             volume_m3 = $6,
             weight_kg = $7,
             window_start = $8,
             window_end = $9,
             notes = $10
           WHERE id = $11`,
          [
            row.customer_name || row.external_ref || null,
            row.address,
            row.lat,
            row.lon,
            row.zone,
            row.volume_m3,
            row.weight_kg,
            row.window_start,
            row.window_end,
            row.notes,
            row.stop_id,
          ],
        );
      }
      json(res, 200, { order: publicOrder(row) });
      return true;
    }

    if (orderOne && req.method === "DELETE") {
      const existing = await dbQuery(
        `SELECT * FROM dispatch_orders WHERE id = $1 AND tenant_id = $2`,
        [orderOne[1], dbTenant.id],
      );
      if (!existing.rows[0]) {
        json(res, 404, { error: "Order not found" });
        return true;
      }
      await detachOrderFromJob(existing.rows[0]);
      await dbQuery(`DELETE FROM dispatch_orders WHERE id = $1 AND tenant_id = $2`, [
        orderOne[1],
        dbTenant.id,
      ]);
      json(res, 200, { ok: true, id: orderOne[1] });
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
      let volCap = numOrNull(body.volumeCapacityM3);
      let wtCap = numOrNull(body.weightCapacityKg);
      if ((volCap == null || wtCap == null) && armadaUserId != null) {
        const preset = await dbQuery(
          `SELECT volume_capacity_m3, weight_capacity_kg
           FROM vehicle_capacities
           WHERE tenant_id = $1 AND armada_user_id = $2`,
          [dbTenant.id, armadaUserId],
        );
        const p = preset.rows[0];
        if (p) {
          if (volCap == null) volCap = Number(p.volume_capacity_m3);
          if (wtCap == null) wtCap = Number(p.weight_capacity_kg);
        }
      }
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
      const rejectOverCapacity = body.rejectOverCapacity === true;
      const existingStops = await loadStops(job.id);
      const cap = capacityFrom(job, existingStops);
      let pendingVol = 0;
      let pendingWt = 0;
      if (rejectOverCapacity) {
        for (const oid of orderIds.slice(0, 50)) {
          const ord = await dbQuery(
            `SELECT volume_m3, weight_kg FROM dispatch_orders
             WHERE id = $1 AND tenant_id = $2 AND status = 'pending'`,
            [oid, dbTenant.id],
          );
          const o = ord.rows[0];
          if (!o) continue;
          pendingVol += Number(o.volume_m3) || 0;
          pendingWt += Number(o.weight_kg) || 0;
        }
        if (
          cap.volumeUsed + pendingVol > cap.volumeCapacityM3 + 1e-9 ||
          cap.weightUsed + pendingWt > cap.weightCapacityKg + 1e-9
        ) {
          json(res, 409, {
            error: "Assign would exceed vehicle capacity (volume or weight)",
            capacity: {
              ...cap,
              pendingVolumeM3: Math.round(pendingVol * 1000) / 1000,
              pendingWeightKg: Math.round(pendingWt * 10) / 10,
            },
          });
          return true;
        }
      }
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
      const body = await readJson(req);
      let routing = parseRoutingOptions({
        ...body,
        routing: {
          ...(body.routing && typeof body.routing === "object" ? body.routing : {}),
          ...(body.plateParity != null ? { plateParity: body.plateParity } : {}),
          ...(body.respectGanjilGenap != null
            ? { respectGanjilGenap: body.respectGanjilGenap }
            : {}),
        },
      });
      if (
        (!body.routing?.plateParity && body.plateParity == null) ||
        routing.plateParity === "unknown"
      ) {
        const uid = job.armada_user_id == null ? null : Number(job.armada_user_id);
        if (uid) {
          const cap = await dbQuery(
            `SELECT plate_parity FROM vehicle_capacities
             WHERE tenant_id = $1 AND armada_user_id = $2`,
            [dbTenant.id, uid],
          );
          if (cap.rows[0]?.plate_parity) {
            routing = parseRoutingOptions({
              routing: {
                ...routing,
                plateParity: cap.rows[0].plate_parity,
                respectGanjilGenap:
                  routing.respectGanjilGenap ||
                  body.respectGanjilGenap === true ||
                  Boolean(cap.rows[0].plate_parity),
              },
            });
          }
        }
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
      const matrix = await getDistanceMatrix(points, routing);
      const { order } = optimizeOpenTour(points, matrix.matrixKm);
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
      const orderedPoints = order.map((idx) => points[idx]);
      const route = await buildRouteForPoints(orderedPoints, routing);
      const row = await loadJob(dbTenant.id, job.id);
      json(res, 200, {
        job: publicJob(row, await loadStops(job.id)),
        engine: route.engine,
        matrixEngine: matrix.engine,
        routing,
        route,
        warning: matrix.warning || route.warning || null,
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

    const stopReturn =
      /^\/api\/dispatch\/jobs\/([0-9a-f-]{36})\/stops\/([0-9a-f-]{36})\/return$/i.exec(url.pathname);
    if (stopReturn && req.method === "POST") {
      const job = await loadJob(dbTenant.id, stopReturn[1]);
      if (!job) {
        json(res, 404, { error: "Job not found" });
        return true;
      }
      if (job.status === "done" || job.status === "cancelled") {
        json(res, 400, { error: "Cannot change stops on a closed job" });
        return true;
      }
      const stopRow = await dbQuery(
        `SELECT s.* FROM dispatch_stops s
         WHERE s.id = $1 AND s.job_id = $2`,
        [stopReturn[2], job.id],
      );
      const stop = stopRow.rows[0];
      if (!stop) {
        json(res, 404, { error: "Stop not found" });
        return true;
      }
      if (stop.order_id) {
        await dbQuery(
          `UPDATE dispatch_orders
           SET status = 'pending', job_id = NULL, stop_id = NULL, updated_at = now()
           WHERE id = $1 AND tenant_id = $2`,
          [stop.order_id, dbTenant.id],
        );
      }
      await dbQuery(`DELETE FROM dispatch_stops WHERE id = $1 AND job_id = $2`, [stop.id, job.id]);
      await dbQuery(`UPDATE dispatch_jobs SET updated_at = now() WHERE id = $1`, [job.id]);
      const row = await loadJob(dbTenant.id, job.id);
      json(res, 200, {
        job: publicJob(row, await loadStops(job.id)),
        returnedOrderId: stop.order_id || null,
      });
      return true;
    }

    if (url.pathname === "/api/dispatch/plan-day" && req.method === "POST") {
      const body = await readJson(req);
      const serviceDate = parseServiceDate(body.serviceDate) || todayYmd();
      const fleetMode = String(body.fleetMode || "both").toLowerCase();
      if (!["jobs", "presets", "both"].includes(fleetMode)) {
        json(res, 400, { error: "fleetMode must be jobs | presets | both" });
        return true;
      }
      const depotMode = String(body.depotMode || "open").toLowerCase();
      if (!["open", "depot", "multi"].includes(depotMode)) {
        json(res, 400, { error: "depotMode must be open | depot | multi" });
        return true;
      }
      const apply = body.apply === true;
      const roundtrip = body.roundtrip === true;
      const onlyEmptyJobs = body.onlyEmptyJobs === true;
      let routing = parseRoutingOptions({
        routing: {
          ...(body.routing && typeof body.routing === "object" ? body.routing : {}),
          serviceDate,
          dayStart: body.dayStart || null,
          ...(body.plateParity != null ? { plateParity: body.plateParity } : {}),
          ...(body.respectGanjilGenap != null
            ? { respectGanjilGenap: body.respectGanjilGenap }
            : {}),
        },
      });
      const twMode = String(body.twMode || "soft").toLowerCase();
      if (!["off", "soft", "hard"].includes(twMode)) {
        json(res, 400, { error: "twMode must be off | soft | hard" });
        return true;
      }
      const serviceMinutes = Math.max(
        0,
        Math.min(120, Number(body.serviceMinutes) || 8),
      );
      const maxStopsPerVehicle = Math.max(0, Math.floor(Number(body.maxStopsPerVehicle) || 0));
      let dayStartMin = 8 * 60;
      if (body.dayStart) {
        const parsed = String(body.dayStart).trim();
        const m = /^(\d{1,2}):(\d{2})$/.exec(parsed);
        if (m) dayStartMin = Number(m[1]) * 60 + Number(m[2]);
      } else if (body.dayStartMin != null && Number.isFinite(Number(body.dayStartMin))) {
        dayStartMin = Number(body.dayStartMin);
      }
      let depotLat = numOrNull(body.depotLat ?? body.depot?.lat);
      let depotLon = numOrNull(body.depotLon ?? body.depot?.lon);
      if (depotMode === "depot" && (depotLat == null || depotLon == null)) {
        const saved = await dbQuery(
          `SELECT dispatch_depot_lat, dispatch_depot_lon FROM tenants WHERE id = $1`,
          [dbTenant.id],
        );
        const s = saved.rows[0] || {};
        if (depotLat == null && s.dispatch_depot_lat != null) depotLat = Number(s.dispatch_depot_lat);
        if (depotLon == null && s.dispatch_depot_lon != null) depotLon = Number(s.dispatch_depot_lon);
      }
      if (depotMode === "depot") {
        if (
          depotLat == null ||
          depotLon == null ||
          Math.abs(depotLat) > 90 ||
          Math.abs(depotLon) > 180
        ) {
          json(res, 400, {
            error: "depotMode=depot requires depot lat/lon (body or saved tenant depot)",
          });
          return true;
        }
      }

      /** @type {{ id: string, name: string, lat: number, lon: number, isDefault?: boolean }[]} */
      let multiDepots = [];
      if (depotMode === "multi") {
        const all = await listDepotsForTenant(dbTenant.id);
        const filterIds = Array.isArray(body.depotIds)
          ? new Set(body.depotIds.map((x) => String(x)))
          : null;
        multiDepots = filterIds
          ? all.filter((d) => filterIds.has(String(d.id)))
          : all;
        if (!multiDepots.length) {
          json(res, 400, {
            error: "depotMode=multi requires at least one saved depot (add depots first)",
          });
          return true;
        }
      }

      const persistDepot = body.persistDepot === true && depotMode === "depot";
      if (persistDepot && depotLat != null && depotLon != null) {
        await syncTenantDefaultDepot(dbTenant.id, depotLat, depotLon);
        const existing = await dbQuery(
          `SELECT id FROM dispatch_depots WHERE tenant_id = $1 AND is_default = true LIMIT 1`,
          [dbTenant.id],
        );
        if (existing.rows[0]) {
          await dbQuery(
            `UPDATE dispatch_depots SET lat = $1, lon = $2, updated_at = now() WHERE id = $3`,
            [depotLat, depotLon, existing.rows[0].id],
          );
        } else {
          await dbQuery(
            `INSERT INTO dispatch_depots (tenant_id, name, lat, lon, is_default)
             VALUES ($1, 'Default', $2, $3, true)`,
            [dbTenant.id, depotLat, depotLon],
          );
        }
      }

      const orderRows = await dbQuery(
        `SELECT * FROM dispatch_orders
         WHERE tenant_id = $1 AND status = 'pending' AND service_date = $2
         ORDER BY created_at ASC
         LIMIT 200`,
        [dbTenant.id, serviceDate],
      );
      const orders = [];
      const skipped = [];
      for (const o of orderRows.rows) {
        const lat = o.lat == null ? null : Number(o.lat);
        const lon = o.lon == null ? null : Number(o.lon);
        if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
          skipped.push({ orderId: o.id, reason: "no_coords" });
          continue;
        }
        orders.push({
          id: o.id,
          lat,
          lon,
          volumeM3: o.volume_m3 == null ? 0 : Number(o.volume_m3) || 0,
          weightKg: o.weight_kg == null ? 0 : Number(o.weight_kg) || 0,
          label: o.customer_name || o.external_ref || o.id,
          windowStart: o.window_start || "",
          windowEnd: o.window_end || "",
        });
      }
      if (!orders.length) {
        json(res, 400, {
          error: "No pending orders with coordinates for this date",
          skipped,
        });
        return true;
      }

      /** @type {{ key: string, label: string, volumeCapacityM3: number, weightCapacityKg: number, meta: object }[]} */
      const vehicles = [];
      const usedArmada = new Set();

      if (fleetMode === "jobs" || fleetMode === "both") {
        const jobs = await dbQuery(
          `SELECT * FROM dispatch_jobs
           WHERE tenant_id = $1 AND service_date = $2
             AND status NOT IN ('done', 'cancelled')
           ORDER BY created_at ASC
           LIMIT 50`,
          [dbTenant.id, serviceDate],
        );
        const plateByArmada = new Map();
        {
          const caps = await dbQuery(
            `SELECT armada_user_id, plate_parity FROM vehicle_capacities WHERE tenant_id = $1`,
            [dbTenant.id],
          );
          for (const r of caps.rows) {
            plateByArmada.set(Number(r.armada_user_id), normalizePlateParity(r.plate_parity || "unknown"));
          }
        }
        for (const j of jobs.rows) {
          const stops = await loadStops(j.id);
          // Prefer empty / light jobs for day planning; still allow jobs with stops (residual capacity)
          const cap = capacityFrom(j, stops);
          const residualVol = Math.max(0, cap.volumeCapacityM3 - cap.volumeUsed);
          const residualWt = Math.max(0, cap.weightCapacityKg - cap.weightUsed);
          if (residualVol <= 0 || residualWt <= 0) continue;
          if (onlyEmptyJobs && stops.length > 0) continue;
          if (j.armada_user_id != null) usedArmada.add(Number(j.armada_user_id));
          const uid = j.armada_user_id == null ? null : Number(j.armada_user_id);
          vehicles.push({
            key: `job:${j.id}`,
            label: j.title || j.user_display_name || j.armada_username || j.id,
            volumeCapacityM3: residualVol,
            weightCapacityKg: residualWt,
            meta: {
              kind: "job",
              jobId: j.id,
              armadaUserId: uid,
              armadaUsername: j.armada_username || "",
              userDisplayName: j.user_display_name || "",
              fullVolumeCapacityM3: cap.volumeCapacityM3,
              fullWeightCapacityKg: cap.weightCapacityKg,
              existingStops: stops.length,
              plateParity: uid != null ? plateByArmada.get(uid) || "unknown" : "unknown",
            },
          });
        }
      }

      if (fleetMode === "presets" || fleetMode === "both") {
        const presets = await dbQuery(
          `SELECT armada_user_id, volume_capacity_m3, weight_capacity_kg, label, depot_id, plate_parity
           FROM vehicle_capacities WHERE tenant_id = $1
           ORDER BY armada_user_id ASC LIMIT 100`,
          [dbTenant.id],
        );
        for (const p of presets.rows) {
          const uid = Number(p.armada_user_id);
          if (fleetMode === "both" && usedArmada.has(uid)) continue;
          vehicles.push({
            key: `preset:${uid}`,
            label: p.label || `Vehicle #${uid}`,
            volumeCapacityM3: Number(p.volume_capacity_m3) || 12,
            weightCapacityKg: Number(p.weight_capacity_kg) || 1500,
            meta: {
              kind: "preset",
              armadaUserId: uid,
              armadaUsername: "",
              userDisplayName: p.label || "",
              fullVolumeCapacityM3: Number(p.volume_capacity_m3) || 12,
              fullWeightCapacityKg: Number(p.weight_capacity_kg) || 1500,
              existingStops: 0,
              depotId: p.depot_id || null,
              plateParity: normalizePlateParity(p.plate_parity || "unknown"),
            },
          });
        }
      }

      // Prefer empty / lighter jobs before fuller ones and larger residual capacity
      vehicles.sort(
        (a, b) =>
          (Number(a.meta?.existingStops) || 0) - (Number(b.meta?.existingStops) || 0) ||
          b.volumeCapacityM3 * b.weightCapacityKg - a.volumeCapacityM3 * a.weightCapacityKg,
      );

      // Attach depot from capacity preset when planning from existing jobs
      if (depotMode === "multi") {
        const capRows = await dbQuery(
          `SELECT armada_user_id, depot_id FROM vehicle_capacities WHERE tenant_id = $1`,
          [dbTenant.id],
        );
        const depotByArmada = new Map(
          capRows.rows.map((r) => [Number(r.armada_user_id), r.depot_id || null]),
        );
        for (const v of vehicles) {
          if (v.meta?.depotId) continue;
          const uid = v.meta?.armadaUserId;
          if (uid != null && depotByArmada.has(Number(uid))) {
            v.meta.depotId = depotByArmada.get(Number(uid));
          }
        }
      }

      if (!vehicles.length) {
        json(res, 400, {
          error:
            fleetMode === "jobs"
              ? "No open jobs with residual capacity for this date"
              : "No vehicles available — create open jobs and/or save vehicle capacity presets",
        });
        return true;
      }

      // Fleet plate parity for ganjil–genap (mixed → treat as unknown → avoid when in force)
      {
        const wantRespect =
          routing.respectGanjilGenap ||
          body.respectGanjilGenap === true ||
          vehicles.some((v) => {
            const p = normalizePlateParity(v.meta?.plateParity);
            return p === "odd" || p === "even";
          });
        if (wantRespect) {
          let fleetParity = routing.plateParity;
          if (fleetParity === "unknown") {
            const set = new Set(
              vehicles
                .map((v) => normalizePlateParity(v.meta?.plateParity))
                .filter((p) => p === "odd" || p === "even"),
            );
            if (set.size === 1) fleetParity = [...set][0];
          }
          routing = parseRoutingOptions({
            routing: {
              avoidTolls: routing.avoidTolls,
              avoidMotorways: routing.avoidMotorways,
              avoidFerries: routing.avoidFerries,
              exclude: routing.exclude.filter((c) => c !== "ganjil_genap"),
              plateParity: fleetParity,
              respectGanjilGenap: true,
              serviceDate,
              dayStart: body.dayStart || null,
            },
          });
        }
      }

      const planOpts = {
        twMode,
        serviceMinutes,
        dayStartMin,
        maxStopsPerVehicle,
      };

      /** @type {any[]} */
      let planRoutes = [];
      /** @type {any[]} */
      let planUnassigned = [...skipped];
      let planEngine = "haversine";
      let planWarning = null;
      let planBalanceMoves = 0;
      let planRoundtrip = false;
      /** @type {{ lat: number, lon: number } | null} */
      let previewDepot = null;
      /** @type {any[] | null} */
      let previewDepots = null;

      if (depotMode === "multi") {
        const orderClusters = partitionOrdersByNearestDepot(orders, multiDepots);
        /** @type {Map<string, { vol: number, wt: number, orderCount: number }>} */
        const demandByDepot = new Map();
        for (const d of multiDepots) {
          const idxs = orderClusters.get(String(d.id)) || [];
          let vol = 0;
          let wt = 0;
          for (const i of idxs) {
            vol += Math.max(0, Number(orders[i].volumeM3) || 0);
            wt += Math.max(0, Number(orders[i].weightKg) || 0);
          }
          demandByDepot.set(String(d.id), { vol, wt, orderCount: idxs.length });
        }
        const vehicleClusters = assignVehiclesToDepots(vehicles, multiDepots, demandByDepot);
        const engines = new Set();
        const warnings = [];

        for (const d of multiDepots) {
          const did = String(d.id);
          const orderIdxs = orderClusters.get(did) || [];
          const vehicleIdxs = vehicleClusters.get(did) || [];
          if (!orderIdxs.length) continue;

          const clusterOrders = orderIdxs.map((i) => orders[i]);
          if (!vehicleIdxs.length) {
            for (const o of clusterOrders) {
              planUnassigned.push({
                orderId: o.id,
                label: o.label || o.id,
                reason: "no_vehicle_at_depot",
                depotId: did,
              });
            }
            continue;
          }

          const clusterVehicles = vehicleIdxs.map((i) => vehicles[i]);
          const points = [
            { lat: d.lat, lon: d.lon },
            ...clusterOrders.map((o) => ({ lat: o.lat, lon: o.lon })),
          ];
          if (points.length > 80) {
            json(res, 400, {
              error: `Too many points for depot “${d.name}” (${points.length}). Cap is 80 (depot + orders).`,
            });
            return true;
          }
          const matrix = await getDistanceMatrix(points, routing);
          engines.add(matrix.engine);
          if (matrix.warning) warnings.push(matrix.warning);
          const plan = planCvrp({
            orders: clusterOrders,
            vehicles: clusterVehicles,
            matrixKm: matrix.matrixKm,
            points,
            depotIndex: 0,
            roundtrip,
            ...planOpts,
          });
          planBalanceMoves += plan.balanceMoves || 0;
          planRoundtrip = planRoundtrip || plan.roundtrip;
          for (const route of plan.routes) {
            planRoutes.push({
              ...route,
              meta: {
                ...(route.meta || {}),
                depotId: did,
                depotName: d.name,
                depot: { lat: d.lat, lon: d.lon },
              },
              depotId: did,
              depotName: d.name,
            });
          }
          for (const u of plan.unassigned) {
            planUnassigned.push({ ...u, depotId: did });
          }
        }

        planEngine = engines.has("osrm") ? (engines.size > 1 ? "mixed" : "osrm") : "haversine";
        planWarning = warnings[0] || null;
        previewDepots = multiDepots.map((d) => ({
          id: d.id,
          name: d.name,
          lat: d.lat,
          lon: d.lon,
          orderCount: (orderClusters.get(String(d.id)) || []).length,
          vehicleCount: (vehicleClusters.get(String(d.id)) || []).length,
        }));
      } else {
        const useDepot = depotMode === "depot";
        const depotIndex = useDepot ? 0 : null;
        const points = useDepot
          ? [{ lat: depotLat, lon: depotLon }, ...orders.map((o) => ({ lat: o.lat, lon: o.lon }))]
          : orders.map((o) => ({ lat: o.lat, lon: o.lon }));

        if (points.length > 80) {
          json(res, 400, {
            error: `Too many points for matrix (${points.length}). Cap is 80 (depot + orders).`,
          });
          return true;
        }

        const matrix = await getDistanceMatrix(points, routing);
        const plan = planCvrp({
          orders,
          vehicles,
          matrixKm: matrix.matrixKm,
          points,
          depotIndex,
          roundtrip: useDepot && roundtrip,
          ...planOpts,
        });
        planRoutes = plan.routes;
        planUnassigned = [...plan.unassigned, ...skipped];
        planEngine = matrix.engine;
        planWarning = matrix.warning || null;
        planBalanceMoves = plan.balanceMoves || 0;
        planRoundtrip = plan.roundtrip;
        previewDepot = useDepot ? { lat: depotLat, lon: depotLon } : null;
      }

      const preview = {
        serviceDate,
        fleetMode,
        depotMode,
        apply: false,
        engine: planEngine,
        warning: planWarning,
        depot: previewDepot,
        depots: previewDepots,
        roundtrip: planRoundtrip,
        balanceMoves: planBalanceMoves,
        twMode,
        serviceMinutes,
        dayStartMin,
        maxStopsPerVehicle,
        onlyEmptyJobs,
        routing,
        routes: planRoutes,
        unassigned: planUnassigned,
        vehicleCount: vehicles.length,
        orderCount: orders.length,
      };

      if (!apply) {
        json(res, 200, { plan: preview });
        return true;
      }

      // Apply: create jobs for presets, assign orders in planned order, set sort_order
      const applied = [];
      for (const route of planRoutes) {
        let jobId = route.meta?.jobId || null;
        if (!jobId && route.meta?.kind === "preset") {
          const uid = route.meta.armadaUserId;
          const title = String(route.label || `Auto · #${uid}`).slice(0, 200);
          const inserted = await dbQuery(
            `INSERT INTO dispatch_jobs (
               tenant_id, status, title,
               armada_user_id, armada_username, user_display_name,
               volume_capacity_m3, weight_capacity_kg, service_date
             ) VALUES ($1,'draft',$2,$3,$4,$5,$6,$7,$8)
             RETURNING id`,
            [
              dbTenant.id,
              title,
              uid,
              null,
              route.meta.userDisplayName || title,
              route.meta.fullVolumeCapacityM3 || route.volumeCapacityM3,
              route.meta.fullWeightCapacityKg || route.weightCapacityKg,
              serviceDate,
            ],
          );
          jobId = inserted.rows[0].id;
        }
        if (!jobId) continue;

        // Assign in route order
        let sortBase = (await loadStops(jobId)).length;
        for (const oid of route.orderIds) {
          const ord = await dbQuery(
            `SELECT * FROM dispatch_orders
             WHERE id = $1 AND tenant_id = $2 AND status = 'pending'`,
            [oid, dbTenant.id],
          );
          const o = ord.rows[0];
          if (!o) continue;
          const inserted = await dbQuery(
            `INSERT INTO dispatch_stops (
               job_id, sort_order, name, address, lat, lon, notes,
               zone, volume_m3, weight_kg, window_start, window_end, order_id
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             RETURNING id`,
            [
              jobId,
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
            [jobId, inserted.rows[0].id, o.id],
          );
        }
        await dbQuery(`UPDATE dispatch_jobs SET updated_at = now() WHERE id = $1`, [jobId]);
        const routeDepot =
          route.meta?.depot &&
          Number.isFinite(Number(route.meta.depot.lat)) &&
          Number.isFinite(Number(route.meta.depot.lon))
            ? { lat: Number(route.meta.depot.lat), lon: Number(route.meta.depot.lon) }
            : depotMode === "depot" && depotLat != null && depotLon != null
              ? { lat: depotLat, lon: depotLon }
              : null;
        await reorderJobStopsRoad(jobId, routeDepot, routing);
        const row = await loadJob(dbTenant.id, jobId);
        const stops = await loadStops(jobId);
        const routeGeom = await buildRouteForPoints(
          stops
            .filter(
              (s) =>
                s.lat != null &&
                s.lon != null &&
                Number.isFinite(Number(s.lat)) &&
                Number.isFinite(Number(s.lon)),
            )
            .map((s) => ({ lat: Number(s.lat), lon: Number(s.lon) })),
          routing,
        );
        applied.push({
          ...route,
          jobId,
          job: publicJob(row, stops),
          route: routeGeom,
        });
      }

      json(res, 200, {
        plan: {
          ...preview,
          apply: true,
          routes: applied,
        },
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
