/**
 * Field-user password sessions (Maintenance / Dispatch PWA).
 * Separate cookie from Admin; reuses scrypt helpers.
 */
import crypto from "node:crypto";
import { databaseUrlConfigured, dbQuery } from "./db.mjs";
import { hashPassword, readCookies, verifyPassword } from "./admin-auth.mjs";

const COOKIE = "fmplus_field_sid";
const SESSION_DAYS = 14;
export const FIELD_ROLES = ["operator", "driver", "dispatcher"];

export function fieldCookieName() {
  return COOKIE;
}

export { hashPassword, verifyPassword };

function hashToken(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function fieldSessionCookieHeader(token, maxAgeSec) {
  const secure = process.env.ADMIN_COOKIE_SECURE === "1" || process.env.NODE_ENV === "production";
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, maxAgeSec)}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearFieldSessionCookieHeader() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/**
 * @param {string} fieldUserId
 * @returns {Promise<{ token: string, expiresAt: Date }>}
 */
export async function createFieldSession(fieldUserId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await dbQuery(
    `INSERT INTO field_sessions (field_user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [fieldUserId, hashToken(token), expiresAt.toISOString()],
  );
  return { token, expiresAt };
}

/** @param {import('node:http').IncomingMessage} req */
export async function fieldFromRequest(req) {
  if (!databaseUrlConfigured()) return null;
  const token = readCookies(req)[COOKIE];
  if (!token) return null;
  const res = await dbQuery(
    `SELECT s.id AS session_id, u.id, u.username, u.role, u.display_name, u.enabled,
            t.id AS tenant_id, t.key AS tenant_key, t.app_id, t.enabled AS tenant_enabled
     FROM field_sessions s
     JOIN field_users u ON u.id = s.field_user_id
     JOIN tenants t ON t.id = u.tenant_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  const row = res.rows[0];
  if (!row || row.enabled === false || row.tenant_enabled === false) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    displayName: row.display_name || "",
    sessionId: row.session_id,
    tenantId: row.tenant_id,
    tenantKey: row.tenant_key,
    appId: Number(row.app_id),
  };
}

/** @param {string} token */
export async function destroyFieldSessionByToken(token) {
  if (!token) return;
  await dbQuery(`DELETE FROM field_sessions WHERE token_hash = $1`, [hashToken(token)]);
}

/** @param {string} role */
export function isFieldRole(role) {
  return FIELD_ROLES.includes(String(role || ""));
}

/** @param {string} username */
export function isFieldUsername(username) {
  const u = String(username || "").trim();
  return /^[A-Za-z0-9._-]{2,64}$/.test(u);
}
