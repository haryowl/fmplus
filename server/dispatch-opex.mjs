/**
 * Trip operating cost: km + stop + fixed + hour (IDR).
 * Rates: per-depot with tenant-global fallback.
 */
import { dbQuery } from "./db.mjs";
import { resolveSourceDepotId } from "./dispatch-stock.mjs";

export function moneyIdr(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Math.round(Number(n));
}

export function publicCostRates(row) {
  if (!row) {
    return {
      depotId: null,
      rateKm: 0,
      rateStop: 0,
      rateHour: 0,
      fixedTrip: 0,
      updatedAt: null,
    };
  }
  return {
    id: row.id,
    depotId: row.depot_id || null,
    depotName: row.depot_name || "",
    rateKm: Number(row.rate_km) || 0,
    rateStop: Number(row.rate_stop) || 0,
    rateHour: Number(row.rate_hour) || 0,
    fixedTrip: Number(row.fixed_trip) || 0,
    updatedAt: row.updated_at || null,
  };
}

/**
 * operating_cost = km×rate_km + stops×rate_stop + fixed + hours×rate_hour
 */
export function computeOperatingCost({
  distanceKm = 0,
  stopCount = 0,
  durationSec = 0,
  rateKm = 0,
  rateStop = 0,
  rateHour = 0,
  fixedTrip = 0,
} = {}) {
  const km = Math.max(0, Number(distanceKm) || 0);
  const stops = Math.max(0, Math.floor(Number(stopCount) || 0));
  const hours = Math.max(0, (Number(durationSec) || 0) / 3600);
  const total =
    km * (Number(rateKm) || 0) +
    stops * (Number(rateStop) || 0) +
    (Number(fixedTrip) || 0) +
    hours * (Number(rateHour) || 0);
  return moneyIdr(total) ?? 0;
}

export function contributionMargin({
  goodsSubtotal = null,
  goodsCostSubtotal = null,
  opex = null,
} = {}) {
  if (goodsSubtotal == null || !Number.isFinite(Number(goodsSubtotal))) return null;
  const sell = Number(goodsSubtotal);
  const cogs =
    goodsCostSubtotal != null && Number.isFinite(Number(goodsCostSubtotal))
      ? Number(goodsCostSubtotal)
      : 0;
  const op = opex != null && Number.isFinite(Number(opex)) ? Number(opex) : 0;
  return moneyIdr(sell - cogs - op);
}

export async function listCostRates(tenantId) {
  const rows = await dbQuery(
    `SELECT r.*, d.name AS depot_name
     FROM dispatch_cost_rates r
     LEFT JOIN dispatch_depots d ON d.id = r.depot_id AND d.tenant_id = r.tenant_id
     WHERE r.tenant_id = $1
     ORDER BY r.depot_id NULLS FIRST, lower(d.name) ASC NULLS FIRST`,
    [tenantId],
  );
  return rows.rows.map(publicCostRates);
}

export async function getEffectiveRates(tenantId, depotId = null) {
  if (depotId) {
    const depot = await dbQuery(
      `SELECT r.*, d.name AS depot_name
       FROM dispatch_cost_rates r
       LEFT JOIN dispatch_depots d ON d.id = r.depot_id
       WHERE r.tenant_id = $1 AND r.depot_id = $2
       LIMIT 1`,
      [tenantId, depotId],
    );
    if (depot.rows[0]) return publicCostRates(depot.rows[0]);
  }
  const global = await dbQuery(
    `SELECT * FROM dispatch_cost_rates
     WHERE tenant_id = $1 AND depot_id IS NULL
     LIMIT 1`,
    [tenantId],
  );
  return publicCostRates(global.rows[0] || null);
}

function parseRateBody(body) {
  const num = (v, fallback = 0) => {
    if (v == null || v === "") return fallback;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    rateKm: num(body.rateKm ?? body.rate_km),
    rateStop: num(body.rateStop ?? body.rate_stop),
    rateHour: num(body.rateHour ?? body.rate_hour),
    fixedTrip: num(body.fixedTrip ?? body.fixed_trip),
  };
}

/** Upsert global (depotId null) or per-depot rates. */
export async function upsertCostRates(tenantId, body) {
  const depotRaw = body.depotId ?? body.depot_id;
  const depotId =
    depotRaw == null || depotRaw === ""
      ? null
      : /^[0-9a-f-]{36}$/i.test(String(depotRaw))
        ? String(depotRaw)
        : null;
  if (depotRaw != null && depotRaw !== "" && !depotId) {
    const err = new Error("Invalid depotId");
    err.status = 400;
    throw err;
  }
  if (depotId) {
    const ok = await dbQuery(
      `SELECT id FROM dispatch_depots WHERE id = $1 AND tenant_id = $2`,
      [depotId, tenantId],
    );
    if (!ok.rows[0]) {
      const err = new Error("Depot not found");
      err.status = 404;
      throw err;
    }
  }
  const rates = parseRateBody(body || {});
  const existing = await dbQuery(
    depotId
      ? `SELECT id FROM dispatch_cost_rates WHERE tenant_id = $1 AND depot_id = $2 LIMIT 1`
      : `SELECT id FROM dispatch_cost_rates WHERE tenant_id = $1 AND depot_id IS NULL LIMIT 1`,
    depotId ? [tenantId, depotId] : [tenantId],
  );
  let row;
  if (existing.rows[0]) {
    const updated = await dbQuery(
      `UPDATE dispatch_cost_rates
       SET rate_km = $2, rate_stop = $3, rate_hour = $4, fixed_trip = $5, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [existing.rows[0].id, rates.rateKm, rates.rateStop, rates.rateHour, rates.fixedTrip],
    );
    row = updated.rows[0];
  } else {
    const inserted = await dbQuery(
      `INSERT INTO dispatch_cost_rates (tenant_id, depot_id, rate_km, rate_stop, rate_hour, fixed_trip)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [tenantId, depotId, rates.rateKm, rates.rateStop, rates.rateHour, rates.fixedTrip],
    );
    row = inserted.rows[0];
  }
  return publicCostRates(row);
}

async function countJobStops(jobId) {
  const rows = await dbQuery(
    `SELECT COUNT(*)::int AS n FROM dispatch_stops WHERE job_id = $1`,
    [jobId],
  );
  return Number(rows.rows[0]?.n) || 0;
}

async function sumJobGoodsMoney(tenantId, jobId) {
  const rows = await dbQuery(
    `SELECT
       COALESCE(SUM(o.goods_subtotal), 0) AS sell,
       COALESCE(SUM(o.goods_cost_subtotal), 0) AS cost
     FROM dispatch_orders o
     WHERE o.tenant_id = $1 AND o.job_id = $2`,
    [tenantId, jobId],
  );
  const sell = Number(rows.rows[0]?.sell) || 0;
  const cost = Number(rows.rows[0]?.cost) || 0;
  return {
    goodsSubtotal: sell > 0 ? moneyIdr(sell) : null,
    goodsCostSubtotal: cost > 0 ? moneyIdr(cost) : null,
  };
}

/**
 * Persist planned km/duration and opex_estimate on a job.
 * @param {{ distanceKm?: number, durationSec?: number, depotId?: string|null, stopCount?: number }} metrics
 */
export async function refreshJobOpexEstimate(tenantId, jobId, metrics = {}) {
  const job = await dbQuery(`SELECT * FROM dispatch_jobs WHERE id = $1 AND tenant_id = $2`, [
    jobId,
    tenantId,
  ]);
  if (!job.rows[0]) return null;

  let depotId = metrics.depotId || null;
  if (!depotId) {
    depotId = await resolveSourceDepotId(tenantId, {
      job: job.rows[0],
    });
  }
  const rates = await getEffectiveRates(tenantId, depotId);
  const distanceKm =
    metrics.distanceKm != null
      ? Number(metrics.distanceKm)
      : job.rows[0].planned_distance_km != null
        ? Number(job.rows[0].planned_distance_km)
        : 0;
  const durationSec =
    metrics.durationSec != null
      ? Number(metrics.durationSec)
      : job.rows[0].planned_duration_sec != null
        ? Number(job.rows[0].planned_duration_sec)
        : 0;
  const stopCount =
    metrics.stopCount != null ? Number(metrics.stopCount) : await countJobStops(jobId);

  const opex = computeOperatingCost({
    distanceKm,
    stopCount,
    durationSec,
    rateKm: rates.rateKm,
    rateStop: rates.rateStop,
    rateHour: rates.rateHour,
    fixedTrip: rates.fixedTrip,
  });

  const updated = await dbQuery(
    `UPDATE dispatch_jobs
     SET planned_distance_km = $3,
         planned_duration_sec = $4,
         opex_estimate = $5,
         opex_depot_id = $6,
         updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [jobId, tenantId, distanceKm, durationSec, opex, depotId],
  );
  return {
    job: updated.rows[0],
    opexEstimate: opex,
    rates,
    distanceKm,
    durationSec,
    stopCount,
  };
}

/** After job done: actual duration from timestamps; distance defaults to planned. */
export async function refreshJobOpexActual(tenantId, jobId) {
  const job = await dbQuery(`SELECT * FROM dispatch_jobs WHERE id = $1 AND tenant_id = $2`, [
    jobId,
    tenantId,
  ]);
  const row = job.rows[0];
  if (!row) return null;

  const depotId = row.opex_depot_id || (await resolveSourceDepotId(tenantId, { job: row }));
  const rates = await getEffectiveRates(tenantId, depotId);
  const stopCount = await countJobStops(jobId);

  let actualDurationSec = row.actual_duration_sec;
  if (row.started_at && row.completed_at) {
    const ms = new Date(row.completed_at).getTime() - new Date(row.started_at).getTime();
    if (Number.isFinite(ms) && ms > 0) actualDurationSec = Math.round(ms / 1000);
  }
  const actualDistanceKm =
    row.actual_distance_km != null
      ? Number(row.actual_distance_km)
      : row.planned_distance_km != null
        ? Number(row.planned_distance_km)
        : 0;

  const opex = computeOperatingCost({
    distanceKm: actualDistanceKm,
    stopCount,
    durationSec: actualDurationSec || 0,
    rateKm: rates.rateKm,
    rateStop: rates.rateStop,
    rateHour: rates.rateHour,
    fixedTrip: rates.fixedTrip,
  });

  const updated = await dbQuery(
    `UPDATE dispatch_jobs
     SET actual_distance_km = $3,
         actual_duration_sec = $4,
         opex_actual = $5,
         opex_depot_id = COALESCE(opex_depot_id, $6),
         updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [jobId, tenantId, actualDistanceKm, actualDurationSec, opex, depotId],
  );

  const goods = await sumJobGoodsMoney(tenantId, jobId);
  const opexForMargin = opex;
  return {
    job: updated.rows[0],
    opexActual: opex,
    opexEstimate: row.opex_estimate == null ? null : Number(row.opex_estimate),
    margin: contributionMargin({
      goodsSubtotal: goods.goodsSubtotal,
      goodsCostSubtotal: goods.goodsCostSubtotal,
      opex: opexForMargin,
    }),
    goods,
    rates,
  };
}
