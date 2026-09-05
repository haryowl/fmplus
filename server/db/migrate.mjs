/**
 * Apply SQL files in server/db/migrations/ in name order.
 *
 *   node server/db/migrate.mjs
 *   npm run db:migrate
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, databaseUrlConfigured, dbQuery, getPool } from "../db.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.join(root, ".env"));
loadEnvFile(path.join(root, ".env.local"));

async function ensureMigrationsTable() {
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function runMigrations() {
  if (!databaseUrlConfigured()) {
    console.log("DATABASE_URL not set — skip migrations");
    return { applied: [], skipped: true };
  }
  getPool();
  await ensureMigrationsTable();
  const dir = path.join(root, "server", "db", "migrations");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const applied = [];
  for (const file of files) {
    const id = file;
    const exists = await dbQuery("SELECT 1 FROM schema_migrations WHERE id = $1", [id]);
    if (exists.rowCount > 0) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [id]);
      await client.query("COMMIT");
      applied.push(id);
      console.log(`Applied ${id}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  if (applied.length === 0) console.log("Migrations up to date");
  return { applied, skipped: false };
}

async function main() {
  try {
    await runMigrations();
    await closePool();
  } catch (err) {
    console.error(err);
    await closePool();
    process.exit(1);
  }
}

if (process.argv[1] && /migrate\.mjs$/i.test(path.resolve(process.argv[1]))) {
  void main();
}
