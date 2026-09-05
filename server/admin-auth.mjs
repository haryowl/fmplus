/**
 * Admin password hashing (scrypt) and session cookies.
 */
import crypto from "node:crypto";
import { databaseUrlConfigured, dbQuery } from "./db.mjs";

const COOKIE = "fmplus_admin_sid";
const SESSION_DAYS = 7;

export function adminCookieName() {
  return COOKIE;
}

/** @param {string} password */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const N = 16384;
  const r = 8;
  const p = 1;
  const hash = crypto.scryptSync(String(password), salt, 32, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

/** @param {string} password @param {string} encoded */
export function verifyPassword(password, encoded) {
  const parts = String(encoded || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], "base64url");
  const expected = Buffer.from(parts[5], "base64url");
  const actual = crypto.scryptSync(String(password), salt, expected.length, { N, r, p });
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/** @param {import('node:http').IncomingMessage} req */
export function readCookies(req) {
  /** @type {Record<string, string>} */
  const out = {};
  const raw = String(req.headers.cookie || "");
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function sessionCookieHeader(token, maxAgeSec) {
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

export function clearSessionCookieHeader() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/**
 * @param {string} adminUserId
 * @returns {Promise<{ token: string, expiresAt: Date }>}
 */
export async function createSession(adminUserId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await dbQuery(
    `INSERT INTO admin_sessions (admin_user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [adminUserId, hashToken(token), expiresAt.toISOString()],
  );
  return { token, expiresAt };
}

/** @param {import('node:http').IncomingMessage} req */
export async function adminFromRequest(req) {
  if (!databaseUrlConfigured()) return null;
  const token = readCookies(req)[COOKIE];
  if (!token) return null;
  const res = await dbQuery(
    `SELECT s.id AS session_id, u.id, u.username, u.enabled
     FROM admin_sessions s
     JOIN admin_users u ON u.id = s.admin_user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  const row = res.rows[0];
  if (!row || row.enabled === false) return null;
  return { id: row.id, username: row.username, sessionId: row.session_id };
}

/** @param {string} token */
export async function destroySessionByToken(token) {
  if (!token) return;
  await dbQuery(`DELETE FROM admin_sessions WHERE token_hash = $1`, [hashToken(token)]);
}

export async function destroySession(sessionId) {
  await dbQuery(`DELETE FROM admin_sessions WHERE id = $1`, [sessionId]);
}

/** Create bootstrap admin once when table empty and env set. */
export async function maybeBootstrapAdmin() {
  if (!databaseUrlConfigured()) return { created: false };
  const user = String(process.env.ADMIN_BOOTSTRAP_USER || "").trim();
  const pass = String(process.env.ADMIN_BOOTSTRAP_PASSWORD || "").trim();
  if (!user || !pass) return { created: false, reason: "no_env" };
  const count = await dbQuery(`SELECT COUNT(*)::int AS n FROM admin_users`);
  if ((count.rows[0]?.n || 0) > 0) return { created: false, reason: "exists" };
  const hash = hashPassword(pass);
  await dbQuery(`INSERT INTO admin_users (username, password_hash) VALUES ($1, $2)`, [user, hash]);
  console.log(`[admin] bootstrap user created: ${user}`);
  return { created: true, username: user };
}

/**
 * @param {string | null} adminUserId
 * @param {string} action
 * @param {object} [detail]
 */
export async function writeAudit(adminUserId, action, detail = {}) {
  if (!databaseUrlConfigured()) return;
  try {
    await dbQuery(`INSERT INTO admin_audit (admin_user_id, action, detail) VALUES ($1, $2, $3::jsonb)`, [
      adminUserId,
      action,
      JSON.stringify(detail || {}),
    ]);
  } catch (err) {
    console.warn("[admin] audit failed:", err instanceof Error ? err.message : err);
  }
}
