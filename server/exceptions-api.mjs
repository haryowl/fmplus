/**
 * Exceptions inbox API — list/ack Armada notifier rows for the embed tenant.
 * GET  /api/exceptions?status=open|acked|all&limit=
 * POST /api/exceptions/:id/ack  body: { note? }
 */
import { databaseUrlConfigured, dbQuery } from "./db.mjs";
import { tenantFromRequest } from "./tenants.mjs";
import { securityHeaders } from "./proxy-lt.mjs";

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
 * @returns {Promise<{ id: string, key: string, userIds: number[] } | null>}
 */
async function resolveDbTenant(req) {
  const tenant = tenantFromRequest(req);
  if (!tenant || !tenant.key) return null;
  if (!databaseUrlConfigured()) return null;
  const found = await dbQuery(
    `SELECT id, key, user_ids FROM tenants WHERE key = $1 AND enabled = true`,
    [tenant.key],
  );
  const row = found.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    userIds: Array.isArray(row.user_ids) ? row.user_ids.map(Number) : [],
  };
}

function publicException(row) {
  return {
    id: row.id,
    kind: row.kind,
    ruleName: row.rule_name || "",
    eventTime: row.event_time || null,
    armadaUsername: row.armada_username || "",
    userDisplayName: row.user_display_name || "",
    lat: row.lat == null ? null : Number(row.lat),
    lon: row.lon == null ? null : Number(row.lon),
    payload: row.payload && typeof row.payload === "object" ? row.payload : {},
    createdAt: row.created_at,
    ackedAt: row.acked_at || null,
    ackedNote: row.acked_note || "",
    source: "notify",
  };
}

export async function handleExceptionsRequest(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  if (!url.pathname.startsWith("/api/exceptions")) return false;

  if (!databaseUrlConfigured()) {
    json(res, 503, { error: "DATABASE_URL is not configured" });
    return true;
  }

  try {
    const dbTenant = await resolveDbTenant(req);
    if (!dbTenant) {
      json(res, 401, { error: "Unknown embed tenant (k= required for exceptions)" });
      return true;
    }

    if (url.pathname === "/api/exceptions" && req.method === "GET") {
      const status = String(url.searchParams.get("status") || "open").toLowerCase();
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
      /** @type {string[]} */
      const clauses = [`tenant_id = $1`, `kind = 'exception'`];
      /** @type {unknown[]} */
      const params = [dbTenant.id];
      if (status === "open") clauses.push("acked_at IS NULL");
      else if (status === "acked") clauses.push("acked_at IS NOT NULL");
      // status=all → no acked filter

      if (dbTenant.userIds.length) {
        // Prefer USER_USERNAME match is hard without Armada id map; filter by payload userId if present later.
        // Keep all for now when allowlist set — UI may still deep-link.
      }

      params.push(limit);
      const rows = await dbQuery(
        `SELECT id, kind, rule_name, event_time, armada_username, user_display_name,
                lat, lon, payload, created_at, acked_at, acked_note
         FROM armada_notifications
         WHERE ${clauses.join(" AND ")}
         ORDER BY COALESCE(event_time, created_at) DESC
         LIMIT $${params.length}`,
        params,
      );
      json(res, 200, { exceptions: rows.rows.map(publicException) });
      return true;
    }

    const ackMatch = /^\/api\/exceptions\/([0-9a-f-]{36})\/ack$/i.exec(url.pathname);
    if (ackMatch && req.method === "POST") {
      const id = ackMatch[1];
      const body = await readJson(req);
      const note = String(body.note || "").trim().slice(0, 500);
      const updated = await dbQuery(
        `UPDATE armada_notifications
         SET acked_at = COALESCE(acked_at, now()),
             acked_note = CASE WHEN $3 = '' THEN acked_note ELSE $3 END
         WHERE id = $1 AND tenant_id = $2 AND kind = 'exception'
         RETURNING id, kind, rule_name, event_time, armada_username, user_display_name,
                   lat, lon, payload, created_at, acked_at, acked_note`,
        [id, dbTenant.id, note],
      );
      if (!updated.rows[0]) {
        json(res, 404, { error: "Exception not found" });
        return true;
      }
      json(res, 200, { exception: publicException(updated.rows[0]) });
      return true;
    }

    const unackMatch = /^\/api\/exceptions\/([0-9a-f-]{36})\/unack$/i.exec(url.pathname);
    if (unackMatch && req.method === "POST") {
      const id = unackMatch[1];
      const updated = await dbQuery(
        `UPDATE armada_notifications
         SET acked_at = NULL, acked_note = NULL
         WHERE id = $1 AND tenant_id = $2 AND kind = 'exception'
         RETURNING id, kind, rule_name, event_time, armada_username, user_display_name,
                   lat, lon, payload, created_at, acked_at, acked_note`,
        [id, dbTenant.id],
      );
      if (!updated.rows[0]) {
        json(res, 404, { error: "Exception not found" });
        return true;
      }
      json(res, 200, { exception: publicException(updated.rows[0]) });
      return true;
    }

    json(res, 404, { error: "Not found" });
    return true;
  } catch (err) {
    const status = err?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[exceptions]", message);
    json(res, status >= 400 && status < 600 ? status : 500, { error: message });
    return true;
  }
}
