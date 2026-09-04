/**
 * Disk cache for slimmed vehicle-day GPS points.
 * Past calendar days are reusable; "today" is never treated as final.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TENANT_RE = /^[A-Za-z0-9._-]{8,80}$/;

/** Keep cached past days at most this long. */
export const CACHE_MAX_AGE_DAYS = 60;
/** How often a request may trigger a purge walk. */
export const PURGE_EVERY_MS = 60 * 60 * 1000;

let lastPurgeAt = 0;

export function cacheRoot() {
  const fromEnv = String(process.env.DAY_TRACKS_CACHE_DIR || "").trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(rootDir, "data", "day-tracks");
}

export function tenantCacheScope(tenantKey) {
  const key = String(tenantKey || "").trim();
  if (TENANT_RE.test(key)) return key;
  return "_default";
}

export function isPastDay(date, todayYmd) {
  if (!DATE_RE.test(date) || !DATE_RE.test(todayYmd)) return false;
  return date < todayYmd;
}

export function todayKeyFromOffset(offset, nowMs = Date.now()) {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(String(offset || "").trim());
  const minutes = match
    ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
    : 0;
  return new Date(nowMs + minutes * 60_000).toISOString().slice(0, 10);
}

export function dayCachePath(scope, appId, userId, date) {
  const safeScope = tenantCacheScope(scope);
  const app = Number(appId);
  const user = Number(userId);
  if (!Number.isInteger(app) || app < 1) throw new Error("bad appId");
  if (!Number.isInteger(user) || user < 1) throw new Error("bad userId");
  if (!DATE_RE.test(date)) throw new Error("bad date");
  return path.join(cacheRoot(), safeScope, String(app), String(user), `${date}.json`);
}

export async function readCachedDay(scope, appId, userId, date) {
  try {
    const file = dayCachePath(scope, appId, userId, date);
    const text = await fsp.readFile(file, "utf8");
    if (!text || text[0] !== "[") return null;
    // Touch mtime so LRU-ish purge prefers older unread files.
    void fsp.utimes(file, new Date(), new Date()).catch(() => {});
    return text;
  } catch {
    return null;
  }
}

export async function writeCachedDay(scope, appId, userId, date, pointsJsonText) {
  if (typeof pointsJsonText !== "string" || pointsJsonText[0] !== "[") return;
  const file = dayCachePath(scope, appId, userId, date);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, pointsJsonText, "utf8");
  await fsp.rename(tmp, file);
}

/**
 * Delete cache files older than CACHE_MAX_AGE_DAYS (by mtime).
 * Cheap to call often: no-ops until PURGE_EVERY_MS has passed.
 */
export async function maybePurgeDayCache(nowMs = Date.now()) {
  if (nowMs - lastPurgeAt < PURGE_EVERY_MS) return { skipped: true, removed: 0 };
  lastPurgeAt = nowMs;
  const root = cacheRoot();
  if (!fs.existsSync(root)) return { skipped: false, removed: 0 };
  const cutoff = nowMs - CACHE_MAX_AGE_DAYS * 86_400_000;
  let removed = 0;

  async function walk(dir) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        try {
          const left = await fsp.readdir(full);
          if (left.length === 0) await fsp.rmdir(full);
        } catch {
          /* ignore */
        }
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        const st = await fsp.stat(full);
        if (st.mtimeMs < cutoff) {
          await fsp.unlink(full);
          removed += 1;
        }
      } catch {
        /* ignore */
      }
    }
  }

  await walk(root);
  if (removed > 0) console.log(`[day-tracks-cache] purged ${removed} files older than ${CACHE_MAX_AGE_DAYS}d`);
  return { skipped: false, removed };
}

/** Test helper */
export function resetPurgeClock() {
  lastPurgeAt = 0;
}
