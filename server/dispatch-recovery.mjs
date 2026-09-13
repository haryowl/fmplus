/**
 * Mid-day recovery: freeze-aware reorder, planned ETA persistence,
 * dispatch ops exceptions, replan-remaining, SLA scorecard.
 */
import { dbQuery } from "./db.mjs";
import { optimizeOpenTour, haversineKm } from "./route-optimize.mjs";
import { getDistanceMatrix } from "./routing-matrix.mjs";
import { buildRouteForPoints } from "./route-plan-api.mjs";
import { buildStopRouteMeta } from "./stop-route-meta.mjs";

const DEFAULT_SERVICE_MIN = 8;
const AT_RISK_BUFFER_MIN = 15;
const STUCK_GPS_STALE_MIN = 20;
const STUCK_NO_PROGRESS_MIN = 45;

export function isFrozenStopStatus(status) {
  const st = String(status || "").toLowerCase();
  return st === "done" || st === "skipped";
}

export function isRemainingStopStatus(status) {
  const st = String(status || "").toLowerCase();
  return st === "pending" || st === "arrived";
}

function hmToMin(hm) {
  const m = String(hm || "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h * 60 + min;
}

function todayYmdJakarta() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

function nowHmJakarta() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const h = parts.find((p) => p.type === "hour")?.value || "00";
  const m = parts.find((p) => p.type === "minute")?.value || "00";
  return `${h}:${m}`;
}

function formatTimeWib(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function minutesSince(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 60000;
}

function coordOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Reorder only remaining (pending/arrived) stops with coords.
 * Frozen stops keep relative prefix order and lower sort_order indices.
 * @returns {{ changed: boolean, orderIds: string[], matrixEngine?: string }}
 */
export async function reorderRemainingStops(jobId, opts = {}) {
  const stopsRes = await dbQuery(
    `SELECT * FROM dispatch_stops WHERE job_id = $1 ORDER BY sort_order ASC, created_at ASC`,
    [jobId],
  );
  const stops = stopsRes.rows;
  const frozen = stops.filter((s) => isFrozenStopStatus(s.status));
  const remaining = stops.filter((s) => !isFrozenStopStatus(s.status));
  const movable = remaining.filter(
    (s) =>
      s.lat != null &&
      s.lon != null &&
      Number.isFinite(Number(s.lat)) &&
      Number.isFinite(Number(s.lon)),
  );
  const noCoords = remaining.filter((s) => !movable.some((m) => m.id === s.id));

  if (movable.length < 2 && !(opts.start && movable.length >= 1)) {
    return { changed: false, orderIds: movable.map((s) => s.id) };
  }

  const start =
    opts.start &&
    Number.isFinite(Number(opts.start.lat)) &&
    Number.isFinite(Number(opts.start.lon))
      ? { lat: Number(opts.start.lat), lon: Number(opts.start.lon) }
      : null;

  const customerPoints = movable.map((s) => ({
    lat: Number(s.lat),
    lon: Number(s.lon),
  }));
  const points = start ? [start, ...customerPoints] : customerPoints;
  if (points.length < 2) {
    return { changed: false, orderIds: movable.map((s) => s.id) };
  }

  const matrix = await getDistanceMatrix(points, opts.routing || null);
  const { order } = optimizeOpenTour(points, matrix.matrixKm);
  const customerOrder = start
    ? order.filter((i) => i > 0).map((i) => i - 1)
    : order;
  const orderedMovable = customerOrder.map((i) => movable[i]).filter(Boolean);

  let sort = 0;
  for (const s of frozen) {
    await dbQuery(`UPDATE dispatch_stops SET sort_order = $1 WHERE id = $2`, [
      sort++,
      s.id,
    ]);
  }
  const newIds = [];
  for (const s of orderedMovable) {
    newIds.push(s.id);
    await dbQuery(`UPDATE dispatch_stops SET sort_order = $1 WHERE id = $2`, [
      sort++,
      s.id,
    ]);
  }
  for (const s of noCoords) {
    await dbQuery(`UPDATE dispatch_stops SET sort_order = $1 WHERE id = $2`, [
      sort++,
      s.id,
    ]);
  }

  const prevMovableIds = movable.map((s) => s.id);
  const changed = newIds.some((id, i) => id !== prevMovableIds[i]);
  await dbQuery(`UPDATE dispatch_jobs SET updated_at = now() WHERE id = $1`, [jobId]);
  return {
    changed,
    orderIds: newIds,
    matrixEngine: matrix.engine,
    warning: matrix.warning || null,
  };
}

/**
 * Persist planned ETA HH:MM onto stops (and return fields on job if columns exist — stops only).
 */
export async function persistPlannedEtas(jobId, stopEtas) {
  if (!jobId || !Array.isArray(stopEtas)) return;
  for (const row of stopEtas) {
    if (!row?.stopId) continue;
    const eta = row.plannedEta != null ? String(row.plannedEta).slice(0, 16) : null;
    await dbQuery(`UPDATE dispatch_stops SET planned_eta = $1 WHERE id = $2 AND job_id = $3`, [
      eta,
      row.stopId,
      jobId,
    ]);
  }
}

/**
 * Compute planned ETA chain for a job's stops (same rules as Live) and optionally persist.
 */
export async function refreshAndPersistPlannedEtas(job, stops, { persist = true } = {}) {
  const pathMode = String(job.route_anchor_mode || "").toLowerCase();
  const hasAnchors = pathMode === "map" || pathMode === "sequence";
  const hasStart =
    hasAnchors &&
    job.route_start_lat != null &&
    job.route_start_lon != null &&
    Number.isFinite(Number(job.route_start_lat)) &&
    Number.isFinite(Number(job.route_start_lon));
  const hasEnd =
    hasAnchors &&
    job.route_end_lat != null &&
    job.route_end_lon != null &&
    Number.isFinite(Number(job.route_end_lat)) &&
    Number.isFinite(Number(job.route_end_lon));

  const customerPts = [];
  for (const s of stops) {
    const lat = coordOrNull(s.lat);
    const lon = coordOrNull(s.lon);
    if (lat == null || lon == null) return { ready: false, stopEtas: [] };
    customerPts.push({ lat, lon });
  }
  const points = [
    ...(hasStart
      ? [{ lat: Number(job.route_start_lat), lon: Number(job.route_start_lon) }]
      : []),
    ...customerPts,
    ...(hasEnd
      ? [{ lat: Number(job.route_end_lat), lon: Number(job.route_end_lon) }]
      : []),
  ];
  if (points.length < 2) return { ready: false, stopEtas: [] };

  try {
    const route = await buildRouteForPoints(points);
    const meta = buildStopRouteMeta(
      stops.map((s) => ({
        windowStart: s.window_start || s.windowStart,
        serviceMinutes: s.service_minutes ?? s.serviceMinutes,
      })),
      route.legs || [],
      DEFAULT_SERVICE_MIN,
      { hasRouteStart: hasStart, hasRouteEnd: hasEnd },
    );
    const stopEtas = stops.map((s, i) => ({
      stopId: s.id,
      plannedEta: meta.stops[i]?.eta || null,
      plannedLegDistanceKm: meta.stops[i]?.legDistanceKm ?? null,
      plannedLegDurationSec: meta.stops[i]?.legDurationSec ?? null,
    }));
    if (persist) await persistPlannedEtas(job.id, stopEtas);
    return {
      ready: true,
      stopEtas,
      plannedReturnEta: meta.returnLeg?.eta || null,
      plannedDistanceKm: route.distanceKm ?? null,
      plannedDurationSec: route.durationSec ?? null,
    };
  } catch {
    return { ready: false, stopEtas: [] };
  }
}

function remainingWorkFromDriver(driver) {
  const remaining = (driver.stops || []).filter(
    (s) => s.stopStatus === "pending" || s.stopStatus === "arrived",
  );
  return {
    remainingCount: remaining.length,
    remainingStopIds: remaining.map((s) => s.stopId),
    currentStopId: remaining[0]?.stopId || null,
    startFrom: driver.liveLat != null && driver.liveLon != null
      ? { lat: driver.liveLat, lon: driver.liveLon, source: "gps" }
      : driver.routeStart
        ? { ...driver.routeStart, source: "depot" }
        : null,
  };
}

/**
 * Detect open exceptions from a Live snapshot (in-memory). Does not write DB.
 */
export function detectExceptionsFromSnapshot(snapshot) {
  const serviceDate = snapshot.serviceDate;
  const today = todayYmdJakarta();
  const nowHm = nowHmJakarta();
  const nowMin = hmToMin(nowHm);
  /** @type {any[]} */
  const out = [];

  for (const driver of snapshot.drivers || []) {
    const jobActive = ["assigned", "en_route", "arrived"].includes(
      String(driver.jobStatus || ""),
    );

    // stuck: stale GPS or long no progress
    if (jobActive && driver.jobStatus !== "assigned") {
      const minsSinceStart = minutesSince(driver.startedAt);
      const hasProgress = (driver.doneCount || 0) > 0;
      const liveOk = driver.liveLat != null && driver.liveLon != null;
      // Without live age, treat missing GPS on en_route as stuck after threshold from start
      if (
        !hasProgress &&
        minsSinceStart != null &&
        minsSinceStart >= STUCK_NO_PROGRESS_MIN
      ) {
        out.push({
          kind: "stuck",
          severity: "warn",
          jobId: driver.jobId,
          stopId: driver.stops?.find((s) => s.stopStatus === "pending" || s.stopStatus === "arrived")
            ?.stopId || null,
          orderId: null,
          title: `${driver.driverName} — no progress`,
          detail: `En route ${Math.round(minsSinceStart)} min with no completed stops`,
          fingerprint: `stuck:noprogress:${driver.jobId}:${serviceDate}`,
          payload: { minutes: Math.round(minsSinceStart), reason: "no_progress" },
        });
      } else if (
        !liveOk &&
        minsSinceStart != null &&
        minsSinceStart >= STUCK_GPS_STALE_MIN
      ) {
        out.push({
          kind: "stuck",
          severity: "info",
          jobId: driver.jobId,
          stopId: null,
          orderId: null,
          title: `${driver.driverName} — no GPS`,
          detail: `No live vehicle position for ${Math.round(minsSinceStart)} min`,
          fingerprint: `stuck:nogps:${driver.jobId}:${serviceDate}`,
          payload: { minutes: Math.round(minsSinceStart), reason: "no_gps" },
        });
      }
    }

    for (const stop of driver.stops || []) {
      if (stop.stopStatus === "skipped") {
        out.push({
          kind: "failed_skip",
          severity: "warn",
          jobId: driver.jobId,
          stopId: stop.stopId,
          orderId: stop.orderId || null,
          title: `Skipped: ${stop.name || stop.externalRef || "stop"}`,
          detail: stop.skipReason
            ? `Skip reason: ${stop.skipReason}`
            : "Stop skipped — needs same-day recovery",
          fingerprint: `failed_skip:${stop.stopId}:${serviceDate}`,
          payload: { skipReason: stop.skipReason || "" },
        });
        continue;
      }

      if (isFrozenStopStatus(stop.stopStatus)) continue;
      if (serviceDate > today) continue;

      const winEnd = hmToMin(stop.windowEnd);
      const planned = hmToMin(stop.plannedEta);
      let atRisk = false;
      let reason = "";
      if (stop.delayed || (serviceDate < today && !isFrozenStopStatus(stop.stopStatus))) {
        atRisk = true;
        reason = "past_window";
      } else if (winEnd != null && planned != null && planned > winEnd) {
        atRisk = true;
        reason = "planned_after_window";
      } else if (
        winEnd != null &&
        nowMin != null &&
        planned != null &&
        planned - nowMin <= AT_RISK_BUFFER_MIN &&
        planned > nowMin
      ) {
        // approaching planned ETA near window end
        if (winEnd - nowMin <= AT_RISK_BUFFER_MIN) {
          atRisk = true;
          reason = "window_closing";
        }
      } else if (winEnd != null && nowMin != null && nowMin > winEnd - AT_RISK_BUFFER_MIN && nowMin <= winEnd) {
        atRisk = true;
        reason = "window_closing";
      }

      if (atRisk) {
        out.push({
          kind: "window_at_risk",
          severity: reason === "past_window" ? "critical" : "warn",
          jobId: driver.jobId,
          stopId: stop.stopId,
          orderId: stop.orderId || null,
          title: `At risk: ${stop.name || stop.externalRef || "stop"}`,
          detail:
            reason === "planned_after_window"
              ? `Planned ETA ${stop.plannedEta} after window end ${stop.windowEnd}`
              : reason === "past_window"
                ? `Past window end ${stop.windowEnd || "(day)"}`
                : `Window ends ${stop.windowEnd} — within ${AT_RISK_BUFFER_MIN} min`,
          fingerprint: `window_at_risk:${stop.stopId}:${serviceDate}`,
          payload: {
            reason,
            windowEnd: stop.windowEnd || "",
            plannedEta: stop.plannedEta || "",
            driverName: driver.driverName,
          },
        });
      }
    }
  }

  return out;
}

/**
 * Upsert detected exceptions; resolve open ones no longer detected.
 */
export async function syncOpsExceptions(tenantId, serviceDate, detected) {
  const open = await dbQuery(
    `SELECT id, fingerprint FROM dispatch_ops_exceptions
     WHERE tenant_id = $1 AND service_date = $2::date AND resolved_at IS NULL`,
    [tenantId, serviceDate],
  );
  const openByFp = new Map(open.rows.map((r) => [r.fingerprint, r.id]));
  const seen = new Set();

  for (const ex of detected) {
    seen.add(ex.fingerprint);
    const existingId = openByFp.get(ex.fingerprint);
    if (existingId) {
      await dbQuery(
        `UPDATE dispatch_ops_exceptions
         SET title = $1, detail = $2, severity = $3, payload = $4::jsonb,
             job_id = $5, stop_id = $6, order_id = $7, updated_at = now()
         WHERE id = $8`,
        [
          ex.title,
          ex.detail,
          ex.severity,
          JSON.stringify(ex.payload || {}),
          ex.jobId || null,
          ex.stopId || null,
          ex.orderId || null,
          existingId,
        ],
      );
    } else {
      await dbQuery(
        `INSERT INTO dispatch_ops_exceptions (
           tenant_id, service_date, kind, job_id, stop_id, order_id,
           severity, title, detail, payload, fingerprint
         ) VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,
        [
          tenantId,
          serviceDate,
          ex.kind,
          ex.jobId || null,
          ex.stopId || null,
          ex.orderId || null,
          ex.severity,
          ex.title,
          ex.detail,
          JSON.stringify(ex.payload || {}),
          ex.fingerprint,
        ],
      );
    }
  }

  for (const [fp, id] of openByFp) {
    if (seen.has(fp)) continue;
    await dbQuery(
      `UPDATE dispatch_ops_exceptions
       SET resolved_at = now(), updated_at = now()
       WHERE id = $1 AND resolved_at IS NULL`,
      [id],
    );
  }

  const list = await dbQuery(
    `SELECT * FROM dispatch_ops_exceptions
     WHERE tenant_id = $1 AND service_date = $2::date
       AND resolved_at IS NULL
     ORDER BY
       CASE severity WHEN 'critical' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END,
       created_at ASC
     LIMIT 200`,
    [tenantId, serviceDate],
  );
  return list.rows.map(publicOpsException);
}

export function publicOpsException(row) {
  return {
    id: row.id,
    kind: row.kind,
    serviceDate:
      row.service_date instanceof Date
        ? `${row.service_date.getFullYear()}-${String(row.service_date.getMonth() + 1).padStart(2, "0")}-${String(row.service_date.getDate()).padStart(2, "0")}`
        : String(row.service_date || "").slice(0, 10),
    jobId: row.job_id || null,
    stopId: row.stop_id || null,
    orderId: row.order_id || null,
    severity: row.severity || "warn",
    title: row.title || "",
    detail: row.detail || "",
    payload: row.payload && typeof row.payload === "object" ? row.payload : {},
    fingerprint: row.fingerprint || "",
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    resolvedAt: row.resolved_at || null,
    ackedAt: row.acked_at || null,
    ackedNote: row.acked_note || "",
  };
}

export async function ackOpsException(tenantId, exceptionId, note = "") {
  const res = await dbQuery(
    `UPDATE dispatch_ops_exceptions
     SET acked_at = now(), acked_note = $1, updated_at = now()
     WHERE id = $2 AND tenant_id = $3
     RETURNING *`,
    [String(note || "").slice(0, 500), exceptionId, tenantId],
  );
  return res.rows[0] ? publicOpsException(res.rows[0]) : null;
}

async function writeReplanAudit(tenantId, serviceDate, entry) {
  await dbQuery(
    `INSERT INTO dispatch_replan_audit (
       tenant_id, service_date, actor, action, job_id, stop_id, payload
     ) VALUES ($1,$2::date,$3,$4,$5,$6,$7::jsonb)`,
    [
      tenantId,
      serviceDate,
      entry.actor || "user",
      entry.action,
      entry.jobId || null,
      entry.stopId || null,
      JSON.stringify(entry.payload || {}),
    ],
  );
}

/**
 * Build mid-day recovery suggestions for remaining work.
 */
export async function buildReplanRemainingPreview(tenantId, opts = {}) {
  const serviceDate = opts.serviceDate || todayYmdJakarta();
  const jobFilter = Array.isArray(opts.jobIds)
    ? opts.jobIds.filter((id) => /^[0-9a-f-]{36}$/i.test(String(id)))
    : [];

  const jobsRes = await dbQuery(
    `SELECT j.*,
            u.display_name AS assignee_display_name,
            u.username AS assignee_username
     FROM dispatch_jobs j
     LEFT JOIN field_users u ON u.id = j.assigned_field_user_id
     WHERE j.tenant_id = $1
       AND j.service_date = $2::date
       AND j.status IN ('assigned', 'en_route', 'arrived')
       ${jobFilter.length ? `AND j.id = ANY($3::uuid[])` : ""}
     ORDER BY j.updated_at DESC
     LIMIT 50`,
    jobFilter.length
      ? [tenantId, serviceDate, jobFilter]
      : [tenantId, serviceDate],
  );

  const jobIds = jobsRes.rows.map((j) => j.id);
  /** @type {Map<string, any[]>} */
  const stopsByJob = new Map();
  if (jobIds.length) {
    const stops = await dbQuery(
      `SELECT * FROM dispatch_stops
       WHERE job_id = ANY($1::uuid[])
       ORDER BY job_id, sort_order ASC, created_at ASC`,
      [jobIds],
    );
    for (const s of stops.rows) {
      const list = stopsByJob.get(s.job_id) || [];
      list.push(s);
      stopsByJob.set(s.job_id, list);
    }
  }

  let posMap = new Map();
  if (opts.posMap instanceof Map) posMap = opts.posMap;

  /** @type {any[]} */
  const suggestions = [];

  // Capacity residuals for move suggestions
  const openJobs = jobsRes.rows.map((j) => {
    const stops = stopsByJob.get(j.id) || [];
    const remaining = stops.filter((s) => isRemainingStopStatus(s.status));
    const volCap = j.volume_capacity_m3 == null ? 12 : Number(j.volume_capacity_m3) || 12;
    const wtCap = j.weight_capacity_kg == null ? 1500 : Number(j.weight_capacity_kg) || 1500;
    let volUsed = 0;
    let wtUsed = 0;
    for (const s of remaining) {
      volUsed += Number(s.volume_m3) || 0;
      wtUsed += Number(s.weight_kg) || 0;
    }
    return {
      job: j,
      stops,
      remaining,
      volResidual: Math.max(0, volCap - volUsed),
      wtResidual: Math.max(0, wtCap - wtUsed),
      label:
        j.assignee_display_name ||
        j.assignee_username ||
        j.title ||
        j.id.slice(0, 8),
    };
  });

  for (const entry of openJobs) {
    const { job, remaining } = entry;
    const movable = remaining.filter(
      (s) =>
        s.lat != null &&
        s.lon != null &&
        Number.isFinite(Number(s.lat)) &&
        Number.isFinite(Number(s.lon)),
    );

    const uid = job.armada_user_id != null ? Number(job.armada_user_id) : null;
    const live = uid != null && Number.isFinite(uid) ? posMap.get(uid) : null;
    const start =
      live?.lat != null && live?.lon != null
        ? { lat: Number(live.lat), lon: Number(live.lon), source: "gps" }
        : job.route_start_lat != null && job.route_start_lon != null
          ? {
              lat: Number(job.route_start_lat),
              lon: Number(job.route_start_lon),
              source: "depot",
            }
          : null;

    if (movable.length >= 2 || (start && movable.length >= 1)) {
      // Preview order without writing
      const customerPoints = movable.map((s) => ({
        lat: Number(s.lat),
        lon: Number(s.lon),
      }));
      const points = start
        ? [{ lat: start.lat, lon: start.lon }, ...customerPoints]
        : customerPoints;
      if (points.length >= 2) {
        try {
          const matrix = await getDistanceMatrix(points, opts.routing || null);
          const { order } = optimizeOpenTour(points, matrix.matrixKm);
          const customerOrder = start
            ? order.filter((i) => i > 0).map((i) => i - 1)
            : order;
          const toIds = customerOrder.map((i) => movable[i]?.id).filter(Boolean);
          const fromIds = movable.map((s) => s.id);
          const changed = toIds.some((id, i) => id !== fromIds[i]);
          if (changed) {
            suggestions.push({
              id: `reorder:${job.id}`,
              type: "reorder_same_vehicle",
              safeAuto: true,
              jobId: job.id,
              jobLabel: entry.label,
              fromStopIds: fromIds,
              toStopIds: toIds,
              startFrom: start,
              reason: start?.source === "gps"
                ? "Reorder remaining stops from live GPS"
                : "Reorder remaining stops (frozen done/skipped kept)",
            });
          }
        } catch {
          /* skip matrix failure */
        }
      }
    }

    // Skipped → return to pool
    for (const s of entry.stops) {
      if (String(s.status).toLowerCase() !== "skipped") continue;
      suggestions.push({
        id: `return:${s.id}`,
        type: "return_stop",
        safeAuto: false,
        jobId: job.id,
        jobLabel: entry.label,
        stopId: s.id,
        stopName: s.name || "",
        orderId: s.order_id || null,
        reason: "Return skipped stop to pending pool for reassignment",
      });
    }

    // At-risk pending with window → suggest move to lighter nearby job
    for (const s of remaining) {
      const winEnd = hmToMin(s.window_end);
      const planned = hmToMin(s.planned_eta);
      const late =
        (winEnd != null && planned != null && planned > winEnd) ||
        (winEnd != null && hmToMin(nowHmJakarta()) != null && hmToMin(nowHmJakarta()) > winEnd);
      if (!late) continue;
      const slat = coordOrNull(s.lat);
      const slon = coordOrNull(s.lon);
      if (slat == null || slon == null) continue;
      const demandVol = Number(s.volume_m3) || 0;
      const demandWt = Number(s.weight_kg) || 0;

      let best = null;
      for (const other of openJobs) {
        if (other.job.id === job.id) continue;
        if (other.volResidual + 1e-9 < demandVol || other.wtResidual + 1e-9 < demandWt) {
          continue;
        }
        const otherRem = other.remaining.filter(
          (x) => x.lat != null && x.lon != null,
        );
        if (!otherRem.length && !(other.job.route_start_lat != null)) continue;
        const ref = otherRem[0] || {
          lat: other.job.route_start_lat,
          lon: other.job.route_start_lon,
        };
        const dist = haversineKm(slat, slon, Number(ref.lat), Number(ref.lon));
        if (!best || dist < best.dist) {
          best = { other, dist };
        }
      }
      if (best && best.dist < 40) {
        suggestions.push({
          id: `move:${s.id}:${best.other.job.id}`,
          type: "move_stop",
          safeAuto: false,
          fromJobId: job.id,
          toJobId: best.other.job.id,
          fromJobLabel: entry.label,
          toJobLabel: best.other.label,
          stopId: s.id,
          stopName: s.name || "",
          orderId: s.order_id || null,
          reason: `Move at-risk stop ~${Math.round(best.dist * 10) / 10} km toward ${best.other.label}`,
          distanceKm: Math.round(best.dist * 10) / 10,
        });
      }
    }
  }

  return {
    serviceDate,
    suggestions,
    suggestionCount: suggestions.length,
  };
}

/**
 * Apply one or more suggestions. Cross-vehicle never auto unless explicitly listed.
 */
export async function applyReplanSuggestions(tenantId, opts = {}) {
  const serviceDate = opts.serviceDate || todayYmdJakarta();
  const actor = opts.actor === "auto_safe" ? "auto_safe" : "user";
  const autoSafeOnly = opts.autoSafeOnly === true;
  let preview = opts.preview;
  if (!preview) {
    preview = await buildReplanRemainingPreview(tenantId, {
      serviceDate,
      jobIds: opts.jobIds,
      posMap: opts.posMap,
      routing: opts.routing,
    });
  }

  let selected = Array.isArray(opts.suggestionIds)
    ? preview.suggestions.filter((s) => opts.suggestionIds.includes(s.id))
    : preview.suggestions;

  if (autoSafeOnly) {
    selected = selected.filter((s) => s.safeAuto && s.type === "reorder_same_vehicle");
  }

  /** @type {any[]} */
  const applied = [];
  /** @type {any[]} */
  const skipped = [];

  for (const s of selected) {
    try {
      if (s.type === "reorder_same_vehicle") {
        if (autoSafeOnly && !s.safeAuto) {
          skipped.push({ id: s.id, reason: "not_safe_auto" });
          continue;
        }
        const result = await reorderRemainingStops(s.jobId, {
          start: s.startFrom,
          routing: opts.routing,
        });
        const jobRow = (
          await dbQuery(`SELECT * FROM dispatch_jobs WHERE id = $1 AND tenant_id = $2`, [
            s.jobId,
            tenantId,
          ])
        ).rows[0];
        if (jobRow) {
          const stops = (
            await dbQuery(
              `SELECT * FROM dispatch_stops WHERE job_id = $1 ORDER BY sort_order ASC`,
              [s.jobId],
            )
          ).rows;
          await refreshAndPersistPlannedEtas(jobRow, stops, { persist: true });
        }
        await writeReplanAudit(tenantId, serviceDate, {
          actor,
          action: "reorder_same_vehicle",
          jobId: s.jobId,
          payload: { suggestionId: s.id, orderIds: result.orderIds, changed: result.changed },
        });
        applied.push({ ...s, changed: result.changed });
      } else if (s.type === "return_stop") {
        if (autoSafeOnly) {
          skipped.push({ id: s.id, reason: "not_safe_auto" });
          continue;
        }
        const stop = (
          await dbQuery(
            `SELECT s.*, j.tenant_id FROM dispatch_stops s
             JOIN dispatch_jobs j ON j.id = s.job_id
             WHERE s.id = $1 AND j.tenant_id = $2`,
            [s.stopId, tenantId],
          )
        ).rows[0];
        if (!stop) {
          skipped.push({ id: s.id, reason: "stop_not_found" });
          continue;
        }
        if (stop.order_id) {
          await dbQuery(
            `UPDATE dispatch_orders
             SET stop_id = NULL, job_id = NULL, status = 'pending', updated_at = now()
             WHERE id = $1 AND tenant_id = $2`,
            [stop.order_id, tenantId],
          );
        }
        await dbQuery(`DELETE FROM dispatch_stops WHERE id = $1`, [stop.id]);
        await writeReplanAudit(tenantId, serviceDate, {
          actor,
          action: "return_stop",
          jobId: s.jobId,
          stopId: s.stopId,
          payload: { suggestionId: s.id, orderId: stop.order_id },
        });
        applied.push(s);
      } else if (s.type === "move_stop") {
        if (autoSafeOnly) {
          skipped.push({ id: s.id, reason: "not_safe_auto" });
          continue;
        }
        const stop = (
          await dbQuery(
            `SELECT s.* FROM dispatch_stops s
             JOIN dispatch_jobs j ON j.id = s.job_id
             WHERE s.id = $1 AND j.tenant_id = $2 AND j.id = $3`,
            [s.stopId, tenantId, s.fromJobId],
          )
        ).rows[0];
        const toJob = (
          await dbQuery(`SELECT * FROM dispatch_jobs WHERE id = $1 AND tenant_id = $2`, [
            s.toJobId,
            tenantId,
          ])
        ).rows[0];
        if (!stop || !toJob) {
          skipped.push({ id: s.id, reason: "not_found" });
          continue;
        }
        if (isFrozenStopStatus(stop.status)) {
          skipped.push({ id: s.id, reason: "frozen_stop" });
          continue;
        }
        const maxSort = await dbQuery(
          `SELECT COALESCE(MAX(sort_order), -1)::int AS m FROM dispatch_stops WHERE job_id = $1`,
          [toJob.id],
        );
        const nextSort = (maxSort.rows[0]?.m ?? -1) + 1;
        await dbQuery(
          `UPDATE dispatch_stops
           SET job_id = $1, sort_order = $2, status = 'pending', arrived_at = NULL
           WHERE id = $3`,
          [toJob.id, nextSort, stop.id],
        );
        if (stop.order_id) {
          await dbQuery(
            `UPDATE dispatch_orders SET job_id = $1, stop_id = $2, updated_at = now() WHERE id = $3`,
            [toJob.id, stop.id, stop.order_id],
          );
        }
        await writeReplanAudit(tenantId, serviceDate, {
          actor,
          action: "move_stop",
          jobId: toJob.id,
          stopId: stop.id,
          payload: {
            suggestionId: s.id,
            fromJobId: s.fromJobId,
            toJobId: s.toJobId,
          },
        });
        applied.push(s);
      } else {
        skipped.push({ id: s.id, reason: "unknown_type" });
      }
    } catch (err) {
      skipped.push({ id: s.id, reason: err?.message || "apply_failed" });
    }
  }

  return {
    serviceDate,
    actor,
    applied,
    skipped,
    appliedCount: applied.length,
  };
}

/**
 * SLA / OTP scorecard from Live-shaped snapshot (or rebuild inputs).
 */
export function computeSlaFromSnapshot(snapshot) {
  const stops = snapshot.manifest || [];
  let withWindow = 0;
  let onTime = 0;
  let late = 0;
  let skipped = 0;
  let delivered = 0;
  /** @type {number[]} */
  const lagMins = [];
  /** @type {Map<string, { driverName: string, delivered: number, late: number, skipped: number, onTime: number, withWindow: number }>} */
  const byDriver = new Map();

  function bucket(row) {
    const key = row.jobId || "unknown";
    if (!byDriver.has(key)) {
      byDriver.set(key, {
        jobId: key,
        driverName: row.driverName || "—",
        vehicleLabel: row.vehicleLabel || "",
        delivered: 0,
        late: 0,
        skipped: 0,
        onTime: 0,
        withWindow: 0,
      });
    }
    return byDriver.get(key);
  }

  for (const s of stops) {
    const b = bucket(s);
    if (s.status === "skipped" || s.stopStatus === "skipped") {
      skipped += 1;
      b.skipped += 1;
      continue;
    }
    if (s.status === "delivered" || s.stopStatus === "done") {
      delivered += 1;
      b.delivered += 1;
      const winEnd = hmToMin(s.windowEnd);
      const actualHm = formatTimeWib(s.completedAt || s.arrivedAt);
      const actual = hmToMin(actualHm);
      const planned = hmToMin(s.plannedEta);
      if (winEnd != null && actual != null) {
        withWindow += 1;
        b.withWindow += 1;
        if (actual <= winEnd) {
          onTime += 1;
          b.onTime += 1;
        } else {
          late += 1;
          b.late += 1;
        }
      }
      if (planned != null && actual != null) {
        lagMins.push(actual - planned);
      }
    }
  }

  lagMins.sort((a, b) => a - b);
  const medianLag =
    lagMins.length === 0
      ? null
      : lagMins.length % 2 === 1
        ? lagMins[(lagMins.length - 1) / 2]
        : Math.round(
            ((lagMins[lagMins.length / 2 - 1] + lagMins[lagMins.length / 2]) / 2) * 10,
          ) / 10;

  const otpPct =
    withWindow > 0 ? Math.round((onTime / withWindow) * 1000) / 10 : null;
  const summary = snapshot.summary || {};
  const atRisk = (snapshot.exceptions || []).filter((e) => e.kind === "window_at_risk").length;
  const stuck = (snapshot.exceptions || []).filter((e) => e.kind === "stuck").length;
  const failedSkip = (snapshot.exceptions || []).filter((e) => e.kind === "failed_skip").length;

  return {
    serviceDate: snapshot.serviceDate,
    otpPct,
    onTime,
    late,
    withWindow,
    delivered,
    skipped,
    atRiskCount: atRisk,
    stuckCount: stuck,
    failedSkipCount: failedSkip,
    delayedCount: summary.delayed || 0,
    medianPlanLagMin: medianLag,
    byDriver: [...byDriver.values()].sort((a, b) =>
      String(a.driverName).localeCompare(String(b.driverName)),
    ),
  };
}

/**
 * Enrich Live snapshot with remainingWork, exceptions sync, SLA, and persist ETAs.
 */
export async function enrichLiveSnapshot(tenantId, snapshot, { persistEtas = true } = {}) {
  for (const driver of snapshot.drivers || []) {
    driver.remainingWork = remainingWorkFromDriver(driver);
    // Prefer stored planned_eta when chain failed for a stop
    for (const s of driver.stops || []) {
      if (!s.plannedEta && s.storedPlannedEta) s.plannedEta = s.storedPlannedEta;
    }
  }

  if (persistEtas) {
    for (const driver of snapshot.drivers || []) {
      if (!driver.plannedEtaReady) continue;
      const etas = (driver.stops || [])
        .filter((s) => s.plannedEta)
        .map((s) => ({ stopId: s.stopId, plannedEta: s.plannedEta }));
      if (etas.length) {
        try {
          await persistPlannedEtas(driver.jobId, etas);
        } catch {
          /* column may not exist yet mid-migrate */
        }
      }
    }
  }

  const detected = detectExceptionsFromSnapshot(snapshot);
  let exceptions = [];
  try {
    exceptions = await syncOpsExceptions(tenantId, snapshot.serviceDate, detected);
  } catch {
    exceptions = detected.map((d, i) => ({
      id: `ephemeral-${i}`,
      ...d,
      serviceDate: snapshot.serviceDate,
      ackedAt: null,
      ackedNote: "",
      resolvedAt: null,
      createdAt: snapshot.updatedAt,
      updatedAt: snapshot.updatedAt,
    }));
  }

  snapshot.exceptions = exceptions;
  snapshot.exceptionSummary = {
    total: exceptions.length,
    windowAtRisk: exceptions.filter((e) => e.kind === "window_at_risk").length,
    stuck: exceptions.filter((e) => e.kind === "stuck").length,
    failedSkip: exceptions.filter((e) => e.kind === "failed_skip").length,
    unacked: exceptions.filter((e) => !e.ackedAt).length,
  };
  snapshot.sla = computeSlaFromSnapshot(snapshot);
  return snapshot;
}
