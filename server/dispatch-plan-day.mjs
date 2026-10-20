/**
 * POST /api/dispatch/plan-day — CVRP auto-plan (fleet + depot / multi-depot modes).
 * Extracted from dispatch-api to keep the desk router thinner.
 */
import {
  assignVehiclesToDepots,
  normalizeBalanceGoals,
  partitionOrdersByNearestDepot,
  planCvrp,
} from "./cvrp-plan.mjs";
import {
  expandOrdersToPlanTasks,
  isPickupDropOrder,
  pairCrossesDepots,
  parseOrderKind,
  pickupCoord,
} from "./dispatch-pickup-drop.mjs";
import { refreshAndPersistPlannedEtas } from "./dispatch-recovery.mjs";
import {
  jobMatchesDeskMode,
  normalizeDispatchProfile,
  parseOrderProfile,
} from "./dispatch-sales.mjs";
import { recomputeJobSpan } from "./dispatch-span.mjs";
import { refreshJobFareEstimate } from "./dispatch-fare.mjs";
import { refreshJobOpexEstimate } from "./dispatch-opex.mjs";
import { normalizePlateParity } from "./ganjil-genap.mjs";
import { buildRouteForPoints } from "./route-plan-api.mjs";
import { getDistanceMatrix } from "./routing-matrix.mjs";
import { parseRoutingOptions } from "./routing-options.mjs";
import { parseServiceDate, todayServiceDate as todayYmd } from "./service-day.mjs";
import { tenantFromRequest } from "./tenants.mjs";
import { buildTelematicsPosMap, lastFixesByDeviceIds } from "./tracker-devices.mjs";
import { computePlanDayKpis } from "./dispatch-plan-kpis.mjs";

export function rowToPlanOrder(o) {
  const pickupMin =
    o.pickup_service_minutes == null || o.pickup_service_minutes === ""
      ? null
      : Number(o.pickup_service_minutes);
  const svcMin =
    o.service_minutes == null || o.service_minutes === "" ? null : Number(o.service_minutes);
  return {
    id: o.id,
    kind: parseOrderKind(o.kind),
    lat: o.lat == null ? null : Number(o.lat),
    lon: o.lon == null ? null : Number(o.lon),
    pickupLat: o.pickup_lat == null ? null : Number(o.pickup_lat),
    pickupLon: o.pickup_lon == null ? null : Number(o.pickup_lon),
    pickupAddress: o.pickup_address || "",
    pickupZone: o.pickup_zone || "",
    pickupWindowStart: o.pickup_window_start || "",
    pickupWindowEnd: o.pickup_window_end || "",
    pickupServiceMinutes: Number.isFinite(pickupMin) ? pickupMin : null,
    volumeM3: o.volume_m3 == null ? 0 : Number(o.volume_m3) || 0,
    weightKg: o.weight_kg == null ? 0 : Number(o.weight_kg) || 0,
    label: o.customer_name || o.external_ref || o.id,
    zone: o.zone || "",
    windowStart: o.window_start || "",
    windowEnd: o.window_end || "",
    serviceMinutes: Number.isFinite(svcMin) ? svcMin : null,
  };
}

export async function planCvrpOnOrders(orders, vehicles, routing, depotPt, roundtrip, planOpts) {
  const tasks = expandOrdersToPlanTasks(orders);
  const points = depotPt
    ? [{ lat: depotPt.lat, lon: depotPt.lon }, ...tasks.map((t) => ({ lat: t.lat, lon: t.lon }))]
    : tasks.map((t) => ({ lat: t.lat, lon: t.lon }));
  if (points.length > 80) {
    const err = new Error(
      `Too many points for matrix (${points.length}). Cap is 80 (depot + stops).`,
    );
    err.code = "too_many_points";
    throw err;
  }
  if (!tasks.length) {
    return {
      plan: {
        routes: [],
        unassigned: orders.map((o) => ({
          orderId: o.id,
          label: o.label || o.id,
          reason: "no_coords",
        })),
        balanceMoves: 0,
        roundtrip: false,
      },
      engine: "haversine",
      warning: null,
      pointCount: points.length,
    };
  }
  const matrix = await getDistanceMatrix(points, routing);
  const plan = planCvrp({
    orders: tasks,
    vehicles,
    matrixKm: matrix.matrixKm,
    points,
    depotIndex: depotPt ? 0 : null,
    roundtrip: Boolean(depotPt && roundtrip),
    ...planOpts,
  });
  return {
    plan,
    engine: matrix.engine,
    warning: matrix.warning || null,
    pointCount: points.length,
  };
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {object} api — helpers still owned by dispatch-api
 * @returns {Promise<boolean>}
 */
export async function handlePlanDayPost(req, res, api) {
  const {
    dbTenant,
    json,
    readJson,
    dbQuery,
    numOrNull,
    parseDepotPathMode,
    parseOpenStartMode,
    listDepotsForTenant,
    syncTenantDefaultDepot,
    zoneDepotMapRecord,
    enrichRouteWithAnchors,
    capacityFrom,
    insertStopLeg,
    loadJob,
    loadStops,
    publicJobWithLines,
    saveJobRouteAnchors,
    reorderJobStopsRoad,
    geometryPointsFromStopsAndAnchors,
    requirePlanPrivilege,
  } = api;

    const planStartedAtMs = Date.now();
    const body = await readJson(req);
    const serviceDate = parseServiceDate(body.serviceDate) || todayYmd();
    const fleetMode = String(body.fleetMode || "both").toLowerCase();
    if (!["jobs", "presets", "both"].includes(fleetMode)) {
      json(res, 400, { error: "fleetMode must be jobs | presets | both" });
      return true;
    }
    const depotMode = String(body.depotMode || "open").toLowerCase();
    if (!["open", "depot", "multi"].includes(depotMode)) {
      json(res, 400, { error: "depotMode must be open | depot | multi" });
      return true;
    }
    const depotPathMode = parseDepotPathMode(body.depotPathMode ?? body.pathMode);
    const openStartMode = parseOpenStartMode(body.openStartMode);
    const apply = body.apply === true;
    if (typeof requirePlanPrivilege === "function") {
      if (!(await requirePlanPrivilege(apply))) return true;
    }
    const roundtrip = body.roundtrip === true;
    const onlyEmptyJobs = body.onlyEmptyJobs === true;
    const selectedJobIds = Array.isArray(body.jobIds)
      ? [
          ...new Set(
            body.jobIds
              .map((id) => String(id || "").trim())
              .filter((id) => /^[0-9a-f-]{36}$/i.test(id)),
          ),
        ].slice(0, 50)
      : [];
    let routing = parseRoutingOptions({
      routing: {
        ...(body.routing && typeof body.routing === "object" ? body.routing : {}),
        serviceDate,
        dayStart: body.dayStart || null,
        ...(body.plateParity != null ? { plateParity: body.plateParity } : {}),
        ...(body.respectGanjilGenap != null
          ? { respectGanjilGenap: body.respectGanjilGenap }
          : {}),
      },
    });
    const twMode = String(body.twMode || "soft").toLowerCase();
    if (!["off", "soft", "hard"].includes(twMode)) {
      json(res, 400, { error: "twMode must be off | soft | hard" });
      return true;
    }
    const serviceMinutes = Math.max(
      0,
      Math.min(120, Number(body.serviceMinutes) || 8),
    );
    const maxStopsPerVehicle = Math.max(0, Math.floor(Number(body.maxStopsPerVehicle) || 0));
    const preferZoneDepot = body.preferZoneDepot === true;
    const preferSameZone = body.preferSameZone === true;
    let multiTripMode = String(body.multiTripMode || "off").toLowerCase();
    if (!["off", "max2", "unlimited"].includes(multiTripMode)) multiTripMode = "off";
    // Multi-trip only for depot / multi (needs return-to-reload).
    if (depotMode === "open") multiTripMode = "off";
    const reloadMinutes = Math.max(0, Math.min(120, Number(body.reloadMinutes) || 15));
    const balanceGoals = normalizeBalanceGoals(
      Object.prototype.hasOwnProperty.call(body, "balanceGoals")
        ? body.balanceGoals
        : undefined,
    );
    const improvePass = body.improvePass === true;
    let dayStartMin = 8 * 60;
    if (body.dayStart) {
      const parsed = String(body.dayStart).trim();
      // Browsers often send HH:MM:SS from <input type="time">.
      const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(parsed);
      if (m) dayStartMin = Number(m[1]) * 60 + Number(m[2]);
    } else if (body.dayStartMin != null && Number.isFinite(Number(body.dayStartMin))) {
      dayStartMin = Number(body.dayStartMin);
    }
    let dayEndMin = 18 * 60;
    if (body.dayEnd) {
      const parsed = String(body.dayEnd).trim();
      const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(parsed);
      if (m) dayEndMin = Number(m[1]) * 60 + Number(m[2]);
    } else if (body.dayEndMin != null && Number.isFinite(Number(body.dayEndMin))) {
      dayEndMin = Number(body.dayEndMin);
    }
    if (dayEndMin <= dayStartMin) dayEndMin = dayStartMin + 8 * 60;
    let depotLat = numOrNull(body.depotLat ?? body.depot?.lat);
    let depotLon = numOrNull(body.depotLon ?? body.depot?.lon);
    if (depotMode === "depot" && (depotLat == null || depotLon == null)) {
      const saved = await dbQuery(
        `SELECT dispatch_depot_lat, dispatch_depot_lon FROM tenants WHERE id = $1`,
        [dbTenant.id],
      );
      const s = saved.rows[0] || {};
      if (depotLat == null && s.dispatch_depot_lat != null) depotLat = Number(s.dispatch_depot_lat);
      if (depotLon == null && s.dispatch_depot_lon != null) depotLon = Number(s.dispatch_depot_lon);
    }
    if (depotMode === "depot") {
      if (
        depotLat == null ||
        depotLon == null ||
        Math.abs(depotLat) > 90 ||
        Math.abs(depotLon) > 180
      ) {
        json(res, 400, {
          error: "depotMode=depot requires depot lat/lon (body or saved tenant depot)",
        });
        return true;
      }
    }

    /** @type {{ id: string, name: string, lat: number, lon: number, isDefault?: boolean }[]} */
    let multiDepots = [];
    /** Explicit depot filter; empty means all saved depots. */
    let selectedPlanDepotIds = [];
    if (depotMode === "multi") {
      const all = await listDepotsForTenant(dbTenant.id);
      selectedPlanDepotIds = Array.isArray(body.depotIds)
        ? [
            ...new Set(
              body.depotIds
                .map((id) => String(id || "").trim())
                .filter((id) => /^[0-9a-f-]{36}$/i.test(id)),
            ),
          ].slice(0, 50)
        : [];
      // Empty / omitted → all saved depots (previous default).
      multiDepots = selectedPlanDepotIds.length
        ? all.filter((d) => selectedPlanDepotIds.includes(String(d.id)))
        : all;
      if (!multiDepots.length) {
        json(res, 400, {
          error: selectedPlanDepotIds.length
            ? "No matching depots for the selected depotIds"
            : "depotMode=multi requires at least one saved depot (add depots first)",
        });
        return true;
      }
    }

    const persistDepot = body.persistDepot === true && depotMode === "depot";
    if (persistDepot && depotLat != null && depotLon != null) {
      await syncTenantDefaultDepot(dbTenant.id, depotLat, depotLon);
      const existing = await dbQuery(
        `SELECT id FROM dispatch_depots WHERE tenant_id = $1 AND is_default = true LIMIT 1`,
        [dbTenant.id],
      );
      if (existing.rows[0]) {
        await dbQuery(
          `UPDATE dispatch_depots SET lat = $1, lon = $2, updated_at = now() WHERE id = $3`,
          [depotLat, depotLon, existing.rows[0].id],
        );
      } else {
        await dbQuery(
          `INSERT INTO dispatch_depots (tenant_id, name, lat, lon, is_default)
           VALUES ($1, 'Default', $2, $3, true)`,
          [dbTenant.id, depotLat, depotLon],
        );
      }
    }

    const planProfile = parseOrderProfile(body.profile || body.deskMode);
    const orderRows = await dbQuery(
      `SELECT * FROM dispatch_orders
       WHERE tenant_id = $1 AND status = 'pending' AND service_date = $2::date
       ORDER BY created_at ASC
       LIMIT 200`,
      [dbTenant.id, serviceDate],
    );
    const orders = [];
    const skipped = [];
    for (const o of orderRows.rows) {
      if (planProfile && normalizeDispatchProfile(o.profile) !== planProfile) {
        skipped.push({ orderId: o.id, reason: "profile_mismatch" });
        continue;
      }
      const planOrder = rowToPlanOrder(o);
      const dropOk =
        planOrder.lat != null &&
        planOrder.lon != null &&
        Number.isFinite(planOrder.lat) &&
        Number.isFinite(planOrder.lon);
      if (!dropOk) {
        skipped.push({ orderId: o.id, reason: "no_coords" });
        continue;
      }
      if (isPickupDropOrder(planOrder)) {
        const p = pickupCoord(planOrder);
        if (!p) {
          skipped.push({ orderId: o.id, reason: "no_coords" });
          continue;
        }
        if (depotMode === "open") {
          skipped.push({ orderId: o.id, reason: "pair_requires_depot" });
          continue;
        }
      }
      orders.push(planOrder);
    }
    if (depotMode === "multi" && multiDepots.length) {
      for (let i = orders.length - 1; i >= 0; i--) {
        if (pairCrossesDepots(orders[i], multiDepots, {})) {
          skipped.push({ orderId: orders[i].id, reason: "cross_depot_pair" });
          orders.splice(i, 1);
        }
      }
    }
    if (!orders.length) {
      json(res, 400, {
        error: "No pending orders with coordinates for this date",
        skipped,
      });
      return true;
    }

    /** @type {{ key: string, label: string, volumeCapacityM3: number, weightCapacityKg: number, meta: object }[]} */
    const vehicles = [];
    const usedArmada = new Set();
    const usedDevices = new Set();

    if (fleetMode === "jobs" || fleetMode === "both") {
      const jobParams = [dbTenant.id, serviceDate];
      let jobSql = `SELECT * FROM dispatch_jobs
         WHERE tenant_id = $1 AND service_date = $2::date
           AND status NOT IN ('done', 'cancelled')`;
      if (selectedJobIds.length) {
        jobParams.push(selectedJobIds);
        jobSql += ` AND id = ANY($${jobParams.length}::uuid[])`;
      } else {
        // Default pool: draft jobs not yet assigned to a field driver.
        // (Avoids leftover assigned/en_route jobs and capacity-preset bleed.)
        jobSql += ` AND status = 'draft' AND assigned_field_user_id IS NULL`;
      }
      jobSql += ` ORDER BY created_at ASC LIMIT 50`;
      const jobs = await dbQuery(jobSql, jobParams);
      const plateByArmada = new Map();
      const plateByDevice = new Map();
      {
        const caps = await dbQuery(
          `SELECT armada_user_id, tracker_device_id, plate_parity
           FROM vehicle_capacities WHERE tenant_id = $1`,
          [dbTenant.id],
        );
        for (const r of caps.rows) {
          const parity = normalizePlateParity(r.plate_parity || "unknown");
          if (r.armada_user_id != null) plateByArmada.set(Number(r.armada_user_id), parity);
          if (r.tracker_device_id) plateByDevice.set(String(r.tracker_device_id), parity);
        }
      }
      const usedDevices = new Set();
      for (const j of jobs.rows) {
        const stops = await loadStops(j.id);
        if (planProfile && !jobMatchesDeskMode(j, stops, planProfile)) continue;
        // Prefer empty / light jobs for day planning; still allow jobs with stops (residual capacity)
        const cap = capacityFrom(j, stops);
        const residualVol = Math.max(0, cap.volumeCapacityM3 - cap.volumeUsed);
        const residualWt = Math.max(0, cap.weightCapacityKg - cap.weightUsed);
        if (residualVol <= 0 || residualWt <= 0) continue;
        if (onlyEmptyJobs && stops.length > 0) continue;
        if (j.armada_user_id != null) usedArmada.add(Number(j.armada_user_id));
        const deviceId = j.tracker_device_id ? String(j.tracker_device_id) : null;
        if (deviceId) usedDevices.add(deviceId);
        const uid = j.armada_user_id == null ? null : Number(j.armada_user_id);
        const plateParity =
          (deviceId && plateByDevice.get(deviceId)) ||
          (uid != null ? plateByArmada.get(uid) : null) ||
          "unknown";
        vehicles.push({
          key: `job:${j.id}`,
          label: j.title || j.user_display_name || j.armada_username || j.id,
          volumeCapacityM3: residualVol,
          weightCapacityKg: residualWt,
          meta: {
            kind: "job",
            jobId: j.id,
            armadaUserId: uid,
            trackerDeviceId: deviceId,
            armadaUsername: j.armada_username || "",
            userDisplayName: j.user_display_name || "",
            fullVolumeCapacityM3: cap.volumeCapacityM3,
            fullWeightCapacityKg: cap.weightCapacityKg,
            existingStops: stops.length,
            plateParity,
          },
        });
      }
    }

    if (fleetMode === "presets" || fleetMode === "both") {
      // Explicit job selection means "only these jobs" — do not also pull every
      // saved capacity preset (that leaked old vehicles into M1/M2/M3 plans).
      const allowPresets = fleetMode === "presets" || selectedJobIds.length === 0;
      if (allowPresets) {
      const presets = await dbQuery(
        `SELECT armada_user_id, tracker_device_id, volume_capacity_m3, weight_capacity_kg,
                label, depot_id, plate_parity
         FROM vehicle_capacities WHERE tenant_id = $1
         ORDER BY armada_user_id ASC NULLS LAST, tracker_device_id ASC NULLS LAST
         LIMIT 100`,
        [dbTenant.id],
      );
      for (const p of presets.rows) {
        const uid = p.armada_user_id == null ? null : Number(p.armada_user_id);
        const deviceId = p.tracker_device_id ? String(p.tracker_device_id) : null;
        if (fleetMode === "both") {
          if (uid != null && usedArmada.has(uid)) continue;
          if (deviceId && usedDevices.has(deviceId)) continue;
        }
        vehicles.push({
          key: deviceId ? `preset:d:${deviceId}` : `preset:${uid}`,
          label:
            p.label ||
            (deviceId ? `GPS device` : uid != null ? `Vehicle #${uid}` : "Vehicle"),
          volumeCapacityM3: Number(p.volume_capacity_m3) || 12,
          weightCapacityKg: Number(p.weight_capacity_kg) || 1500,
          meta: {
            kind: "preset",
            armadaUserId: uid,
            trackerDeviceId: deviceId,
            armadaUsername: "",
            userDisplayName: p.label || "",
            fullVolumeCapacityM3: Number(p.volume_capacity_m3) || 12,
            fullWeightCapacityKg: Number(p.weight_capacity_kg) || 1500,
            existingStops: 0,
            depotId: p.depot_id || null,
            plateParity: normalizePlateParity(p.plate_parity || "unknown"),
          },
        });
      }
      }
    }

    // Prefer empty / lighter jobs before fuller ones and larger residual capacity
    vehicles.sort(
      (a, b) =>
        (Number(a.meta?.existingStops) || 0) - (Number(b.meta?.existingStops) || 0) ||
        b.volumeCapacityM3 * b.weightCapacityKg - a.volumeCapacityM3 * a.weightCapacityKg,
    );

    // Attach depot from capacity preset when planning from existing jobs
    if (depotMode === "multi") {
      const capRows = await dbQuery(
        `SELECT armada_user_id, tracker_device_id, depot_id FROM vehicle_capacities WHERE tenant_id = $1`,
        [dbTenant.id],
      );
      const depotByArmada = new Map();
      const depotByDevice = new Map();
      for (const r of capRows.rows) {
        if (r.armada_user_id != null) depotByArmada.set(Number(r.armada_user_id), r.depot_id || null);
        if (r.tracker_device_id) depotByDevice.set(String(r.tracker_device_id), r.depot_id || null);
      }
      for (const v of vehicles) {
        if (v.meta?.depotId) continue;
        const deviceId = v.meta?.trackerDeviceId;
        if (deviceId && depotByDevice.has(String(deviceId))) {
          v.meta.depotId = depotByDevice.get(String(deviceId));
          continue;
        }
        const uid = v.meta?.armadaUserId;
        if (uid != null && depotByArmada.has(Number(uid))) {
          v.meta.depotId = depotByArmada.get(Number(uid));
        }
      }
    }

    if (!vehicles.length) {
      json(res, 400, {
        error:
          fleetMode === "jobs"
            ? "No open jobs with residual capacity for this date"
            : "No vehicles available — create open jobs and/or save vehicle capacity presets",
      });
      return true;
    }

    // Fleet plate parity for ganjil–genap (mixed → treat as unknown → avoid when in force)
    {
      const wantRespect =
        routing.respectGanjilGenap ||
        body.respectGanjilGenap === true ||
        vehicles.some((v) => {
          const p = normalizePlateParity(v.meta?.plateParity);
          return p === "odd" || p === "even";
        });
      if (wantRespect) {
        let fleetParity = routing.plateParity;
        if (fleetParity === "unknown") {
          const set = new Set(
            vehicles
              .map((v) => normalizePlateParity(v.meta?.plateParity))
              .filter((p) => p === "odd" || p === "even"),
          );
          if (set.size === 1) fleetParity = [...set][0];
        }
        routing = parseRoutingOptions({
          routing: {
            avoidTolls: routing.avoidTolls,
            avoidMotorways: routing.avoidMotorways,
            avoidFerries: routing.avoidFerries,
            exclude: routing.exclude.filter((c) => c !== "ganjilgenap" && c !== "ganjil_genap"),
            plateParity: fleetParity,
            respectGanjilGenap: true,
            serviceDate,
            dayStart: body.dayStart || null,
          },
        });
      }
    }

    const planOpts = {
      twMode,
      serviceMinutes,
      dayStartMin,
      dayEndMin,
      maxStopsPerVehicle,
      preferSameZone,
      multiTripMode,
      reloadMinutes,
      balanceGoals,
      improvePass,
    };

    /** @type {any[]} */
    let planRoutes = [];
    /** @type {any[]} */
    let planUnassigned = [...skipped];
    let planEngine = "haversine";
    let planWarning = null;
    let planBalanceMoves = 0;
    let planImproveMoves = 0;
    let planRoundtrip = false;
    /** @type {{ lat: number, lon: number } | null} */
    let previewDepot = null;
    /** @type {any[] | null} */
    let previewDepots = null;

    if (depotMode === "multi") {
      /** @type {Record<string, string>} */
      let zoneMap = {};
      if (preferZoneDepot) {
        try {
          zoneMap = await zoneDepotMapRecord(dbTenant.id);
        } catch {
          /* table may not exist yet mid-migrate */
          zoneMap = {};
        }
      }
      const orderClusters = partitionOrdersByNearestDepot(orders, multiDepots, {
        preferZoneDepot,
        zoneDepotMap: zoneMap,
      });
      /** @type {Map<string, { vol: number, wt: number, orderCount: number }>} */
      const demandByDepot = new Map();
      for (const d of multiDepots) {
        const idxs = orderClusters.get(String(d.id)) || [];
        let vol = 0;
        let wt = 0;
        for (const i of idxs) {
          vol += Math.max(0, Number(orders[i].volumeM3) || 0);
          wt += Math.max(0, Number(orders[i].weightKg) || 0);
        }
        demandByDepot.set(String(d.id), { vol, wt, orderCount: idxs.length });
      }
      const vehicleClusters = assignVehiclesToDepots(vehicles, multiDepots, demandByDepot);
      const engines = new Set();
      const warnings = [];

      for (const d of multiDepots) {
        const did = String(d.id);
        const orderIdxs = orderClusters.get(did) || [];
        const vehicleIdxs = vehicleClusters.get(did) || [];
        if (!orderIdxs.length) continue;

        const clusterOrders = orderIdxs.map((i) => orders[i]);
        if (!vehicleIdxs.length) {
          for (const o of clusterOrders) {
            planUnassigned.push({
              orderId: o.id,
              label: o.label || o.id,
              reason: "no_vehicle_at_depot",
              depotId: did,
            });
          }
          continue;
        }

        const clusterVehicles = vehicleIdxs.map((i) => vehicles[i]);
        let planned;
        try {
          planned = await planCvrpOnOrders(
            clusterOrders,
            clusterVehicles,
            routing,
            { lat: d.lat, lon: d.lon },
            roundtrip,
            planOpts,
          );
        } catch (err) {
          if (err?.code === "too_many_points") {
            json(res, 400, {
              error: `Too many points for depot “${d.name}”. Cap is 80 (depot + stops).`,
            });
            return true;
          }
          throw err;
        }
        engines.add(planned.engine);
        if (planned.warning) warnings.push(planned.warning);
        const plan = planned.plan;
        planBalanceMoves += plan.balanceMoves || 0;
        planImproveMoves += plan.improveMoves || 0;
        planRoundtrip = planRoundtrip || plan.roundtrip;
        for (const route of plan.routes) {
          planRoutes.push(
            enrichRouteWithAnchors(
              {
                ...route,
                meta: {
                  ...(route.meta || {}),
                  depotId: did,
                  depotName: d.name,
                  depot: { lat: d.lat, lon: d.lon, label: d.name },
                },
                depotId: did,
                depotName: d.name,
              },
              depotPathMode,
              roundtrip,
              d.name,
            ),
          );
        }
        for (const u of plan.unassigned) {
          planUnassigned.push({ ...u, depotId: did });
        }
      }

      planEngine = engines.has("osrm") ? (engines.size > 1 ? "mixed" : "osrm") : "haversine";
      planWarning = warnings[0] || null;
      previewDepots = multiDepots.map((d) => ({
        id: d.id,
        name: d.name,
        lat: d.lat,
        lon: d.lon,
        orderCount: (orderClusters.get(String(d.id)) || []).length,
        vehicleCount: (vehicleClusters.get(String(d.id)) || []).length,
      }));
    } else if (depotMode === "open" && openStartMode === "vehicle") {
      const vault = tenantFromRequest(req);
      const planUids = vehicles
        .map((v) => Number(v.meta?.armadaUserId))
        .filter((n) => Number.isInteger(n) && n > 0);
      const planDeviceIds = [
        ...new Set(
          vehicles
            .map((v) => String(v.meta?.trackerDeviceId || "").trim())
            .filter((id) => /^[0-9a-f-]{36}$/i.test(id)),
        ),
      ];
      const posMap = await buildTelematicsPosMap(dbTenant.id, vault || {}, {
        armadaUserIds: planUids,
      });
      /** @type {Map<string, { lat: number, lon: number, label?: string }>} */
      let devicePosMap = new Map();
      if (planDeviceIds.length) {
        try {
          const fixes = await lastFixesByDeviceIds(dbTenant.id, planDeviceIds);
          for (const [id, fix] of fixes) {
            if (fix && Number.isFinite(fix.lat) && Number.isFinite(fix.lon)) {
              devicePosMap.set(id, {
                lat: fix.lat,
                lon: fix.lon,
                label: fix.label || fix.imei || "GPS device",
              });
            }
          }
        } catch {
          devicePosMap = new Map();
        }
      }
      /** @type {{ id: string, name: string, lat: number, lon: number }[]} */
      const starts = [];
      /** @type {Map<string, number[]>} */
      const vehicleByStart = new Map();
      for (let vi = 0; vi < vehicles.length; vi++) {
        const v = vehicles[vi];
        const uid = v.meta?.armadaUserId != null ? Number(v.meta.armadaUserId) : null;
        const deviceId = String(v.meta?.trackerDeviceId || "").trim();
        let sid = null;
        let pos = null;
        if (uid != null && Number.isFinite(uid) && uid > 0) {
          pos = posMap.get(uid) || null;
          if (pos) sid = `vehicle:${uid}`;
        }
        if (!pos && /^[0-9a-f-]{36}$/i.test(deviceId)) {
          pos = devicePosMap.get(deviceId) || null;
          if (pos) sid = `vehicle:d:${deviceId}`;
        }
        if (!sid || !pos) continue;
        if (!vehicleByStart.has(sid)) {
          starts.push({
            id: sid,
            name: pos.label || v.label || (uid != null ? `Vehicle #${uid}` : "GPS device"),
            lat: pos.lat,
            lon: pos.lon,
          });
          vehicleByStart.set(sid, []);
        }
        vehicleByStart.get(sid).push(vi);
      }
      if (!starts.length) {
        json(res, 400, {
          error:
            "No vehicle last positions found. Ensure jobs/presets have Armada or GPS device links and live GPS.",
        });
        return true;
      }
      const orderClusters = partitionOrdersByNearestDepot(orders, starts);
      const engines = new Set();
      const warnings = [];
      for (const d of starts) {
        const did = String(d.id);
        const orderIdxs = orderClusters.get(did) || [];
        const vehicleIdxs = vehicleByStart.get(did) || [];
        if (!orderIdxs.length) continue;
        const clusterOrders = orderIdxs.map((i) => orders[i]);
        const clusterVehicles = vehicleIdxs.map((i) => vehicles[i]);
        if (!clusterVehicles.length) {
          for (const o of clusterOrders) {
            planUnassigned.push({
              orderId: o.id,
              label: o.label || o.id,
              reason: "no_vehicle_for_start",
            });
          }
          continue;
        }
        let planned;
        try {
          planned = await planCvrpOnOrders(
            clusterOrders,
            clusterVehicles,
            routing,
            { lat: d.lat, lon: d.lon },
            roundtrip,
            planOpts,
          );
        } catch (err) {
          if (err?.code === "too_many_points") {
            json(res, 400, { error: "Too many points for vehicle start. Cap is 80." });
            return true;
          }
          throw err;
        }
        engines.add(planned.engine);
        if (planned.warning) warnings.push(planned.warning);
        const plan = planned.plan;
        planBalanceMoves += plan.balanceMoves || 0;
        planImproveMoves += plan.improveMoves || 0;
        planRoundtrip = planRoundtrip || plan.roundtrip;
        for (const route of plan.routes) {
          planRoutes.push(
            enrichRouteWithAnchors(
              {
                ...route,
                meta: {
                  ...(route.meta || {}),
                  routeStart: { lat: d.lat, lon: d.lon, label: d.name },
                  depot: { lat: d.lat, lon: d.lon, label: d.name },
                  openStart: "vehicle",
                },
              },
              depotPathMode,
              roundtrip,
              d.name,
            ),
          );
        }
        for (const u of plan.unassigned) planUnassigned.push(u);
      }
      planEngine = engines.has("osrm") ? (engines.size > 1 ? "mixed" : "osrm") : "haversine";
      planWarning =
        warnings[0] ||
        (posMap.size === 0 ? "Could not load Armada vehicle positions" : null);
      previewDepot = null;
    } else {
      const useDepot = depotMode === "depot";
      let planned;
      try {
        planned = await planCvrpOnOrders(
          orders,
          vehicles,
          routing,
          useDepot ? { lat: depotLat, lon: depotLon } : null,
          useDepot && roundtrip,
          planOpts,
        );
      } catch (err) {
        if (err?.code === "too_many_points") {
          json(res, 400, {
            error: "Too many points for matrix. Cap is 80 (depot + stops).",
          });
          return true;
        }
        throw err;
      }
      const plan = planned.plan;
      planRoutes = plan.routes.map((route) =>
        enrichRouteWithAnchors(
          useDepot
            ? {
                ...route,
                meta: {
                  ...(route.meta || {}),
                  depot: { lat: depotLat, lon: depotLon, label: "Depot" },
                  depotName: "Depot",
                },
                depotName: "Depot",
              }
            : route,
          depotPathMode,
          useDepot && roundtrip,
          "Depot",
        ),
      );
      planUnassigned = [...plan.unassigned, ...skipped];
      planEngine = planned.engine;
      planWarning = planned.warning || null;
      planBalanceMoves = plan.balanceMoves || 0;
      planImproveMoves = plan.improveMoves || 0;
      planRoundtrip = plan.roundtrip;
      previewDepot = useDepot ? { lat: depotLat, lon: depotLon } : null;
    }

    const kpis = computePlanDayKpis({
      routes: planRoutes,
      unassigned: planUnassigned,
      orderCount: orders.length,
      balanceMoves: planBalanceMoves,
      startedAtMs: planStartedAtMs,
      endedAtMs: Date.now(),
    });
    console.info("[dispatch/plan-day]", {
      serviceDate,
      apply,
      improvePass,
      engine: planEngine,
      improveMoves: planImproveMoves,
      ...kpis,
    });

    const preview = {
      serviceDate,
      fleetMode,
      depotMode,
      depotPathMode,
      openStartMode: depotMode === "open" ? openStartMode : "none",
      apply: false,
      engine: planEngine,
      warning: planWarning,
      depot: previewDepot,
      depots: previewDepots,
      roundtrip: planRoundtrip,
      balanceMoves: planBalanceMoves,
      improvePass,
      improveMoves: planImproveMoves,
      balanceGoals,
      twMode,
      serviceMinutes,
      dayStartMin,
      dayEndMin,
      maxStopsPerVehicle,
      onlyEmptyJobs,
      preferZoneDepot: depotMode === "multi" ? preferZoneDepot : false,
      preferSameZone,
      multiTripMode,
      reloadMinutes,
      jobIds: selectedJobIds,
      depotIds: selectedPlanDepotIds,
      routing,
      routes: planRoutes,
      unassigned: planUnassigned,
      vehicleCount: vehicles.length,
      orderCount: orders.length,
      kpis,
    };

    if (!apply) {
      json(res, 200, { plan: preview });
      return true;
    }

    // Apply: create jobs for presets / trip 2+, assign orders in planned order
    const applied = [];
    for (const route of planRoutes) {
      const tripIndex = Math.max(1, Math.floor(Number(route.meta?.tripIndex) || 1));
      let jobId = route.meta?.jobId || null;
      // Trip 2+ always gets its own draft job (same vehicle, fresh load after depot return).
      if (tripIndex > 1) {
        jobId = null;
      }
      if (!jobId && (route.meta?.kind === "preset" || tripIndex > 1)) {
        const uid = route.meta?.armadaUserId ?? null;
        const deviceIdRaw = String(route.meta?.trackerDeviceId || "").trim();
        const trackerDeviceId = /^[0-9a-f-]{36}$/i.test(deviceIdRaw) ? deviceIdRaw : null;
        const baseLabel = String(route.meta?.parentKey
          ? route.label.replace(/\s·\s*trip\s+\d+$/i, "")
          : route.label ||
            (uid != null ? `Auto · #${uid}` : trackerDeviceId ? "Auto · GPS device" : "Auto plan")).slice(0, 160);
        const title = (tripIndex > 1 ? `${baseLabel} · trip ${tripIndex}` : baseLabel).slice(0, 200);
        const inserted = await dbQuery(
          `INSERT INTO dispatch_jobs (
             tenant_id, status, title,
             armada_user_id, armada_username, user_display_name, tracker_device_id,
             volume_capacity_m3, weight_capacity_kg, service_date
           ) VALUES ($1,'draft',$2,$3,$4,$5,$6::uuid,$7,$8,$9::date)
           RETURNING id`,
          [
            dbTenant.id,
            title,
            uid,
            route.meta?.armadaUsername || null,
            route.meta?.userDisplayName || baseLabel,
            trackerDeviceId,
            route.meta?.fullVolumeCapacityM3 || route.volumeCapacityM3,
            route.meta?.fullWeightCapacityKg || route.weightCapacityKg,
            serviceDate,
          ],
        );
        jobId = inserted.rows[0].id;
      }
      if (!jobId) continue;

      // Refuse to attach today's plan onto a job from another service date.
      const jobOk = await dbQuery(
        `SELECT id FROM dispatch_jobs
         WHERE id = $1 AND tenant_id = $2 AND service_date = $3::date
           AND status NOT IN ('done', 'cancelled')`,
        [jobId, dbTenant.id, serviceDate],
      );
      if (!jobOk.rows[0]) continue;

      // Assign in route order (pairs emit the same orderId twice with stopRoles).
      let sortBase = (await loadStops(jobId)).length;
      const seenLeg = new Set();
      const roles = Array.isArray(route.stopRoles) ? route.stopRoles : [];
      for (let i = 0; i < route.orderIds.length; i++) {
        const oid = route.orderIds[i];
        const role = roles[i] === "pickup" ? "pickup" : "drop";
        const ord = await dbQuery(
          `SELECT * FROM dispatch_orders
           WHERE id = $1 AND tenant_id = $2 AND status IN ('pending', 'assigned')
             AND service_date = $3::date`,
          [oid, dbTenant.id, serviceDate],
        );
        const o = ord.rows[0];
        if (!o) continue;
        const legKey = `${oid}:${role}`;
        if (seenLeg.has(legKey)) continue;
        const stopId = await insertStopLeg(jobId, o, role, sortBase, 0);
        if (!stopId) continue;
        sortBase += 1;
        seenLeg.add(legKey);
        if (!seenLeg.has(oid)) {
          seenLeg.add(oid);
          await dbQuery(
            `UPDATE dispatch_orders
             SET status = 'assigned', job_id = $1, stop_id = $2, updated_at = now()
             WHERE id = $3`,
            [jobId, stopId, o.id],
          );
        }
      }
      await dbQuery(`UPDATE dispatch_jobs SET updated_at = now() WHERE id = $1`, [jobId]);
      // Auto-plan is single-day, so this normally collapses end_date to NULL.
      await recomputeJobSpan(jobId);
      const startAnchor =
        route.routeStart ||
        (route.meta?.depot &&
        Number.isFinite(Number(route.meta.depot.lat)) &&
        Number.isFinite(Number(route.meta.depot.lon))
          ? {
              lat: Number(route.meta.depot.lat),
              lon: Number(route.meta.depot.lon),
              label: String(route.depotName || route.meta.depot.label || "Depot"),
            }
          : depotMode === "depot" && depotLat != null && depotLon != null
            ? { lat: depotLat, lon: depotLon, label: "Depot" }
            : null);
      const endAnchor =
        route.routeEnd ||
        (planRoundtrip && startAnchor
          ? {
              lat: startAnchor.lat,
              lon: startAnchor.lon,
              label: `Return · ${startAnchor.label}`,
            }
          : null);
      await saveJobRouteAnchors(
        jobId,
        depotPathMode,
        depotPathMode === "calc" ? null : startAnchor,
        depotPathMode === "calc" ? null : endAnchor,
      );
      const routeDepot = startAnchor
        ? { lat: startAnchor.lat, lon: startAnchor.lon }
        : null;
      await reorderJobStopsRoad(jobId, routeDepot, routing);
      const row = await loadJob(dbTenant.id, jobId);
      const stops = await loadStops(jobId);
      const planDayStartHm = (() => {
        const raw = String(body.dayStart || "").trim();
        const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw);
        if (!m) return null;
        return `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`;
      })();
      if (planDayStartHm) {
        await dbQuery(`UPDATE dispatch_jobs SET plan_day_start = $1, updated_at = now() WHERE id = $2`, [
          planDayStartHm,
          jobId,
        ]);
        row.plan_day_start = planDayStartHm;
      }
      await refreshAndPersistPlannedEtas(row, stops, {
        persist: true,
        dayStartMin,
        dayStart: planDayStartHm || body.dayStart || null,
      });
      // Prefer Auto-plan schedule clock (uses Day start) over OSRM recompute defaults.
      const planStops = Array.isArray(route.stops) ? route.stops : [];
      if (planStops.length) {
        const byOrderRole = new Map();
        for (const ps of planStops) {
          const oid = String(ps.orderId || "");
          const role = ps.role === "pickup" ? "pickup" : "drop";
          if (!oid || !ps.arriveAt) continue;
          byOrderRole.set(`${oid}:${role}`, String(ps.arriveAt).slice(0, 5));
        }
        for (const s of stops) {
          const oid = String(s.order_id || "");
          const role = String(s.role || "drop") === "pickup" ? "pickup" : "drop";
          const eta = byOrderRole.get(`${oid}:${role}`);
          if (!eta) continue;
          await dbQuery(`UPDATE dispatch_stops SET planned_eta = $1 WHERE id = $2 AND job_id = $3`, [
            eta,
            s.id,
            jobId,
          ]);
          s.planned_eta = eta;
        }
      }
      const geomPts = geometryPointsFromStopsAndAnchors(
        stops,
        depotPathMode === "calc" ? null : startAnchor,
        depotPathMode === "calc" ? null : endAnchor,
        depotPathMode,
      );
      const routeGeom = await buildRouteForPoints(geomPts, routing);
      await refreshJobOpexEstimate(dbTenant.id, jobId, {
        distanceKm: routeGeom.distanceKm,
        durationSec: routeGeom.durationSec,
        stopCount: stops.length,
      }).catch(() => null);
      await refreshJobFareEstimate(dbTenant.id, jobId, {
        distanceKm: routeGeom.distanceKm,
      }).catch(() => null);
      const jobRow = (await loadJob(dbTenant.id, jobId)) || row;
      applied.push({
        ...route,
        jobId,
        job: await publicJobWithLines(dbTenant.id, jobRow, await loadStops(jobId)),
        route: routeGeom,
      });
    }

    json(res, 200, {
      plan: {
        ...preview,
        apply: true,
        routes: applied,
      },
    });
    return true;
}
