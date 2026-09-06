/**
 * Maintenance D0–D1 API under /api/maintenance/*
 * GET   /api/maintenance/events?status=due|in_progress|done|skipped|open|all
 * POST  /api/maintenance/events
 * PATCH /api/maintenance/events/:id
 */
import { databaseUrlConfigured, dbQuery } from "./db.mjs";
import { tenantFromRequest } from "./tenants.mjs";
import { securityHeaders } from "./proxy-lt.mjs";

const STATUSES = ["due", "in_progress", "done", "skipped"];

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
function readBody(req, limit = 64_000) {
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

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<{ id: string, key: string } | null>}
 */
async function resolveDbTenant(req) {
  const tenant = tenantFromRequest(req);
  if (!tenant || !tenant.key) return null;
  if (!databaseUrlConfigured()) return null;
  const found = await dbQuery(
    `SELECT id, key FROM tenants WHERE key = $1 AND enabled = true`,
    [tenant.key],
  );
  const row = found.rows[0];
  if (!row) return null;
  return { id: row.id, key: row.key };
}

function publicEvent(row) {
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLS = `id, status, title, notes, armada_user_id, armada_username, user_display_name,
  lat, lon, notification_id, started_at, ended_at, odometer_km, created_at, updated_at`;

/**
 * @param {string} from
 * @param {string} to
 */
function canTransition(from, to) {
  if (from === to) return true;
  if (from === "due" && (to === "in_progress" || to === "done" || to === "skipped")) return true;
  if (from === "in_progress" && (to === "done" || to === "skipped" || to === "due")) return true;
  if ((from === "done" || from === "skipped") && to === "due") return true;
  return false;
}

export async function handleMaintenanceRequest(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  if (!url.pathname.startsWith("/api/maintenance")) return false;

  if (!databaseUrlConfigured()) {
    json(res, 503, { error: "DATABASE_URL is not configured" });
    return true;
  }

  try {
    const dbTenant = await resolveDbTenant(req);
    if (!dbTenant) {
      json(res, 401, { error: "Unknown embed tenant (k= required for maintenance)" });
      return true;
    }

    if (url.pathname === "/api/maintenance/events" && req.method === "GET") {
      const status = String(url.searchParams.get("status") || "open").toLowerCase();
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
      /** @type {string[]} */
      const clauses = ["tenant_id = $1"];
      /** @type {unknown[]} */
      const params = [dbTenant.id];

      if (status === "open") {
        clauses.push("status IN ('due', 'in_progress')");
      } else if (STATUSES.includes(status)) {
        params.push(status);
        clauses.push(`status = $${params.length}`);
      } else if (status !== "all") {
        json(res, 400, { error: "Invalid status filter" });
        return true;
      }

      params.push(limit);
      const rows = await dbQuery(
        `SELECT ${SELECT_COLS}
         FROM service_events
         WHERE ${clauses.join(" AND ")}
         ORDER BY created_at DESC
         LIMIT $${params.length}`,
        params,
      );
      json(res, 200, { events: rows.rows.map(publicEvent) });
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
      const inserted = await dbQuery(
        `INSERT INTO service_events (
           tenant_id, status, title, notes, armada_user_id, armada_username, user_display_name, lat, lon
         ) VALUES ($1, 'due', $2, $3, $4, $5, $6, $7, $8)
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
        ],
      );
      json(res, 201, { event: publicEvent(inserted.rows[0]) });
      return true;
    }

    const patchMatch = /^\/api\/maintenance\/events\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (patchMatch && req.method === "PATCH") {
      const id = patchMatch[1];
      const body = await readJson(req);
      const found = await dbQuery(
        `SELECT ${SELECT_COLS} FROM service_events WHERE id = $1 AND tenant_id = $2`,
        [id, dbTenant.id],
      );
      const current = found.rows[0];
      if (!current) {
        json(res, 404, { error: "Service event not found" });
        return true;
      }

      let status = current.status;
      if (body.status !== undefined) {
        status = String(body.status || "").trim();
        if (!STATUSES.includes(status)) {
          json(res, 400, { error: `status must be one of: ${STATUSES.join(", ")}` });
          return true;
        }
        if (!canTransition(current.status, status)) {
          json(res, 400, { error: `Cannot transition from ${current.status} to ${status}` });
          return true;
        }
      }

      const notes =
        body.notes !== undefined ? String(body.notes || "").trim() || null : current.notes;

      let startedAt = current.started_at;
      let endedAt = current.ended_at;
      if (status === "in_progress" && !startedAt) startedAt = new Date().toISOString();
      if ((status === "done" || status === "skipped") && !endedAt) endedAt = new Date().toISOString();
      if (status === "due") {
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

      const updated = await dbQuery(
        `UPDATE service_events SET
           status = $3,
           notes = $4,
           started_at = $5,
           ended_at = $6,
           odometer_km = $7,
           updated_at = now()
         WHERE id = $1 AND tenant_id = $2
         RETURNING ${SELECT_COLS}`,
        [id, dbTenant.id, status, notes, startedAt, endedAt, odometerKm],
      );
      json(res, 200, { event: publicEvent(updated.rows[0]) });
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
