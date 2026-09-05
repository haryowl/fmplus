/**
 * Admin control-plane HTTP API under /api/admin/*
 */
import { databaseUrlConfigured, dbQuery } from "./db.mjs";
import {
  adminCookieName,
  adminFromRequest,
  clearSessionCookieHeader,
  createSession,
  destroySessionByToken,
  maybeBootstrapAdmin,
  readCookies,
  sessionCookieHeader,
  verifyPassword,
  writeAudit,
} from "./admin-auth.mjs";
import { encryptSecret, hashWebhookSecret, secretsKeyConfigured } from "./crypto-secrets.mjs";
import { defaultEntitlements, mergeEntitlements } from "./entitlements.mjs";
import { initTenantVault, isTenantKey } from "./tenants.mjs";
import { securityHeaders } from "./proxy-lt.mjs";

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

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function asIdList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
}

function publicTenantRow(row) {
  return {
    id: row.id,
    key: row.key,
    appId: Number(row.app_id),
    displayName: row.display_name || "",
    enabled: row.enabled !== false,
    userIds: Array.isArray(row.user_ids) ? row.user_ids.map(Number) : [],
    groupIds: Array.isArray(row.group_ids) ? row.group_ids.map(Number) : [],
    entitlements: mergeEntitlements(row.entitlements),
    hasWebhookSecret: Boolean(row.webhook_secret_hash),
    hasToken: Boolean(row.token_ciphertext),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    notifierUrlTemplate: `https://<fmplus-host>/api/armada/notify?k=${encodeURIComponent(row.key)}&secret=<webhook-secret>`,
  };
}

async function requireAdmin(req, res) {
  const admin = await adminFromRequest(req);
  if (!admin) {
    json(res, 401, { error: "Admin login required" });
    return null;
  }
  return admin;
}

export async function handleAdminRequest(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  if (!url.pathname.startsWith("/api/admin")) return false;

  if (!databaseUrlConfigured()) {
    json(res, 503, { error: "DATABASE_URL is not configured" });
    return true;
  }

  try {
    await maybeBootstrapAdmin();
  } catch (err) {
    console.warn("[admin] bootstrap:", err instanceof Error ? err.message : err);
  }

  const path = url.pathname;

  try {
    if (path === "/api/admin/health" && req.method === "GET") {
      json(res, 200, {
        ok: true,
        secretsKey: secretsKeyConfigured(),
        database: true,
      });
      return true;
    }

    if (path === "/api/admin/login" && req.method === "POST") {
      const body = await readJson(req);
      const username = String(body.username || "").trim();
      const password = String(body.password || "");
      if (!username || !password) {
        json(res, 400, { error: "Username and password required" });
        return true;
      }
      const found = await dbQuery(
        `SELECT id, username, password_hash, enabled FROM admin_users WHERE username = $1`,
        [username],
      );
      const row = found.rows[0];
      if (!row || row.enabled === false || !verifyPassword(password, row.password_hash)) {
        json(res, 401, { error: "Invalid credentials" });
        return true;
      }
      const session = await createSession(row.id);
      await writeAudit(row.id, "admin.login", { username: row.username });
      const maxAge = Math.floor((session.expiresAt.getTime() - Date.now()) / 1000);
      json(
        res,
        200,
        { ok: true, username: row.username },
        { "Set-Cookie": sessionCookieHeader(session.token, maxAge) },
      );
      return true;
    }

    if (path === "/api/admin/logout" && req.method === "POST") {
      const token = readCookies(req)[adminCookieName()];
      const admin = await adminFromRequest(req);
      if (token) await destroySessionByToken(token);
      if (admin) await writeAudit(admin.id, "admin.logout", {});
      json(res, 200, { ok: true }, { "Set-Cookie": clearSessionCookieHeader() });
      return true;
    }

    if (path === "/api/admin/me" && req.method === "GET") {
      const admin = await adminFromRequest(req);
      if (!admin) {
        json(res, 401, { error: "Not logged in" });
        return true;
      }
      json(res, 200, { username: admin.username });
      return true;
    }

    if (path === "/api/admin/entitlements/defaults" && req.method === "GET") {
      const admin = await requireAdmin(req, res);
      if (!admin) return true;
      json(res, 200, defaultEntitlements());
      return true;
    }

    if (path === "/api/admin/tenants" && req.method === "GET") {
      const admin = await requireAdmin(req, res);
      if (!admin) return true;
      const rows = await dbQuery(
        `SELECT id, key, app_id, display_name, enabled, user_ids, group_ids, entitlements,
                webhook_secret_hash, token_ciphertext, created_at, updated_at
         FROM tenants
         ORDER BY created_at DESC`,
      );
      json(res, 200, { tenants: rows.rows.map(publicTenantRow) });
      return true;
    }

    if (path === "/api/admin/tenants" && req.method === "POST") {
      const admin = await requireAdmin(req, res);
      if (!admin) return true;
      if (!secretsKeyConfigured()) {
        json(res, 503, { error: "FMS_SECRETS_KEY is required to store Armada tokens" });
        return true;
      }
      const body = await readJson(req);
      const key = String(body.key || "").trim();
      const appId = Number(body.appId);
      const token = String(body.token || "").trim();
      if (!isTenantKey(key)) {
        json(res, 400, { error: "Invalid embed key (8–80 chars: A–Z a–z 0–9 . _ -)" });
        return true;
      }
      if (!Number.isInteger(appId) || appId < 1) {
        json(res, 400, { error: "Invalid appId" });
        return true;
      }
      if (!token) {
        json(res, 400, { error: "Armada token is required" });
        return true;
      }
      const entitlements = mergeEntitlements(body.entitlements);
      const userIds = asIdList(body.userIds);
      const groupIds = asIdList(body.groupIds);
      const displayName = String(body.displayName || "").trim();
      const webhookSecret = String(body.webhookSecret || "").trim();
      const webhookHash = webhookSecret ? hashWebhookSecret(webhookSecret) : null;
      const tokenCipher = encryptSecret(token);
      const inserted = await dbQuery(
        `INSERT INTO tenants (
           key, app_id, token_ciphertext, webhook_secret_hash, user_ids, group_ids, entitlements, enabled, display_name
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
         RETURNING id, key, app_id, display_name, enabled, user_ids, group_ids, entitlements,
                   webhook_secret_hash, token_ciphertext, created_at, updated_at`,
        [
          key,
          appId,
          tokenCipher,
          webhookHash,
          userIds,
          groupIds,
          JSON.stringify(entitlements),
          body.enabled !== false,
          displayName || null,
        ],
      );
      await writeAudit(admin.id, "tenant.create", { key, appId });
      await initTenantVault();
      json(res, 201, { tenant: publicTenantRow(inserted.rows[0]) });
      return true;
    }

    const tenantMatch = /^\/api\/admin\/tenants\/([0-9a-f-]{36})$/i.exec(path);
    if (tenantMatch) {
      const id = tenantMatch[1];
      const admin = await requireAdmin(req, res);
      if (!admin) return true;

      if (req.method === "GET") {
        const found = await dbQuery(
          `SELECT id, key, app_id, display_name, enabled, user_ids, group_ids, entitlements,
                  webhook_secret_hash, token_ciphertext, created_at, updated_at
           FROM tenants WHERE id = $1`,
          [id],
        );
        if (!found.rows[0]) {
          json(res, 404, { error: "Tenant not found" });
          return true;
        }
        json(res, 200, { tenant: publicTenantRow(found.rows[0]) });
        return true;
      }

      if (req.method === "PATCH") {
        if (!secretsKeyConfigured()) {
          json(res, 503, { error: "FMS_SECRETS_KEY is required to store Armada tokens" });
          return true;
        }
        const body = await readJson(req);
        const found = await dbQuery(`SELECT * FROM tenants WHERE id = $1`, [id]);
        const current = found.rows[0];
        if (!current) {
          json(res, 404, { error: "Tenant not found" });
          return true;
        }

        let key = current.key;
        if (body.key !== undefined) {
          key = String(body.key || "").trim();
          if (!isTenantKey(key)) {
            json(res, 400, { error: "Invalid embed key" });
            return true;
          }
        }
        let appId = Number(current.app_id);
        if (body.appId !== undefined) {
          appId = Number(body.appId);
          if (!Number.isInteger(appId) || appId < 1) {
            json(res, 400, { error: "Invalid appId" });
            return true;
          }
        }
        let tokenCipher = current.token_ciphertext;
        if (body.token !== undefined && String(body.token).trim()) {
          tokenCipher = encryptSecret(String(body.token).trim());
        }
        let webhookHash = current.webhook_secret_hash;
        if (body.webhookSecret !== undefined) {
          const secret = String(body.webhookSecret || "").trim();
          webhookHash = secret ? hashWebhookSecret(secret) : null;
        }
        const userIds = body.userIds !== undefined ? asIdList(body.userIds) : current.user_ids;
        const groupIds = body.groupIds !== undefined ? asIdList(body.groupIds) : current.group_ids;
        const entitlements =
          body.entitlements !== undefined
            ? mergeEntitlements(body.entitlements)
            : mergeEntitlements(current.entitlements);
        const enabled = body.enabled !== undefined ? body.enabled !== false : current.enabled !== false;
        const displayName =
          body.displayName !== undefined
            ? String(body.displayName || "").trim() || null
            : current.display_name;

        const updated = await dbQuery(
          `UPDATE tenants SET
             key = $2,
             app_id = $3,
             token_ciphertext = $4,
             webhook_secret_hash = $5,
             user_ids = $6,
             group_ids = $7,
             entitlements = $8::jsonb,
             enabled = $9,
             display_name = $10,
             updated_at = now()
           WHERE id = $1
           RETURNING id, key, app_id, display_name, enabled, user_ids, group_ids, entitlements,
                     webhook_secret_hash, token_ciphertext, created_at, updated_at`,
          [
            id,
            key,
            appId,
            tokenCipher,
            webhookHash,
            userIds,
            groupIds,
            JSON.stringify(entitlements),
            enabled,
            displayName,
          ],
        );
        await writeAudit(admin.id, "tenant.update", {
          id,
          key,
          tokenRotated: Boolean(body.token && String(body.token).trim()),
        });
        await initTenantVault();
        json(res, 200, { tenant: publicTenantRow(updated.rows[0]) });
        return true;
      }

      if (req.method === "DELETE") {
        const deleted = await dbQuery(`DELETE FROM tenants WHERE id = $1 RETURNING key`, [id]);
        if (!deleted.rows[0]) {
          json(res, 404, { error: "Tenant not found" });
          return true;
        }
        await writeAudit(admin.id, "tenant.delete", { id, key: deleted.rows[0].key });
        await initTenantVault();
        json(res, 200, { ok: true });
        return true;
      }
    }

    json(res, 404, { error: "Not found" });
    return true;
  } catch (err) {
    const status = err?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("duplicate key") || message.includes("unique")) {
      json(res, 409, { error: "Embed key already exists" });
      return true;
    }
    console.error("[admin]", message);
    json(res, status >= 400 && status < 600 ? status : 500, { error: message });
    return true;
  }
}

// re-export for boot
export { maybeBootstrapAdmin };
