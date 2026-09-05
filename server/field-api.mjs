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

function publicFieldUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    displayName: user.displayName || user.display_name || "",
    tenantKey: user.tenantKey || user.tenant_key,
    appId: user.appId ?? user.app_id,
  };
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
                t.key AS tenant_key, t.app_id, t.enabled AS tenant_enabled
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
            appId: Number(row.app_id),
          }),
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
      json(res, 200, { user: publicFieldUser(user) });
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
