/**
 * Phase B0 — Armada Command notifier ingest.
 * GET/POST /api/armada/notify?k=&secret=&kind=exception|maintenance → plain text OK
 */
import { databaseUrlConfigured, dbQuery } from "./db.mjs";
import { verifyWebhookSecret } from "./crypto-secrets.mjs";
import { securityHeaders } from "./proxy-lt.mjs";

function send(res, status, headers, body) {
  res.writeHead(status, securityHeaders(headers));
  res.end(body);
}

function plain(res, status, text) {
  send(
    res,
    status,
    {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
    text,
  );
}

function jsonError(res, status, message) {
  send(
    res,
    status,
    {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    JSON.stringify({ error: message }),
  );
}

/** @param {import('node:http').IncomingMessage} req */
function readBody(req, limit = 256_000) {
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

/**
 * @param {URLSearchParams} query
 * @param {Record<string, string>} [bodyParams]
 */
function resolveKind(query, bodyParams = {}) {
  const raw = String(query.get("kind") || bodyParams.kind || "")
    .trim()
    .toLowerCase();
  if (raw === "exception" || raw === "maintenance") return raw;
  const ruleName = String(
    query.get("RULE_NAME") || bodyParams.RULE_NAME || query.get("ruleName") || bodyParams.ruleName || "",
  );
  if (/maint|service|pm\b|odometer/i.test(ruleName)) return "maintenance";
  return "exception";
}

/**
 * @param {URLSearchParams} query
 * @param {Record<string, string>} [bodyParams]
 */
function collectPayload(query, bodyParams = {}) {
  /** @type {Record<string, string>} */
  const out = { ...bodyParams };
  for (const [key, value] of query.entries()) {
    if (key === "k" || key === "secret" || key === "kind") continue;
    out[key] = value;
  }
  return out;
}

function parseCoord(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseEventTime(value) {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * @param {string} kind
 * @param {Record<string, string>} payload
 */
function buildDedupeKey(kind, payload) {
  const eventTime = String(payload.EVENT_TIME || payload.eventTime || "");
  const user = String(payload.USER_USERNAME || payload.USER_NAME || payload.userName || "");
  const rule = String(payload.RULE_NAME || payload.ruleName || "");
  return `${kind}|${eventTime}|${user}|${rule}`;
}

export async function handleArmadaNotifyRequest(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname !== "/api/armada/notify") return false;
  if (req.method !== "GET" && req.method !== "POST") {
    plain(res, 405, "Method Not Allowed");
    return true;
  }

  if (!databaseUrlConfigured()) {
    jsonError(res, 503, "DATABASE_URL is not configured");
    return true;
  }

  try {
    /** @type {Record<string, string>} */
    let bodyParams = {};
    if (req.method === "POST") {
      const raw = await readBody(req);
      const ct = String(req.headers["content-type"] || "");
      if (ct.includes("application/json") && raw.trim()) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          for (const [k, v] of Object.entries(parsed)) {
            bodyParams[k] = v == null ? "" : String(v);
          }
        }
      } else if (raw.trim()) {
        const form = new URLSearchParams(raw);
        for (const [k, v] of form.entries()) bodyParams[k] = v;
      }
    }

    const k = String(url.searchParams.get("k") || bodyParams.k || "").trim();
    const secret = String(url.searchParams.get("secret") || bodyParams.secret || "").trim();
    if (!k || !secret) {
      jsonError(res, 401, "k and secret required");
      return true;
    }

    const tenantRes = await dbQuery(
      `SELECT id, key, webhook_secret_hash, enabled FROM tenants WHERE key = $1`,
      [k],
    );
    const tenant = tenantRes.rows[0];
    if (!tenant || tenant.enabled === false || !verifyWebhookSecret(secret, tenant.webhook_secret_hash)) {
      jsonError(res, 401, "Unauthorized");
      return true;
    }

    const kind = resolveKind(url.searchParams, bodyParams);
    const payload = collectPayload(url.searchParams, bodyParams);
    const ruleName = String(payload.RULE_NAME || payload.ruleName || "") || null;
    const armadaUsername = String(payload.USER_USERNAME || payload.userName || "") || null;
    const userDisplayName = String(payload.USER_NAME || payload.userDisplayName || "") || null;
    const eventTime = parseEventTime(payload.EVENT_TIME || payload.eventTime);
    const lat = parseCoord(payload.POS_LATITUDE || payload.POS_LAT || payload.lat);
    const lon = parseCoord(payload.POS_LONGITUDE || payload.POS_LON || payload.lon);
    const dedupeKey = buildDedupeKey(kind, payload);

    await dbQuery(
      `INSERT INTO armada_notifications (
         tenant_id, kind, rule_name, event_time, armada_username, user_display_name,
         lat, lon, payload, dedupe_key
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
       ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`,
      [
        tenant.id,
        kind,
        ruleName,
        eventTime,
        armadaUsername,
        userDisplayName,
        lat,
        lon,
        JSON.stringify(payload),
        dedupeKey,
      ],
    );

    plain(res, 200, "OK");
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[armada-notify]", message);
    jsonError(res, err?.status && err.status < 600 ? err.status : 500, message);
    return true;
  }
}
