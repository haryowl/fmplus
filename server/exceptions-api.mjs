/**
 * Exceptions inbox API — list/ack Armada notifier rows for the embed tenant.
 * GET  /api/exceptions?status=open|acked|all&limit=
 * POST /api/exceptions/:id/ack  body: { note? }
 */
import { databaseUrlConfigured, dbQuery } from "./db.mjs";
import { resolveDbTenant } from "./maintenance-api.mjs";
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

const DEVICE_UUID_RE = /^[0-9a-f-]{36}$/i;

function payloadObject(row) {
  return row?.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
    ? row.payload
    : {};
}

function payloadUserId(payload) {
  const n = Number(payload?.USER_ID ?? payload?.userId ?? payload?.UserId);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function payloadDeviceHint(payload) {
  return String(
    payload?.DEVICE_ID ??
      payload?.deviceId ??
      payload?.trackerDeviceId ??
      payload?.TRACKER_DEVICE_ID ??
      payload?.IMEI ??
      payload?.imei ??
      "",
  ).trim();
}

/**
 * Map notifier rows to linked GPS devices (Armada user id, IMEI, or device UUID).
 * @param {string} tenantId
 * @param {object[]} rows
 * @returns {Promise<Map<string, string>>} notification id → tracker device id
 */
async function trackerDeviceIdsForNotifications(tenantId, rows) {
  const userIds = [];
  const imeis = [];
  const uuids = [];
  for (const row of rows) {
    const payload = payloadObject(row);
    const uid = payloadUserId(payload);
    if (uid) userIds.push(uid);
    const hint = payloadDeviceHint(payload);
    if (DEVICE_UUID_RE.test(hint)) uuids.push(hint.toLowerCase());
    else if (hint) imeis.push(hint.toLowerCase());
  }
  /** @type {Map<string, string>} */
  const byRowId = new Map();
  if (!userIds.length && !imeis.length && !uuids.length) return byRowId;

  const found = await dbQuery(
    `SELECT id::text AS id, armada_user_id, lower(imei) AS imei
     FROM tracker_devices
     WHERE tenant_id = $1 AND enabled = true
       AND (
         (cardinality($2::int[]) > 0 AND armada_user_id = ANY($2::int[]))
         OR (cardinality($3::text[]) > 0 AND lower(imei) = ANY($3::text[]))
         OR (cardinality($4::uuid[]) > 0 AND id = ANY($4::uuid[]))
       )`,
    [tenantId, userIds, imeis, uuids],
  );
  const byUserId = new Map();
  const byImei = new Map();
  const byUuid = new Set();
  for (const d of found.rows) {
    byUuid.add(String(d.id).toLowerCase());
    if (d.armada_user_id != null) byUserId.set(Number(d.armada_user_id), d.id);
    if (d.imei) byImei.set(d.imei, d.id);
  }
  for (const row of rows) {
    const payload = payloadObject(row);
    const hint = payloadDeviceHint(payload);
    if (DEVICE_UUID_RE.test(hint) && byUuid.has(hint.toLowerCase())) {
      byRowId.set(row.id, hint.toLowerCase());
      continue;
    }
    if (hint && byImei.has(hint.toLowerCase())) {
      byRowId.set(row.id, byImei.get(hint.toLowerCase()));
      continue;
    }
    const uid = payloadUserId(payload);
    if (uid != null && byUserId.has(uid)) byRowId.set(row.id, byUserId.get(uid));
  }
  return byRowId;
}

function publicException(row, trackerDeviceId = null) {
  const payload = payloadObject(row);
  const userId = payloadUserId(payload);
  const hint = payloadDeviceHint(payload);
  const deviceId =
    (trackerDeviceId && DEVICE_UUID_RE.test(String(trackerDeviceId))
      ? String(trackerDeviceId)
      : null) ||
    (DEVICE_UUID_RE.test(hint) ? hint : null);
  return {
    id: row.id,
    kind: row.kind,
    ruleName: row.rule_name || "",
    eventTime: row.event_time || null,
    armadaUsername: row.armada_username || "",
    userDisplayName: row.user_display_name || "",
    lat: row.lat == null ? null : Number(row.lat),
    lon: row.lon == null ? null : Number(row.lon),
    payload,
    createdAt: row.created_at,
    ackedAt: row.acked_at || null,
    ackedNote: row.acked_note || "",
    source: "notify",
    userId,
    trackerDeviceId: deviceId,
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
      const deviceById = await trackerDeviceIdsForNotifications(dbTenant.id, rows.rows);
      json(res, 200, {
        exceptions: rows.rows.map((row) => publicException(row, deviceById.get(row.id) || null)),
      });
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
      const deviceById = await trackerDeviceIdsForNotifications(dbTenant.id, updated.rows);
      json(res, 200, {
        exception: publicException(updated.rows[0], deviceById.get(updated.rows[0].id) || null),
      });
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
      const deviceById = await trackerDeviceIdsForNotifications(dbTenant.id, updated.rows);
      json(res, 200, {
        exception: publicException(updated.rows[0], deviceById.get(updated.rows[0].id) || null),
      });
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
