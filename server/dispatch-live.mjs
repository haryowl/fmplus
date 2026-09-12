/**
 * Dispatch Live Monitoring snapshot builder.
 */
import { dbQuery } from "./db.mjs";
import { fetchVehiclePositions } from "./vehicle-positions.mjs";

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

function hmToMin(hm) {
  const m = String(hm || "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h * 60 + min;
}

function coordOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatServiceDate(rowVal) {
  if (!rowVal) return "";
  if (rowVal instanceof Date) return rowVal.toISOString().slice(0, 10);
  return String(rowVal).slice(0, 10);
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

/**
 * @param {{
 *   tenantId: string,
 *   serviceDate: string,
 *   vaultTenant?: { appId?: number, token?: string } | null,
 * }} opts
 */
export async function buildDispatchLiveSnapshot(opts) {
  const serviceDate = opts.serviceDate || todayYmdJakarta();
  const today = todayYmdJakarta();
  const nowHm = nowHmJakarta();

  const jobsRes = await dbQuery(
    `SELECT j.*,
            u.username AS assignee_username,
            u.display_name AS assignee_display_name
     FROM dispatch_jobs j
     LEFT JOIN field_users u ON u.id = j.assigned_field_user_id
     WHERE j.tenant_id = $1
       AND j.service_date = $2::date
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

  const jobIds = jobsRes.rows.map((j) => j.id);
  /** @type {Map<string, any[]>} */
  const stopsByJob = new Map();
  /** @type {Map<string, string>} */
  const orderRefByStop = new Map();
  /** @type {Map<string, number>} */
  const photoCountByStop = new Map();

  if (jobIds.length) {
    const stopsRes = await dbQuery(
      `SELECT s.*, o.external_ref AS order_external_ref, o.customer_name AS order_customer_name
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

  let posMap = new Map();
  try {
    posMap = await fetchVehiclePositions(opts.vaultTenant || {});
  } catch {
    posMap = new Map();
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
    const rawStops = stopsByJob.get(job.id) || [];
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

      const row = {
        stopId: s.id,
        jobId: job.id,
        orderId: s.order_id || null,
        externalRef,
        stopNumber: idx + 1,
        name: label,
        address: s.address || "",
        status: uiStatus,
        stopStatus: s.status || "pending",
        delayed: delayedFlag,
        windowStart: s.window_start || "",
        windowEnd: s.window_end || "",
        arrivedAt: s.arrived_at || null,
        completedAt: s.completed_at || null,
        timeLabel: formatTimeWib(timeIso),
        lat: coords.lat,
        lon: coords.lon,
        plannedLat: coordOrNull(s.lat),
        plannedLon: coordOrNull(s.lon),
        pod,
        photoCount: photos,
        proofRequired: s.proof_required === true,
        pctComplete: stopPct(uiStatus),
        skipReason: s.skip_reason || "",
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
    const vehicleLabel =
      job.user_display_name ||
      job.armada_username ||
      (job.armada_user_id ? `#${job.armada_user_id}` : "—");

    const uid = job.armada_user_id != null ? Number(job.armada_user_id) : null;
    const livePos = uid != null && Number.isFinite(uid) ? posMap.get(uid) : null;
    const currentStop = currentIdx >= 0 ? stopsOut[currentIdx] : null;

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
      serviceDate: formatServiceDate(job.service_date) || serviceDate,
      assignedFieldUserId: job.assigned_field_user_id || null,
      driverName,
      driverInitials: initialsFromName(driverName),
      vehicleLabel,
      armadaUserId: uid,
      liveLat: livePos?.lat ?? null,
      liveLon: livePos?.lon ?? null,
      pctComplete,
      doneCount,
      stopCount: stopsOut.length,
      currentOrderRef: currentStop?.externalRef || currentStop?.name || "",
      currentStatus: currentStop?.status || (job.status === "done" ? "delivered" : "pending"),
      timeWindowLabel: windowLabel,
      startedAt: job.started_at || null,
      completedAt: job.completed_at || null,
      routeAnchorMode,
      routeStart,
      routeEnd,
      stops: stopsOut,
    };
    drivers.push(driver);

    for (const s of stopsOut) {
      manifest.push({
        ...s,
        driverName,
        driverInitials: driver.driverInitials,
        vehicleLabel,
        jobTitle: job.title || "",
        jobStatus: job.status,
      });
    }
  }

  const avgCompletion =
    completionN > 0 ? Math.round((completionSum / completionN) * 10) / 10 : 0;
  const activeDrivers = drivers.filter((d) => d.jobStatus !== "done").length;

  return {
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
    },
    drivers,
    manifest,
  };
}
