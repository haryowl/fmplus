/**
 * Maintenance API (D0–D3) under /api/maintenance/*
 */
import crypto from "node:crypto";
import { databaseUrlConfigured, dbQuery } from "./db.mjs";
import { tenantFromRequest } from "./tenants.mjs";
import { securityHeaders } from "./proxy-lt.mjs";
import { getObject, objectStorageConfigured, putObject } from "./storage.mjs";

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
function readBody(req, limit = 8_000_000) {
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
  assigned_field_user_id, created_at, updated_at`;

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
    startedAt: row.started_at || null,
    endedAt: row.ended_at || null,
    odometerKm: row.odometer_km == null ? null : Number(row.odometer_km),
    servicePointId: row.service_point_id || null,
    servicePointName: row.service_point_name || "",
    servicePointLat: row.service_point_lat == null ? null : Number(row.service_point_lat),
    servicePointLon: row.service_point_lon == null ? null : Number(row.service_point_lon),
    assignedFieldUserId: row.assigned_field_user_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extras,
  };
}

function canTransition(from, to) {
  if (from === to) return true;
  if (from === "due" && (to === "in_progress" || to === "done" || to === "skipped")) return true;
  if (from === "in_progress" && (to === "done" || to === "skipped" || to === "due")) return true;
  if ((from === "done" || from === "skipped") && to === "due") return true;
  return false;
}

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
 */
export async function applyEventPatch(current, body, tenantId) {
  let status = current.status;
  if (body.status !== undefined) {
    status = String(body.status || "").trim();
    if (!STATUSES.includes(status)) {
      const err = new Error(`status must be one of: ${STATUSES.join(", ")}`);
      err.status = 400;
      throw err;
    }
    if (!canTransition(current.status, status)) {
      const err = new Error(`Cannot transition from ${current.status} to ${status}`);
      err.status = 400;
      throw err;
    }
  }

  const title =
    body.title !== undefined ? String(body.title || "").trim().slice(0, 200) || current.title : current.title;
  const notes = body.notes !== undefined ? String(body.notes || "").trim() || null : current.notes;

  let startedAt = current.started_at;
  let endedAt = current.ended_at;
  if (status === "in_progress" && !startedAt) startedAt = new Date().toISOString();
  if ((status === "done" || status === "skipped") && !endedAt) endedAt = new Date().toISOString();
  if (status === "due" && body.status !== undefined) {
    startedAt = null;
    endedAt = null;
  }
  if (body.startedAt !== undefined) {
    startedAt = body.startedAt ? new Date(String(body.startedAt)).toISOString() : null;
  }
  if (body.endedAt !== undefined) {
    endedAt = body.endedAt ? new Date(String(body.endedAt)).toISOString() : null;
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

  const updated = await dbQuery(
    `UPDATE service_events SET
       status = $3, title = $4, notes = $5, started_at = $6, ended_at = $7, odometer_km = $8,
       service_point_id = $9, service_point_name = $10, service_point_lat = $11, service_point_lon = $12,
       assigned_field_user_id = $13, updated_at = now()
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
    ],
  );

  if (Array.isArray(body.lines)) {
    await replaceLines(current.id, body.lines);
  }

  return loadEventDetail(tenantId, current.id);
}

export async function savePhoto(eventId, tenantId, { buffer, contentType, caption, fieldUserId }) {
  if (!objectStorageConfigured()) {
    const err = new Error("Object storage is not configured");
    err.status = 503;
    throw err;
  }
  const key = `pom/${tenantId}/${eventId}/${crypto.randomUUID()}`;
  await putObject(key, buffer, contentType || "image/jpeg");
  const inserted = await dbQuery(
    `INSERT INTO service_event_photos (event_id, storage_key, content_type, bytes, caption, uploaded_by_field_user_id)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, content_type, bytes, caption, created_at`,
    [eventId, key, contentType || "image/jpeg", buffer.length, caption || null, fieldUserId || null],
  );
  return publicPhoto(inserted.rows[0]);
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
      const photoId = photoMatch[1];
      const found = await dbQuery(
        `SELECT p.storage_key, p.content_type
         FROM service_event_photos p
         JOIN service_events e ON e.id = p.event_id
         WHERE p.id = $1 AND e.tenant_id = $2`,
        [photoId, dbTenant.id],
      );
      if (!found.rows[0]) {
        json(res, 404, { error: "Photo not found" });
        return true;
      }
      const obj = await getObject(found.rows[0].storage_key);
      send(
        res,
        200,
        {
          "Content-Type": obj.contentType || found.rows[0].content_type || "image/jpeg",
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
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
      const clauses = ["tenant_id = $1"];
      const params = [dbTenant.id];
      if (status === "open") clauses.push("status IN ('due', 'in_progress')");
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
      json(res, 200, { events: rows.rows.map((r) => publicEvent(r)) });
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
      const inserted = await dbQuery(
        `INSERT INTO service_events (
           tenant_id, status, title, notes, armada_user_id, armada_username, user_display_name, lat, lon, odometer_km
         ) VALUES ($1, 'due', $2, $3, $4, $5, $6, $7, $8, $9)
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
        ],
      );
      json(res, 201, { event: publicEvent(inserted.rows[0]) });
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
      const dataUrl = String(body.dataUrl || body.data || "");
      const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
      if (!m) {
        json(res, 400, { error: "dataUrl (base64 data URI) required" });
        return true;
      }
      const buffer = Buffer.from(m[2], "base64");
      if (buffer.length < 32 || buffer.length > 6_000_000) {
        json(res, 400, { error: "Image must be between 32B and 6MB" });
        return true;
      }
      const photo = await savePhoto(id, dbTenant.id, {
        buffer,
        contentType: m[1],
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
      json(res, 200, { event: detail });
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
      const event = await applyEventPatch(found.rows[0], body, dbTenant.id);
      json(res, 200, { event });
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
