/**
 * Light passenger fare v1: distance_km × rate_km + fixed booking fee (IDR).
 * Rates: per-depot with tenant-global fallback.
 */
import { dbQuery } from "./db.mjs";
import { resolveSourceDepotId } from "./dispatch-stock.mjs";

export function moneyIdr(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Math.round(Number(n));
}

export function publicFareRates(row) {
  if (!row) {
    return {
      depotId: null,
      rateKm: 0,
      fixedBooking: 0,
      updatedAt: null,
    };
  }
  return {
    id: row.id,
    depotId: row.depot_id || null,
    depotName: row.depot_name || "",
    rateKm: Number(row.rate_km) || 0,
    fixedBooking: Number(row.fixed_booking) || 0,
    updatedAt: row.updated_at || null,
  };
}

/** fare = km × rate_km + fixed_booking */
export function computePassengerFare({
  distanceKm = 0,
  rateKm = 0,
  fixedBooking = 0,
} = {}) {
  const km = Math.max(0, Number(distanceKm) || 0);
  const total = km * (Number(rateKm) || 0) + (Number(fixedBooking) || 0);
  return moneyIdr(total) ?? 0;
}

export async function listFareRates(tenantId) {
  const rows = await dbQuery(
    `SELECT r.*, d.name AS depot_name
     FROM dispatch_fare_rates r
     LEFT JOIN dispatch_depots d ON d.id = r.depot_id AND d.tenant_id = r.tenant_id
     WHERE r.tenant_id = $1
     ORDER BY r.depot_id NULLS FIRST, lower(d.name) ASC NULLS FIRST`,
    [tenantId],
  );
  return rows.rows.map(publicFareRates);
}

export async function getEffectiveFareRates(tenantId, depotId = null) {
  if (depotId) {
    const depot = await dbQuery(
      `SELECT r.*, d.name AS depot_name
       FROM dispatch_fare_rates r
       LEFT JOIN dispatch_depots d ON d.id = r.depot_id
       WHERE r.tenant_id = $1 AND r.depot_id = $2
       LIMIT 1`,
      [tenantId, depotId],
    );
    if (depot.rows[0]) return publicFareRates(depot.rows[0]);
  }
  const global = await dbQuery(
    `SELECT * FROM dispatch_fare_rates
     WHERE tenant_id = $1 AND depot_id IS NULL
     LIMIT 1`,
    [tenantId],
  );
  return publicFareRates(global.rows[0] || null);
}

function parseFareBody(body) {
  const num = (v, fallback = 0) => {
    if (v == null || v === "") return fallback;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    rateKm: num(body.rateKm ?? body.rate_km),
    fixedBooking: num(body.fixedBooking ?? body.fixed_booking),
  };
}

export async function upsertFareRates(tenantId, body) {
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
  const rates = parseFareBody(body || {});
  const existing = await dbQuery(
    depotId
      ? `SELECT id FROM dispatch_fare_rates WHERE tenant_id = $1 AND depot_id = $2 LIMIT 1`
      : `SELECT id FROM dispatch_fare_rates WHERE tenant_id = $1 AND depot_id IS NULL LIMIT 1`,
    depotId ? [tenantId, depotId] : [tenantId],
  );
  let row;
  if (existing.rows[0]) {
    const updated = await dbQuery(
      `UPDATE dispatch_fare_rates
       SET rate_km = $2, fixed_booking = $3, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [existing.rows[0].id, rates.rateKm, rates.fixedBooking],
    );
    row = updated.rows[0];
  } else {
    const inserted = await dbQuery(
      `INSERT INTO dispatch_fare_rates (tenant_id, depot_id, rate_km, fixed_booking)
       VALUES ($1,$2,$3,$4)
       RETURNING *`,
      [tenantId, depotId, rates.rateKm, rates.fixedBooking],
    );
    row = inserted.rows[0];
  }
  return publicFareRates(row);
}

export async function refreshJobFareEstimate(tenantId, jobId, metrics = {}) {
  const job = await dbQuery(`SELECT * FROM dispatch_jobs WHERE id = $1 AND tenant_id = $2`, [
    jobId,
    tenantId,
  ]);
  if (!job.rows[0]) return null;

  let depotId = metrics.depotId || null;
  if (!depotId) {
    depotId = await resolveSourceDepotId(tenantId, { job: job.rows[0] });
  }
  const rates = await getEffectiveFareRates(tenantId, depotId);
  const distanceKm =
    metrics.distanceKm != null
      ? Number(metrics.distanceKm)
      : job.rows[0].planned_distance_km != null
        ? Number(job.rows[0].planned_distance_km)
        : 0;

  const fare = computePassengerFare({
    distanceKm,
    rateKm: rates.rateKm,
    fixedBooking: rates.fixedBooking,
  });

  const updated = await dbQuery(
    `UPDATE dispatch_jobs
     SET fare_estimate = $3, updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [jobId, tenantId, fare],
  );
  return { job: updated.rows[0], fareEstimate: fare, rates, distanceKm };
}

export async function refreshJobFareActual(tenantId, jobId) {
  const job = await dbQuery(`SELECT * FROM dispatch_jobs WHERE id = $1 AND tenant_id = $2`, [
    jobId,
    tenantId,
  ]);
  const row = job.rows[0];
  if (!row) return null;

  const depotId = row.opex_depot_id || (await resolveSourceDepotId(tenantId, { job: row }));
  const rates = await getEffectiveFareRates(tenantId, depotId);
  const distanceKm =
    row.actual_distance_km != null
      ? Number(row.actual_distance_km)
      : row.planned_distance_km != null
        ? Number(row.planned_distance_km)
        : 0;

  const fare = computePassengerFare({
    distanceKm,
    rateKm: rates.rateKm,
    fixedBooking: rates.fixedBooking,
  });

  const updated = await dbQuery(
    `UPDATE dispatch_jobs
     SET fare_actual = $3, updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [jobId, tenantId, fare],
  );
  return {
    job: updated.rows[0],
    fareActual: fare,
    fareEstimate: row.fare_estimate == null ? null : Number(row.fare_estimate),
    rates,
    distanceKm,
  };
}

/** Map passenger demand onto volume/weight axes used by CVRP. */
export function passengerDemandToCargo({ passengerCount = null, luggageKg = null } = {}) {
  const seats =
    passengerCount != null && Number.isFinite(Number(passengerCount))
      ? Math.max(0, Math.floor(Number(passengerCount)))
      : null;
  const luggage =
    luggageKg != null && Number.isFinite(Number(luggageKg))
      ? Math.max(0, Number(luggageKg))
      : null;
  return {
    volumeM3: seats,
    weightKg: luggage,
    passengerCount: seats,
    luggageKg: luggage,
  };
}

export function passengerCapsToCargo({ seatCapacity = null, luggageCapacityKg = null } = {}) {
  const seatsRaw =
    seatCapacity != null && Number.isFinite(Number(seatCapacity))
      ? Math.max(1, Math.floor(Number(seatCapacity)))
      : 4;
  const luggageRaw =
    luggageCapacityKg != null && Number.isFinite(Number(luggageCapacityKg))
      ? Math.max(1, Number(luggageCapacityKg))
      : 50;
  return {
    volumeCapacityM3: seatsRaw,
    weightCapacityKg: luggageRaw,
    seatCapacity: seatsRaw,
    luggageCapacityKg: luggageRaw,
  };
}
