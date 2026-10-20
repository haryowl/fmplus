/**
 * Dispatch Live Monitoring snapshot builder.
 */
import { dbQuery } from "./db.mjs";
import { fetchVehiclePositions } from "./vehicle-positions.mjs";
import { buildRouteForPoints } from "./route-plan-api.mjs";
import { buildStopRouteMeta, parseClockToMinutes } from "./stop-route-meta.mjs";
import { haversineKm } from "./route-optimize.mjs";
import { enrichLiveSnapshot } from "./dispatch-recovery.mjs";
import {
  liveDriverCurrentStatus,
  markJobDoneIfNoOpenStops,
  shouldAutoCompleteJob,
} from "./dispatch-job-complete.mjs";
import { latestPingsByFieldUser, pingTrailForServiceDate } from "./driver-pings.mjs";
import { dateForDayIndex, dayIndexForDate, spanDayCount } from "./dispatch-span.mjs";
import {
  formatClockAt as formatTimeWib,
  formatServiceDate,
  hmToMin,
  nowClockHm as nowHmJakarta,
  todayServiceDate as todayYmdJakarta,
} from "./service-day.mjs";
import { contributionMargin, moneyIdr } from "./dispatch-opex.mjs";
import { tallyVisitOutcomes } from "./dispatch-sales.mjs";
import { deviceIdsInGroups } from "./tracker-device-groups.mjs";
import {
  armadaUserIdsInDeviceGroups,
  lastFixesByArmadaUserIds,
  lastFixesByDeviceIds,
  telematicsUsesArmada,
  telematicsUsesDevices,
  tenantTelematicsSource,
} from "./tracker-devices.mjs";

/** Batch goods sell/cost per job for Live money rollup. */
async function goodsMoneyByJob(tenantId, jobIds) {
  /** @type {Map<string, { goodsSubtotal: number|null, goodsCostSubtotal: number|null }>} */
  const map = new Map();
  if (!jobIds.length) return map;
  const rows = await dbQuery(
    `SELECT o.job_id,
            COALESCE(SUM(o.goods_subtotal), 0) AS sell,
            COALESCE(SUM(o.goods_cost_subtotal), 0) AS cost
     FROM dispatch_orders o
     WHERE o.tenant_id = $1 AND o.job_id = ANY($2::uuid[])
     GROUP BY o.job_id`,
    [tenantId, jobIds],
  );
  for (const r of rows.rows) {
    const sell = Number(r.sell) || 0;
    const cost = Number(r.cost) || 0;
    map.set(String(r.job_id), {
      goodsSubtotal: sell > 0 ? moneyIdr(sell) : null,
      goodsCostSubtotal: cost > 0 ? moneyIdr(cost) : null,
    });
  }
  return map;
}

export function jobLiveMoney(jobRow, goods = {}) {
  const goodsSubtotal =
    goods.goodsSubtotal != null && Number.isFinite(Number(goods.goodsSubtotal))
      ? moneyIdr(goods.goodsSubtotal)
      : null;
  const goodsCostSubtotal =
    goods.goodsCostSubtotal != null && Number.isFinite(Number(goods.goodsCostSubtotal))
      ? moneyIdr(goods.goodsCostSubtotal)
      : null;
  const opexEstimate =
    jobRow.opex_estimate == null ? null : moneyIdr(jobRow.opex_estimate);
  const opexActual = jobRow.opex_actual == null ? null : moneyIdr(jobRow.opex_actual);
  const opex = opexActual ?? opexEstimate;
  const fareEstimate =
    jobRow.fare_estimate == null ? null : moneyIdr(jobRow.fare_estimate);
  const fareActual = jobRow.fare_actual == null ? null : moneyIdr(jobRow.fare_actual);
  const fare = fareActual ?? fareEstimate;
  const margin = contributionMargin({
    goodsSubtotal,
    goodsCostSubtotal,
    opex,
  });
  return {
    goodsSubtotal,
    goodsCostSubtotal,
    opexEstimate,
    opexActual,
    opex,
    fareEstimate,
    fareActual,
    fare,
    margin,
  };
}

export function rollupLiveMoney(drivers) {
  let goods = 0;
  let opex = 0;
  let fare = 0;
  let margin = 0;
  let anyGoods = false;
  let anyOpex = false;
  let anyFare = false;
  let anyMargin = false;
  for (const d of drivers || []) {
    if (d.goodsSubtotal != null && Number.isFinite(Number(d.goodsSubtotal))) {
      goods += Number(d.goodsSubtotal);
      anyGoods = true;
    }
    if (d.opex != null && Number.isFinite(Number(d.opex))) {
      opex += Number(d.opex);
      anyOpex = true;
    }
    if (d.fare != null && Number.isFinite(Number(d.fare))) {
      fare += Number(d.fare);
      anyFare = true;
    }
    if (d.margin != null && Number.isFinite(Number(d.margin))) {
      margin += Number(d.margin);
      anyMargin = true;
    }
  }
  return {
    goodsSubtotal: anyGoods ? moneyIdr(goods) : null,
    opex: anyOpex ? moneyIdr(opex) : null,
    fare: anyFare ? moneyIdr(fare) : null,
    margin: anyMargin ? moneyIdr(margin) : null,
  };
}

const DEFAULT_SERVICE_MIN = 8;
/** Phone fixes newer than this win over vehicle telematics. */
const PHONE_FIX_FRESH_SEC = 5 * 60;
/** Direct device fixes older than this yield to Armada (when both exist). */
const DEVICE_FIX_FRESH_SEC = 15 * 60;

function coordOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function initialsFromName(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase();
}

function isStopDelayed(stop, serviceDate, today, nowHm) {
  const st = String(stop.status || "pending").toLowerCase();
  if (st === "done" || st === "skipped") return false;
  if (serviceDate > today) return false;
  if (serviceDate < today) return true;
  const endMin = hmToMin(stop.window_end || stop.windowEnd);
  if (endMin == null) return false;
  const nowMin = hmToMin(nowHm);
  return nowMin != null && nowMin > endMin;
}

function stopUiStatus(stop, delayed, isCurrent) {
  const st = String(stop.status || "pending").toLowerCase();
  if (st === "done") return "delivered";
  if (st === "skipped") return "skipped";
  if (delayed) return "delayed";
  if (st === "arrived" || isCurrent) return "in_transit";
  return "pending";
}

function stopPct(uiStatus) {
  if (uiStatus === "delivered") return 100;
  if (uiStatus === "in_transit") return 45;
  if (uiStatus === "delayed") return 10;
  if (uiStatus === "skipped") return 0;
  return 0;
}

function pickCompleteCoords(stop) {
  const phoneLat = coordOrNull(stop.complete_phone_lat);
  const phoneLon = coordOrNull(stop.complete_phone_lon);
  if (phoneLat != null && phoneLon != null) {
    return { lat: phoneLat, lon: phoneLon, source: "phone" };
  }
  const armLat = coordOrNull(stop.complete_armada_lat);
  const armLon = coordOrNull(stop.complete_armada_lon);
  if (armLat != null && armLon != null) {
    return { lat: armLat, lon: armLon, source: "armada" };
  }
  return { lat: null, lon: null, source: null };
}

/**
 * Choose the position Live should trust.
 *
 * Order: fresh phone → fresh/present direct device → Armada → stale phone.
 * Armada usersstatus often has no usable age, so a timed device fix wins when present.
 *
 * @param {object|null|undefined} phonePos
 * @param {object|null|undefined} armadaPos
 * @param {object|null|undefined} [devicePos]
 * @param {number} [freshSec]
 * @returns {{ lat: number, lon: number, source: "phone"|"device"|"armada", recordedAt: string|null,
 *   ageSec: number|null, accuracyM: number|null, phoneSeparationKm: number|null } | null}
 */
export function pickLivePosition(
  phonePos,
  armadaPos,
  devicePos = null,
  freshSec = PHONE_FIX_FRESH_SEC,
) {
  const phoneFresh =
    phonePos &&
    phonePos.lat != null &&
    phonePos.lon != null &&
    (phonePos.ageSec == null || phonePos.ageSec <= freshSec);

  const vehicleForSep = devicePos?.lat != null ? devicePos : armadaPos;
  const separationKm =
    phonePos && vehicleForSep && phonePos.lat != null && vehicleForSep.lat != null
      ? Math.round(
          haversineKm(phonePos.lat, phonePos.lon, vehicleForSep.lat, vehicleForSep.lon) * 100,
        ) / 100
      : null;

  if (phoneFresh) {
    return {
      lat: phonePos.lat,
      lon: phonePos.lon,
      source: "phone",
      recordedAt: phonePos.recordedAt || null,
      ageSec: phonePos.ageSec ?? null,
      accuracyM: phonePos.accuracyM ?? null,
      phoneSeparationKm: separationKm,
    };
  }

  const deviceOk =
    devicePos &&
    devicePos.lat != null &&
    devicePos.lon != null &&
    (devicePos.ageSec == null || devicePos.ageSec <= DEVICE_FIX_FRESH_SEC);
  if (deviceOk) {
    return {
      lat: devicePos.lat,
      lon: devicePos.lon,
      source: "device",
      recordedAt: devicePos.recordedAt || null,
      ageSec: devicePos.ageSec ?? null,
      accuracyM: devicePos.accuracyM ?? null,
      phoneSeparationKm: separationKm,
    };
  }

  if (armadaPos && armadaPos.lat != null && armadaPos.lon != null) {
    return {
      lat: armadaPos.lat,
      lon: armadaPos.lon,
      source: "armada",
      recordedAt: armadaPos.recordedAt || null,
      ageSec: armadaPos.ageSec ?? null,
      accuracyM: null,
      phoneSeparationKm: separationKm,
    };
  }

  // Stale device still beats nothing when Armada is absent.
  if (devicePos && devicePos.lat != null && devicePos.lon != null) {
    return {
      lat: devicePos.lat,
      lon: devicePos.lon,
      source: "device",
      recordedAt: devicePos.recordedAt || null,
      ageSec: devicePos.ageSec ?? null,
      accuracyM: devicePos.accuracyM ?? null,
      phoneSeparationKm: separationKm,
    };
  }

  // A stale phone still beats nothing — the age tells the dispatcher how much to
  // trust it, and stuck detection reads the same age.
  if (phonePos && phonePos.lat != null && phonePos.lon != null) {
    return {
      lat: phonePos.lat,
      lon: phonePos.lon,
      source: "phone",
      recordedAt: phonePos.recordedAt || null,
      ageSec: phonePos.ageSec ?? null,
      accuracyM: phonePos.accuracyM ?? null,
      phoneSeparationKm: separationKm,
    };
  }
  return null;
}

/** Thin a lat/lon polyline for map payloads. */
export function downsampleLatLon(points, maxPoints = 400) {
  if (!Array.isArray(points) || points.length <= maxPoints) return points || [];
  if (maxPoints < 2) return points.slice(0, 1);
  const step = (points.length - 1) / (maxPoints - 1);
  const out = [];
  for (let i = 0; i < maxPoints; i++) {
    const p = points[Math.round(i * step)];
    if (p) out.push(p);
  }
  return out;
}

/**
 * Clip timed {lat,lon,recordedAt} samples to [startIso, endIso] (end defaults to now).
 * Mirrors src/lib/dispatchTrackClip.ts for server-side phone trails.
 */
export function clipTimedTrailToWindow(points, startIso, endIso, nowMs = Date.now()) {
  if (!Array.isArray(points) || !points.length) return [];
  const startMs = startIso ? Date.parse(startIso) : NaN;
  const endMs = endIso ? Date.parse(endIso) : NaN;
  const from = Number.isFinite(startMs) ? startMs : -Infinity;
  const to = Number.isFinite(endMs) ? endMs : nowMs;
  const out = [];
  for (const p of points) {
    const t = Date.parse(p.recordedAt);
    if (!Number.isFinite(t)) continue;
    if (t < from || t > to) continue;
    const pt = asMapPoint(p.lat, p.lon);
    if (pt) out.push(pt);
  }
  if (out.length >= 1) return out;
  // Same fallback as the Armada client clip: a missed window (clock skew,
  // startedAt after the last ping) must not hide a known day trail.
  const raw = points.map((p) => asMapPoint(p.lat, p.lon)).filter(Boolean);
  if (raw.length >= 2) return raw;
  return out;
}

function asMapPoint(lat, lon) {
  const a = Number(lat);
  const b = Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return [a, b];
}

function distPlanKm(plannedLat, plannedLon, lat, lon) {
  if (plannedLat == null || plannedLon == null || lat == null || lon == null) return null;
  const km = haversineKm(plannedLat, plannedLon, lat, lon);
  return Number.isFinite(km) ? Math.round(km * 1000) / 1000 : null;
}

/**
 * Same planned ETA chain as Jobs sequence (road legs + depot anchors + service minutes).
 * Mutates driver.stops / depot-return fields in place.
 */
async function attachPlannedEtaChain(driver) {
  const hasStart = Boolean(
    driver.routeStart &&
      Number.isFinite(Number(driver.routeStart.lat)) &&
      Number.isFinite(Number(driver.routeStart.lon)),
  );
  const hasEnd = Boolean(
    driver.routeEnd &&
      Number.isFinite(Number(driver.routeEnd.lat)) &&
      Number.isFinite(Number(driver.routeEnd.lon)),
  );

  const customerPts = [];
  for (const s of driver.stops) {
    const lat = coordOrNull(s.plannedLat);
    const lon = coordOrNull(s.plannedLon);
    if (lat == null || lon == null) {
      driver.plannedEtaReady = false;
      driver.plannedGeometry = [];
      return;
    }
    customerPts.push({ lat, lon });
  }

  const points = [
    ...(hasStart
      ? [{ lat: Number(driver.routeStart.lat), lon: Number(driver.routeStart.lon) }]
      : []),
    ...customerPts,
    ...(hasEnd ? [{ lat: Number(driver.routeEnd.lat), lon: Number(driver.routeEnd.lon) }] : []),
  ];
  if (points.length < 2) {
    driver.plannedEtaReady = false;
    driver.plannedGeometry = [];
    return;
  }

  // Fallback plan line (stop chain) until OSRM geometry is available.
  driver.plannedGeometry = downsampleLatLon(
    points.map((p) => [p.lat, p.lon]),
    400,
  );

  try {
    const route = await buildRouteForPoints(points);
    // Prefer Auto-plan / stored Day start over the old hardcoded 08:00 fallback.
    const jobDayStart = parseClockToMinutes(driver.planDayStart);
    const storedDayStart = driver.stops
      .map((s) => parseClockToMinutes(s.storedPlannedEta))
      .find((n) => n != null);
    const windowDayStart = driver.stops
      .map((s) => parseClockToMinutes(s.windowStart))
      .find((n) => n != null);
    const meta = buildStopRouteMeta(
      driver.stops.map((s) => ({
        windowStart: s.windowStart,
        serviceMinutes: s.serviceMinutes,
        dayIndex: s.dayIndex ?? 0,
      })),
      route.legs || [],
      DEFAULT_SERVICE_MIN,
      {
        hasRouteStart: hasStart,
        hasRouteEnd: hasEnd,
        ...(jobDayStart != null
          ? { dayStartMin: jobDayStart }
          : windowDayStart == null && !hasStart && storedDayStart != null
            ? { dayStartMin: storedDayStart }
            : {}),
      },
    );

    driver.plannedDepotDepart = meta.depotDepart;
    driver.plannedDistanceKm = route.distanceKm ?? null;
    driver.plannedDurationSec = route.durationSec ?? null;
    driver.plannedReturnEta = meta.returnLeg?.eta || null;
    driver.plannedReturnLegDistanceKm = meta.returnLeg?.legDistanceKm ?? null;
    driver.plannedReturnLegDurationSec = meta.returnLeg?.legDurationSec ?? null;
    driver.plannedEtaReady = true;
    const geom = [];
    for (const p of route.geometry || []) {
      const pt = Array.isArray(p) ? asMapPoint(p[0], p[1]) : asMapPoint(p?.lat, p?.lon);
      if (pt) geom.push(pt);
    }
    driver.plannedGeometry = downsampleLatLon(geom, 400);

    for (let i = 0; i < driver.stops.length; i++) {
      const m = meta.stops[i];
      if (!m) continue;
      const stored = String(driver.stops[i].storedPlannedEta || "").trim();
      // Keep Auto-plan Day start clock when persisted; only fill gaps from the chain.
      driver.stops[i].plannedEta = stored || m.eta;
      driver.stops[i].plannedLegDistanceKm = m.legDistanceKm;
      driver.stops[i].plannedLegDurationSec = m.legDurationSec;
    }
  } catch {
    driver.plannedEtaReady = false;
    driver.plannedGeometry = driver.plannedGeometry || [];
  }
}

/**
 * @param {{
 *   tenantId: string,
 *   serviceDate: string,
 *   vaultTenant?: { appId?: number, token?: string } | null,
 *   deviceGroupIds?: string[],
 * }} opts
 */
export async function buildDispatchLiveSnapshot(opts) {
  const serviceDate = opts.serviceDate || todayYmdJakarta();
  const today = todayYmdJakarta();
  const nowHm = nowHmJakarta();

  const deviceGroupIds = Array.isArray(opts.deviceGroupIds)
    ? opts.deviceGroupIds.filter((id) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id))
    : [];
  /** @type {Set<number>|null} */
  let groupArmadaIds = null;
  /** @type {string[]} */
  let groupDeviceIds = [];
  if (deviceGroupIds.length) {
    groupDeviceIds = await deviceIdsInGroups(opts.tenantId, deviceGroupIds).catch(() => []);
    const uids = await armadaUserIdsInDeviceGroups(opts.tenantId, deviceGroupIds).catch(() => []);
    if (uids.length) groupArmadaIds = new Set(uids);
  }

  const jobsRes = await dbQuery(
    `SELECT j.*,
            u.username AS assignee_username,
            u.display_name AS assignee_display_name
     FROM dispatch_jobs j
     LEFT JOIN field_users u ON u.id = j.assigned_field_user_id
     WHERE j.tenant_id = $1
       AND $2::date BETWEEN j.service_date AND COALESCE(j.end_date, j.service_date)
       AND j.status IN ('assigned', 'en_route', 'arrived', 'done')
     ORDER BY
       CASE j.status
         WHEN 'en_route' THEN 0
         WHEN 'arrived' THEN 1
         WHEN 'assigned' THEN 2
         WHEN 'done' THEN 3
         ELSE 4
       END,
       lower(coalesce(nullif(u.display_name, ''), nullif(u.username, ''), j.user_display_name, j.title)) ASC,
       j.updated_at DESC
     LIMIT 100`,
    [opts.tenantId, serviceDate],
  );
  if (deviceGroupIds.length) {
    if (!groupDeviceIds.length) {
      // Explicit empty device group → no jobs.
      jobsRes.rows = [];
    } else {
      const deviceSet = new Set(groupDeviceIds.map(String));
      jobsRes.rows = jobsRes.rows.filter((j) => {
        if (j.tracker_device_id && deviceSet.has(String(j.tracker_device_id))) return true;
        const uid = j.armada_user_id != null ? Number(j.armada_user_id) : NaN;
        return groupArmadaIds != null && Number.isInteger(uid) && groupArmadaIds.has(uid);
      });
    }
  }

  const jobIds = jobsRes.rows.map((j) => j.id);
  /** @type {Map<string, any[]>} */
  const stopsByJob = new Map();
  /** @type {Map<string, string>} */
  const orderRefByStop = new Map();
  /** @type {Map<string, number>} */
  const photoCountByStop = new Map();
  const goodsByJob = await goodsMoneyByJob(opts.tenantId, jobIds);

  if (jobIds.length) {
    const stopsRes = await dbQuery(
      `SELECT s.*, o.external_ref AS order_external_ref, o.customer_name AS order_customer_name,
              o.profile AS order_profile, COALESCE(s.visit_outcome, o.visit_outcome) AS visit_outcome
       FROM dispatch_stops s
       LEFT JOIN dispatch_orders o ON o.id = s.order_id
       WHERE s.job_id = ANY($1::uuid[])
       ORDER BY s.job_id, s.sort_order ASC, s.created_at ASC`,
      [jobIds],
    );
    for (const s of stopsRes.rows) {
      const list = stopsByJob.get(s.job_id) || [];
      list.push(s);
      stopsByJob.set(s.job_id, list);
      if (s.order_external_ref) orderRefByStop.set(s.id, String(s.order_external_ref));
    }

    const stopIds = stopsRes.rows.map((s) => s.id);
    if (stopIds.length) {
      const photos = await dbQuery(
        `SELECT stop_id, COUNT(*)::int AS n
         FROM dispatch_stop_photos
         WHERE stop_id = ANY($1::uuid[])
         GROUP BY stop_id`,
        [stopIds],
      );
      for (const p of photos.rows) photoCountByStop.set(p.stop_id, Number(p.n) || 0);
    }
  }

  const telematicsSource = await tenantTelematicsSource(opts.tenantId).catch(() => "both");

  let posMap = new Map();
  if (telematicsUsesArmada(telematicsSource)) {
    try {
      posMap = await fetchVehiclePositions(opts.vaultTenant || {});
    } catch {
      posMap = new Map();
    }
  }

  /** @type {Map<number, object>} */
  let deviceMap = new Map();
  /** @type {Map<string, object>} */
  let deviceByIdMap = new Map();
  if (telematicsUsesDevices(telematicsSource)) {
    try {
      deviceMap = await lastFixesByArmadaUserIds(
        opts.tenantId,
        jobsRes.rows.map((j) => j.armada_user_id).filter((id) => id != null),
      );
    } catch {
      deviceMap = new Map();
    }
    try {
      deviceByIdMap = await lastFixesByDeviceIds(
        opts.tenantId,
        jobsRes.rows.map((j) => j.tracker_device_id).filter(Boolean),
      );
    } catch {
      deviceByIdMap = new Map();
    }
  }

  // Driver phones are the primary source: a job with no Armada vehicle link is
  // still fully trackable, and the handset is usually fresher than telematics.
  let pingMap = new Map();
  try {
    pingMap = await latestPingsByFieldUser(
      opts.tenantId,
      jobsRes.rows.map((j) => j.assigned_field_user_id).filter(Boolean),
    );
  } catch {
    pingMap = new Map();
  }

  /** @type {any[]} */
  const drivers = [];
  /** @type {any[]} */
  const manifest = [];

  let totalStops = 0;
  let delivered = 0;
  let inTransit = 0;
  let pending = 0;
  let delayed = 0;
  let skipped = 0;
  let completionSum = 0;
  let completionN = 0;

  for (const job of jobsRes.rows) {
    const allStops = stopsByJob.get(job.id) || [];
    const jobServiceDate = formatServiceDate(job.service_date) || serviceDate;
    const jobEndDate = formatServiceDate(job.end_date) || jobServiceDate;
    const dayCount = spanDayCount(jobServiceDate, jobEndDate);
    // Which leg of the tour the dispatcher is looking at. Single-day jobs are
    // always day 0, so nothing below changes for them.
    const dayIndex = dayIndexForDate(jobServiceDate, jobEndDate, serviceDate) ?? 0;

    // Live shows one day at a time; work left over from an earlier leg is surfaced
    // separately rather than silently disappearing off the board.
    const rawStops = allStops.filter((s) => (Number(s.day_index) || 0) === dayIndex);
    const carryover = allStops.filter(
      (s) =>
        (Number(s.day_index) || 0) < dayIndex &&
        s.status !== "done" &&
        s.status !== "skipped",
    );

    const currentIdx = rawStops.findIndex(
      (s) => s.status !== "done" && s.status !== "skipped",
    );

    const stopsOut = rawStops.map((s, idx) => {
      const delayedFlag = isStopDelayed(s, serviceDate, today, nowHm);
      const isCurrent =
        currentIdx === idx &&
        (job.status === "en_route" || job.status === "arrived" || s.status === "arrived");
      const uiStatus = stopUiStatus(s, delayedFlag, isCurrent);
      const coords = pickCompleteCoords(s);
      const photos = photoCountByStop.get(s.id) || 0;
      let pod = "no";
      if (photos > 0) pod = "yes";
      else if (s.proof_required === true) pod = "pending";

      const externalRef =
        orderRefByStop.get(s.id) ||
        s.order_external_ref ||
        "";
      const label = s.name || s.order_customer_name || externalRef || `Stop ${idx + 1}`;
      const timeIso = s.completed_at || s.arrived_at || null;
      const plannedLat = coordOrNull(s.lat);
      const plannedLon = coordOrNull(s.lon);
      const phoneLat = coordOrNull(s.complete_phone_lat);
      const phoneLon = coordOrNull(s.complete_phone_lon);
      const vehicleLat = coordOrNull(s.complete_armada_lat);
      const vehicleLon = coordOrNull(s.complete_armada_lon);
      const startPhoneLat = coordOrNull(s.start_phone_lat);
      const startPhoneLon = coordOrNull(s.start_phone_lon);
      const startVehicleLat = coordOrNull(s.start_armada_lat);
      const startVehicleLon = coordOrNull(s.start_armada_lon);

      const row = {
        stopId: s.id,
        jobId: job.id,
        orderId: s.order_id || null,
        externalRef,
        dayIndex: Number(s.day_index) || 0,
        serviceDate: dateForDayIndex(jobServiceDate, s.day_index),
        stopNumber: idx + 1,
        name: label,
        address: s.address || "",
        status: uiStatus,
        stopStatus: s.status || "pending",
        delayed: delayedFlag,
        windowStart: s.window_start || "",
        windowEnd: s.window_end || "",
        role: s.role === "pickup" ? "pickup" : "drop",
        serviceMinutes:
          s.service_minutes == null || s.service_minutes === ""
            ? null
            : Number(s.service_minutes),
        arrivedAt: s.arrived_at || null,
        completedAt: s.completed_at || null,
        /** @deprecated prefer arrivedLabel / completedLabel */
        timeLabel: formatTimeWib(timeIso),
        arrivedLabel: formatTimeWib(s.arrived_at),
        completedLabel: formatTimeWib(s.completed_at),
        lat: coords.lat,
        lon: coords.lon,
        plannedLat,
        plannedLon,
        phoneLat,
        phoneLon,
        vehicleLat,
        vehicleLon,
        startPhoneLat,
        startPhoneLon,
        startVehicleLat,
        startVehicleLon,
        planToPhoneKm: distPlanKm(plannedLat, plannedLon, phoneLat, phoneLon),
        planToVehicleKm: distPlanKm(plannedLat, plannedLon, vehicleLat, vehicleLon),
        plannedEta: null,
        storedPlannedEta: s.planned_eta || null,
        plannedLegDistanceKm: null,
        plannedLegDurationSec: null,
        pod,
        photoCount: photos,
        proofRequired: s.proof_required === true,
        pctComplete: stopPct(uiStatus),
        skipReason: s.skip_reason || "",
        visitOutcome: s.visit_outcome || null,
        orderProfile: s.order_profile || null,
      };
      return row;
    });

    const nonSkipped = stopsOut.filter((s) => s.status !== "skipped");
    const doneCount = stopsOut.filter((s) => s.status === "delivered").length;
    const denom = nonSkipped.length || stopsOut.length || 1;
    const pctComplete = Math.round((doneCount / denom) * 1000) / 10;

    for (const s of stopsOut) {
      totalStops += 1;
      if (s.status === "delivered") delivered += 1;
      else if (s.status === "in_transit") inTransit += 1;
      else if (s.status === "delayed") delayed += 1;
      else if (s.status === "skipped") skipped += 1;
      else pending += 1;
    }
    if (stopsOut.length) {
      completionSum += pctComplete;
      completionN += 1;
    }

    const driverName =
      job.assignee_display_name ||
      job.assignee_username ||
      "Unassigned";
    const uid = job.armada_user_id != null ? Number(job.armada_user_id) : null;
    const trackerDeviceId = job.tracker_device_id ? String(job.tracker_device_id) : null;
    const deviceMeta = trackerDeviceId ? deviceByIdMap.get(trackerDeviceId) : null;
    const vehicleLabel =
      job.user_display_name ||
      job.armada_username ||
      deviceMeta?.label ||
      deviceMeta?.imei ||
      (job.armada_user_id ? `#${job.armada_user_id}` : trackerDeviceId ? "GPS device" : "—");

    const vehiclePos = uid != null && Number.isFinite(uid) ? posMap.get(uid) : null;
    const devicePos =
      deviceMeta ||
      (uid != null && Number.isFinite(uid) ? deviceMap.get(uid) : null) ||
      null;
    const phonePos = job.assigned_field_user_id
      ? pingMap.get(String(job.assigned_field_user_id))
      : null;
    const livePosition = pickLivePosition(phonePos, vehiclePos, devicePos);
    const livePos = livePosition;
    if (shouldAutoCompleteJob(job.status, allStops)) {
      const healed = await markJobDoneIfNoOpenStops(job.id, allStops);
      if (healed) {
        job.status = healed.status;
        job.completed_at = healed.completed_at;
      }
    }

    const currentStop = currentIdx >= 0 ? stopsOut[currentIdx] : null;
    const remainingOpen = stopsOut.filter(
      (s) => s.status !== "delivered" && s.status !== "skipped",
    ).length;

    const lastDone = [...stopsOut].reverse().find((s) => s.completedAt || s.arrivedAt);
    const windowLabel = [
      job.started_at ? formatTimeWib(job.started_at) : "—",
      lastDone?.timeLabel || "—",
    ].join(" – ");

    const pathMode = String(job.route_anchor_mode || "").toLowerCase();
    const routeAnchorMode = pathMode === "map" || pathMode === "sequence" ? pathMode : null;
    const routeStart =
      routeAnchorMode &&
      job.route_start_lat != null &&
      job.route_start_lon != null &&
      Number.isFinite(Number(job.route_start_lat)) &&
      Number.isFinite(Number(job.route_start_lon))
        ? {
            lat: Number(job.route_start_lat),
            lon: Number(job.route_start_lon),
            label: String(job.route_start_label || "Depot / start"),
          }
        : null;
    const routeEnd =
      routeAnchorMode &&
      job.route_end_lat != null &&
      job.route_end_lon != null &&
      Number.isFinite(Number(job.route_end_lat)) &&
      Number.isFinite(Number(job.route_end_lon))
        ? {
            lat: Number(job.route_end_lat),
            lon: Number(job.route_end_lon),
            label: String(job.route_end_label || "Return"),
          }
        : null;

    const driver = {
      jobId: job.id,
      jobTitle: job.title || "",
      jobStatus: job.status,
      serviceDate: jobServiceDate,
      endDate: jobEndDate,
      dayCount,
      dayNumber: dayIndex + 1,
      dayIndex,
      // Stop ids still open on an earlier leg of a multi-day tour.
      carryoverStopIds: carryover.map((s) => s.id),
      // Enough about each to raise an exception without reloading the tour.
      carryoverStops: carryover.map((s) => ({
        stopId: s.id,
        orderId: s.order_id || null,
        name: s.name || s.order_customer_name || orderRefByStop.get(s.id) || "stop",
        externalRef: orderRefByStop.get(s.id) || s.order_external_ref || "",
        dayIndex: Number(s.day_index) || 0,
        serviceDate: dateForDayIndex(jobServiceDate, s.day_index),
        stopStatus: s.status || "pending",
      })),
      assignedFieldUserId: job.assigned_field_user_id || null,
      driverName,
      driverInitials: initialsFromName(driverName),
      vehicleLabel,
      armadaUserId: uid,
      trackerDeviceId,
      // Kept for existing callers (timeline, map markers) that read the flat pair.
      liveLat: livePos?.lat ?? null,
      liveLon: livePos?.lon ?? null,
      livePosition,
      phonePos:
        phonePos && phonePos.lat != null && phonePos.lon != null
          ? {
              lat: phonePos.lat,
              lon: phonePos.lon,
              recordedAt: phonePos.recordedAt || null,
              ageSec: phonePos.ageSec ?? null,
              accuracyM: phonePos.accuracyM ?? null,
            }
          : null,
      vehiclePos:
        vehiclePos && vehiclePos.lat != null && vehiclePos.lon != null
          ? {
              lat: vehiclePos.lat,
              lon: vehiclePos.lon,
              label: vehiclePos.label || "",
            }
          : devicePos && devicePos.lat != null && devicePos.lon != null
            ? {
                lat: devicePos.lat,
                lon: devicePos.lon,
                label: devicePos.label || "",
              }
            : null,
      plannedGeometry: [],
      phoneTrail: [],
      armadaTrack: [],
      pctComplete,
      doneCount,
      stopCount: stopsOut.length,
      currentOrderRef: currentStop?.externalRef || currentStop?.name || "",
      currentStatus: liveDriverCurrentStatus(job.status, currentStop?.status, remainingOpen),
      timeWindowLabel: windowLabel,
      startedAt: job.started_at || null,
      completedAt: job.completed_at || null,
      routeAnchorMode,
      routeStart,
      routeEnd,
      planDayStart: job.plan_day_start || null,
      plannedEtaReady: false,
      plannedDepotDepart: null,
      plannedReturnEta: null,
      plannedReturnLegDistanceKm: null,
      plannedReturnLegDurationSec: null,
      plannedDistanceKm: null,
      plannedDurationSec: null,
      stops: stopsOut,
      ...jobLiveMoney(job, goodsByJob.get(job.id) || {}),
    };
    drivers.push(driver);
  }

  await Promise.all(drivers.map((d) => attachPlannedEtaChain(d)));

  await Promise.all(
    drivers.map(async (d) => {
      if (!d.assignedFieldUserId) {
        d.phoneTrail = [];
        return;
      }
      try {
        const trail = await pingTrailForServiceDate(
          opts.tenantId,
          d.assignedFieldUserId,
          serviceDate,
        );
        const clipped = clipTimedTrailToWindow(
          trail,
          d.startedAt,
          d.completedAt,
        );
        d.phoneTrail = downsampleLatLon(clipped, 400);
      } catch {
        d.phoneTrail = [];
      }
    }),
  );

  for (const driver of drivers) {
    for (const s of driver.stops) {
      if (!s.plannedEta && s.storedPlannedEta) s.plannedEta = s.storedPlannedEta;
      manifest.push({
        ...s,
        driverName: driver.driverName,
        driverInitials: driver.driverInitials,
        vehicleLabel: driver.vehicleLabel,
        jobTitle: driver.jobTitle || "",
        jobStatus: driver.jobStatus,
      });
    }
  }

  const avgCompletion =
    completionN > 0 ? Math.round((completionSum / completionN) * 10) / 10 : 0;
  const activeDrivers = drivers.filter((d) => d.jobStatus !== "done").length;
  const money = rollupLiveMoney(drivers);
  const salesOutcomes = tallyVisitOutcomes(manifest);

  const snapshot = {
    serviceDate,
    updatedAt: new Date().toISOString(),
    timezone: "Asia/Jakarta",
    summary: {
      totalStops,
      driverCount: drivers.length,
      activeDrivers,
      inTransit,
      delivered,
      pending,
      delayed,
      skipped,
      avgCompletion,
      inTransitPct: totalStops > 0 ? Math.round((inTransit / totalStops) * 1000) / 10 : 0,
      goodsSubtotal: money.goodsSubtotal,
      opex: money.opex,
      fare: money.fare,
      margin: money.margin,
      salesOutcomes: salesOutcomes.total > 0 ? salesOutcomes : null,
    },
    drivers,
    manifest,
  };

  return enrichLiveSnapshot(opts.tenantId, snapshot, { persistEtas: true });
}
