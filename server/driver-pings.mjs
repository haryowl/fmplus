/**
 * Driver phone location stream: ingest, latest-fix lookup, retention.
 *
 * The mobile PWA cannot take a GPS fix from a service worker (geolocation does
 * not exist in ServiceWorkerGlobalScope), so fixes are captured while the app
 * is alive, queued client-side, and flushed here in batches. That means gaps
 * are normal; consumers must judge freshness from recorded_at rather than
 * assuming the latest row is current.
 */
import { dbQuery } from "./db.mjs";

/** Reject a batch larger than this many fixes. */
export const MAX_PINGS_PER_BATCH = 50;
/** Small body cap: a full batch of fixes is a few KB, not a photo upload. */
export const PING_MAX_BODY_BYTES = 32 * 1024;
/** Fixes older than this are history, not useful for Live. */
const MAX_PING_AGE_MIN = 6 * 60;
/** Coarser than a city block is not worth storing. */
const MAX_ACCURACY_M = 2000;
/** Rows older than this are pruned by the periodic sweep. */
const RETENTION_DAYS = 14;

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;

/** @type {Map<string, number[]>} fieldUserId -> recent request timestamps */
const rateBuckets = new Map();

/**
 * Per-driver sliding window. In-memory on purpose: this guards one hot endpoint
 * on a single-process deployment, and losing the window on restart is harmless.
 * @returns {{ ok: boolean, retryAfterSec: number }}
 */
export function checkPingRateLimit(fieldUserId, now = Date.now()) {
  const key = String(fieldUserId || "");
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const hits = (rateBuckets.get(key) || []).filter((t) => t > cutoff);
  if (hits.length >= RATE_LIMIT_MAX_REQUESTS) {
    rateBuckets.set(key, hits);
    const retryAfterSec = Math.max(
      1,
      Math.ceil((hits[0] + RATE_LIMIT_WINDOW_MS - now) / 1000),
    );
    return { ok: false, retryAfterSec };
  }
  hits.push(now);
  rateBuckets.set(key, hits);
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) {
      if (!v.some((t) => t > cutoff)) rateBuckets.delete(k);
    }
  }
  return { ok: true, retryAfterSec: 0 };
}

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Validate one client fix.
 * @returns {{ ok: true, ping: object } | { ok: false, reason: string }}
 */
export function normalizePing(raw, now = Date.now()) {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "not_an_object" };
  const lat = numOrNull(raw.lat ?? raw.latitude);
  const lon = numOrNull(raw.lon ?? raw.lng ?? raw.longitude);
  if (lat == null || lon == null) return { ok: false, reason: "no_coords" };
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return { ok: false, reason: "out_of_range" };
  // A 0/0 fix is the classic "GPS not ready" sentinel, not the Gulf of Guinea.
  if (lat === 0 && lon === 0) return { ok: false, reason: "null_island" };

  const recordedRaw = raw.recordedAt ?? raw.recorded_at ?? raw.timestamp;
  let recordedMs = null;
  if (typeof recordedRaw === "number" && Number.isFinite(recordedRaw)) {
    recordedMs = recordedRaw;
  } else if (recordedRaw) {
    const parsed = Date.parse(String(recordedRaw));
    if (Number.isFinite(parsed)) recordedMs = parsed;
  }
  if (recordedMs == null) recordedMs = now;
  // Clock skew on the handset must not create fixes in the future.
  if (recordedMs > now + 60_000) recordedMs = now;
  const ageMin = (now - recordedMs) / 60_000;
  if (ageMin > MAX_PING_AGE_MIN) return { ok: false, reason: "too_old" };

  const accuracyM = numOrNull(raw.accuracyM ?? raw.accuracy_m ?? raw.accuracy);
  if (accuracyM != null && accuracyM > MAX_ACCURACY_M) {
    return { ok: false, reason: "too_coarse" };
  }

  const jobIdRaw = String(raw.jobId ?? raw.job_id ?? "").trim();
  const jobId = /^[0-9a-f-]{36}$/i.test(jobIdRaw) ? jobIdRaw : null;

  const headingRaw = numOrNull(raw.headingDeg ?? raw.heading_deg ?? raw.heading);
  const speedRaw = numOrNull(raw.speedMps ?? raw.speed_mps ?? raw.speed);

  return {
    ok: true,
    ping: {
      lat,
      lon,
      accuracyM: accuracyM == null ? null : Math.max(0, accuracyM),
      speedMps: speedRaw == null || speedRaw < 0 ? null : speedRaw,
      headingDeg:
        headingRaw == null || headingRaw < 0 || headingRaw > 360 ? null : headingRaw,
      recordedAt: new Date(recordedMs).toISOString(),
      jobId,
    },
  };
}

/**
 * Insert a validated batch. Duplicate (field_user_id, recorded_at) rows are
 * dropped so a retried queue flush is idempotent.
 */
export async function insertDriverPings(tenantId, fieldUserId, pings) {
  let accepted = 0;
  for (const p of pings) {
    const res = await dbQuery(
      `INSERT INTO driver_pings (
         tenant_id, field_user_id, job_id, lat, lon,
         accuracy_m, speed_mps, heading_deg, recorded_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz)
       ON CONFLICT (field_user_id, recorded_at) DO NOTHING
       RETURNING id`,
      [
        tenantId,
        fieldUserId,
        p.jobId,
        p.lat,
        p.lon,
        p.accuracyM,
        p.speedMps,
        p.headingDeg,
        p.recordedAt,
      ],
    );
    if (res.rows[0]) accepted += 1;
  }
  return accepted;
}

/**
 * Latest fix per driver for the given field users.
 * @returns {Promise<Map<string, object>>} fieldUserId -> position
 */
export async function latestPingsByFieldUser(tenantId, fieldUserIds) {
  const ids = [...new Set((fieldUserIds || []).filter(Boolean).map(String))];
  if (!ids.length) return new Map();
  const rows = await dbQuery(
    `SELECT DISTINCT ON (field_user_id)
            field_user_id, job_id, lat, lon, accuracy_m, speed_mps, heading_deg, recorded_at
     FROM driver_pings
     WHERE tenant_id = $1 AND field_user_id = ANY($2::uuid[])
     ORDER BY field_user_id, recorded_at DESC`,
    [tenantId, ids],
  );
  const out = new Map();
  for (const r of rows.rows) {
    const recordedAt = r.recorded_at instanceof Date ? r.recorded_at : new Date(r.recorded_at);
    out.set(String(r.field_user_id), {
      lat: Number(r.lat),
      lon: Number(r.lon),
      accuracyM: r.accuracy_m == null ? null : Number(r.accuracy_m),
      speedMps: r.speed_mps == null ? null : Number(r.speed_mps),
      headingDeg: r.heading_deg == null ? null : Number(r.heading_deg),
      recordedAt: recordedAt.toISOString(),
      ageSec: Math.max(0, Math.round((Date.now() - recordedAt.getTime()) / 1000)),
      jobId: r.job_id || null,
    });
  }
  return out;
}

/**
 * Trail for one driver on a calendar service date (Asia/Jakarta day bounds).
 * Oldest first. Used for Live map phone actual track.
 */
export async function pingTrailForServiceDate(tenantId, fieldUserId, serviceDate) {
  if (!fieldUserId || !serviceDate) return [];
  const rows = await dbQuery(
    `SELECT lat, lon, recorded_at
     FROM driver_pings
     WHERE tenant_id = $1 AND field_user_id = $2
       AND recorded_at >= ($3::date AT TIME ZONE 'Asia/Jakarta')
       AND recorded_at < (($3::date + 1) AT TIME ZONE 'Asia/Jakarta')
     ORDER BY recorded_at ASC
     LIMIT 2000`,
    [tenantId, fieldUserId, serviceDate],
  );
  return rows.rows.map((r) => ({
    lat: Number(r.lat),
    lon: Number(r.lon),
    recordedAt:
      r.recorded_at instanceof Date ? r.recorded_at.toISOString() : String(r.recorded_at),
  }));
}

/**
 * Recent trail for one driver, oldest first — used for dwell detection.
 */
export async function recentPingTrail(tenantId, fieldUserId, sinceMinutes = 60) {
  if (!fieldUserId) return [];
  const rows = await dbQuery(
    `SELECT lat, lon, recorded_at
     FROM driver_pings
     WHERE tenant_id = $1 AND field_user_id = $2
       AND recorded_at > now() - ($3 || ' minutes')::interval
     ORDER BY recorded_at ASC
     LIMIT 500`,
    [tenantId, fieldUserId, String(Math.max(1, Math.round(sinceMinutes)))],
  );
  return rows.rows.map((r) => ({
    lat: Number(r.lat),
    lon: Number(r.lon),
    recordedAt:
      r.recorded_at instanceof Date ? r.recorded_at.toISOString() : String(r.recorded_at),
  }));
}

/** Delete pings past the retention window. Safe to call repeatedly. */
export async function pruneDriverPings() {
  const res = await dbQuery(
    `DELETE FROM driver_pings
     WHERE recorded_at < now() - ($1 || ' days')::interval`,
    [String(RETENTION_DAYS)],
  );
  return res.rowCount || 0;
}
