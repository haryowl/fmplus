/**
 * Optional PostgreSQL pool. When DATABASE_URL is unset, all helpers no-op / return null.
 */
import pg from "pg";

/** @type {import('pg').Pool | null} */
let pool = null;

export function databaseUrlConfigured() {
  return Boolean(String(process.env.DATABASE_URL || "").trim());
}

export function getPool() {
  if (!databaseUrlConfigured()) return null;
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX || 10),
    });
  }
  return pool;
}

export async function dbQuery(text, params) {
  const p = getPool();
  if (!p) throw new Error("DATABASE_URL is not configured");
  return p.query(text, params);
}

export async function dbHealth() {
  if (!databaseUrlConfigured()) return { ok: false, configured: false };
  try {
    const p = getPool();
    const res = await p.query("SELECT 1 AS ok");
    return { ok: res.rows[0]?.ok === 1, configured: true };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
