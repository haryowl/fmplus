/**
 * Phase F+ — Dispatch desk (jobs, orders, capacity, POD photos).
 * GET/POST /api/dispatch/jobs
 * GET/PATCH /api/dispatch/jobs/:id
 * POST /api/dispatch/jobs/:id/assign-orders
 * POST /api/dispatch/jobs/:id/next-trip
 * POST /api/dispatch/jobs/:id/optimize-stops
 * POST /api/dispatch/jobs/:id/stops/:stopId/return
 * GET/POST /api/dispatch/orders
 * POST /api/dispatch/orders/import
 * GET /api/dispatch/live?date=YYYY-MM-DD
 * GET /api/dispatch/phone-trail?fieldUserId=&date= — phone GPS polyline for Live/Board maps
 * PATCH/DELETE /api/dispatch/orders/:id
 * GET /api/dispatch/stops/:stopId/photos
 * GET /api/dispatch/photos/:id
 * GET /api/dispatch/field-users
 * GET/PUT /api/dispatch/vehicle-capacities
 * PUT /api/dispatch/vehicle-capacities/:armadaUserId
 * PUT /api/dispatch/vehicle-capacities/device/:deviceId
 * GET/PUT /api/dispatch/depot
 * GET/POST /api/dispatch/depots · PATCH/DELETE /api/dispatch/depots/:id
 * GET/PUT /api/dispatch/zone-depot-map — optional zone → depot preferences
 * GET /api/dispatch/stock · POST /api/dispatch/stock/adjust · GET …/movements
 * POST /api/dispatch/plan-day — CVRP auto-plan (fleet + depot / multi-depot modes)
 * POST /api/dispatch/replan-remaining — mid-day recovery preview / apply
 * GET  /api/dispatch/ops-exceptions?date=
 * POST /api/dispatch/ops-exceptions/:id/ack
 * GET  /api/dispatch/sla?date=
 */
import crypto from "node:crypto";
import { databaseUrlConfigured, dbQuery } from "./db.mjs";
import { mergeEntitlements, moduleEnabled } from "./entitlements.mjs";
import { fieldFromRequest } from "./field-auth.mjs";
import { resolveDbTenant } from "./maintenance-api.mjs";
import { handlePlanDayPost } from "./dispatch-plan-day.mjs";
import {
  isPickupDropOrder,
  parseOrderKind,
  pickupCoord,
} from "./dispatch-pickup-drop.mjs";
import {
  applyCargoTotals,
  createGoodsItem,
  decorateJobsWithLines,
  decorateOrdersWithLines,
  deleteGoodsItem,
  importGoodsItemsFromRows,
  listGoodsItems,
  replaceOrderLines,
  resolveCsvGoodsLines,
  setCargoTotalsLocked,
  updateGoodsItem,
} from "./dispatch-goods.mjs";
import {
  createCustomer,
  deleteCustomer,
  importCustomersFromRows,
  listCustomers,
  updateCustomer,
} from "./dispatch-customers.mjs";
import {
  adjustDepotStock,
  listRecentStockMovements,
  listStockBalances,
  listTruckStock,
  parseStockSettings,
  resolveSourceDepotId,
  returnTruckStockToDepot,
} from "./dispatch-stock.mjs";
import {
  listCostRates,
  refreshJobOpexActual,
  refreshJobOpexEstimate,
  upsertCostRates,
} from "./dispatch-opex.mjs";
import {
  listFareRates,
  passengerCapsToCargo,
  passengerDemandToCargo,
  refreshJobFareActual,
  refreshJobFareEstimate,
  upsertFareRates,
} from "./dispatch-fare.mjs";
import { parseDispatchProfiles } from "./dispatch-profiles.mjs";
import {
  inferJobProfile,
  jobMatchesDeskMode,
  normalizeDispatchProfile,
  parseOrderProfile,
} from "./dispatch-sales.mjs";
import {
  cargoFromOrderCsvRow,
  orderCsvAllowsGoodsLines,
  pickupFromOrderCsvRow,
  resolveOrderCsvProfile,
} from "./dispatch-order-csv.mjs";
import { normalizeZoneKey } from "./dispatch-zone.mjs";
import { buildRouteForPoints } from "./route-plan-api.mjs";
import { parseRoutingOptions } from "./routing-options.mjs";
import { normalizePlateParity } from "./ganjil-genap.mjs";
import { getObject, objectStorageConfigured, putObject } from "./storage.mjs";
import { securityHeaders } from "./proxy-lt.mjs";
import { tenantFromRequest } from "./tenants.mjs";
import {
  maybeNotifyDispatchJobAssigned,
  maybeNotifyDispatchRouteUpdated,
} from "./dispatch-notify.mjs";
import { jobIsClosed, nextDispatchTripTitle } from "./dispatch-next-trip.mjs";
import { markJobDoneIfNoOpenStops } from "./dispatch-job-complete.mjs";
import {
  addCatalogCode,
  deleteCatalogCode,
  listCodesForTarget,
  lookupCatalogScan,
  syncPrimarySku,
} from "./catalog-codes.mjs";
import { csvBool, csvNum, parseCsv } from "./csv-parse.mjs";
import { buildDispatchLiveSnapshot } from "./dispatch-live.mjs";
import { pingTrailForServiceDate } from "./driver-pings.mjs";
import {
  buildTelematicsPosMap,
  deviceTrailsByArmadaDays,
  telematicsUsesDevices,
  tenantTelematicsSource,
} from "./tracker-devices.mjs";
import {
  addDays,
  dayDiff,
  formatServiceDate,
  parseServiceDate,
  todayServiceDate as todayYmd,
} from "./service-day.mjs";
import {
  clampDayIndex,
  dayIndexForDate,
  MAX_DAY_INDEX,
  recomputeJobSpan,
  spanDayCount,
} from "./dispatch-span.mjs";
import {
  ackOpsException,
  applyReplanSuggestions,
  buildReplanRemainingPreview,
  computeSlaFromSnapshot,
  publicOpsException,
  refreshAndPersistPlannedEtas,
  reorderRemainingStops,
} from "./dispatch-recovery.mjs";

const STATUSES = ["draft", "assigned", "en_route", "arrived", "done", "cancelled"];
const STOP_STATUSES = ["pending", "arrived", "done", "skipped"];
const ORDER_STATUSES = ["pending", "assigned", "cancelled"];

/** How depot/start appears on the road: calc | map | sequence */
function parseDepotPathMode(v) {
  const s = String(v || "sequence")
    .toLowerCase()
    .trim();
  if (s === "calc" || s === "calculation" || s === "calc_only" || s === "none") return "calc";
  if (s === "map") return "map";
  return "sequence";
}

/** Open-tour start: none | vehicle (last GPS) */
function parseOpenStartMode(v) {
  const s = String(v || "none")
    .toLowerCase()
    .trim();
  if (s === "vehicle" || s === "last_position" || s === "gps") return "vehicle";
  return "none";
}

function routeAnchorFromRow(lat, lon, label) {
  if (lat == null || lon == null) return null;
  const a = Number(lat);
  const b = Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return {
    lat: a,
    lon: b,
    label: String(label || "").trim() || "Start",
  };
}

async function saveJobRouteAnchors(jobId, mode, start, end) {
  const m = mode === "map" || mode === "sequence" ? mode : null;
  await dbQuery(
    `UPDATE dispatch_jobs SET
       route_anchor_mode = $1,
       route_start_lat = $2,
       route_start_lon = $3,
       route_start_label = $4,
       route_end_lat = $5,
       route_end_lon = $6,
       route_end_label = $7,
       updated_at = now()
     WHERE id = $8`,
    [
      m,
      start?.lat ?? null,
      start?.lon ?? null,
      start?.label ?? null,
      end?.lat ?? null,
      end?.lon ?? null,
      end?.label ?? null,
      jobId,
    ],
  );
}

/** Build ordered lat/lon points for OSRM draw: optional start + stops + optional end. */
function geometryPointsFromStopsAndAnchors(stops, start, end, pathMode) {
  const customers = [];
  for (const s of stops) {
    if (s.lat == null || s.lon == null) continue;
    const lat = Number(s.lat);
    const lon = Number(s.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    customers.push({ lat, lon });
  }
  if (pathMode !== "map" && pathMode !== "sequence") return customers;
  const out = [];
  if (start && Number.isFinite(start.lat) && Number.isFinite(start.lon)) {
    out.push({ lat: Number(start.lat), lon: Number(start.lon) });
  }
  out.push(...customers);
  if (end && Number.isFinite(end.lat) && Number.isFinite(end.lon)) {
    out.push({ lat: Number(end.lat), lon: Number(end.lon) });
  }
  return out;
}

function enrichRouteWithAnchors(route, pathMode, roundtrip, fallbackLabel = "Depot") {
  const depot = route.meta?.depot;
  const start =
    depot && Number.isFinite(Number(depot.lat)) && Number.isFinite(Number(depot.lon))
      ? {
          lat: Number(depot.lat),
          lon: Number(depot.lon),
          label: String(route.depotName || route.meta?.depotName || depot.label || fallbackLabel),
        }
      : route.meta?.routeStart &&
          Number.isFinite(Number(route.meta.routeStart.lat)) &&
          Number.isFinite(Number(route.meta.routeStart.lon))
        ? {
            lat: Number(route.meta.routeStart.lat),
            lon: Number(route.meta.routeStart.lon),
            label: String(route.meta.routeStart.label || fallbackLabel),
          }
        : null;
  const end =
    start && roundtrip
      ? { lat: start.lat, lon: start.lon, label: `Return · ${start.label}` }
      : null;
  return {
    ...route,
    pathMode,
    routeStart: pathMode === "calc" ? null : start,
    routeEnd: pathMode === "calc" ? null : end,
  };
}

function send(res, status, headers, body) {
  res.writeHead(status, securityHeaders(headers));
  res.end(body);
}

function json(res, status, obj) {
  send(
    res,
    status,
    {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    JSON.stringify(obj),
  );
}

function readBody(req, limit = 512_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("Body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** HH:MM for delivery windows; empty/null clears the column. */
function normalizeWindowClock(v) {
  const m = String(v || "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Dwell minutes at stop; null = use plan default. Clamped 0–120. */
function serviceMinutesOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(120, Math.round(n)));
}

function publicDepot(row) {
  return {
    id: row.id,
    name: row.name || "Depot",
    lat: Number(row.lat),
    lon: Number(row.lon),
    isDefault: Boolean(row.is_default),
    updatedAt: row.updated_at || null,
  };
}

async function syncTenantDefaultDepot(tenantId, lat, lon) {
  await dbQuery(
    `UPDATE tenants SET dispatch_depot_lat = $1, dispatch_depot_lon = $2, updated_at = now()
     WHERE id = $3`,
    [lat, lon, tenantId],
  );
}

async function clearOtherDefaultDepots(tenantId, keepId) {
  await dbQuery(
    `UPDATE dispatch_depots SET is_default = false, updated_at = now()
     WHERE tenant_id = $1 AND id <> $2 AND is_default = true`,
    [tenantId, keepId],
  );
}

async function ensureDefaultDepotFromLegacy(tenantId) {
  const existing = await dbQuery(
    `SELECT id FROM dispatch_depots WHERE tenant_id = $1 LIMIT 1`,
    [tenantId],
  );
  if (existing.rows.length) return;
  const legacy = await dbQuery(
    `SELECT dispatch_depot_lat, dispatch_depot_lon FROM tenants WHERE id = $1`,
    [tenantId],
  );
  const r = legacy.rows[0] || {};
  const lat = r.dispatch_depot_lat == null ? null : Number(r.dispatch_depot_lat);
  const lon = r.dispatch_depot_lon == null ? null : Number(r.dispatch_depot_lon);
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
  await dbQuery(
    `INSERT INTO dispatch_depots (tenant_id, name, lat, lon, is_default)
     VALUES ($1, 'Default', $2, $3, true)`,
    [tenantId, lat, lon],
  );
}

async function listDepotsForTenant(tenantId) {
  await ensureDefaultDepotFromLegacy(tenantId);
  const rows = await dbQuery(
    `SELECT id, name, lat, lon, is_default, updated_at
     FROM dispatch_depots
     WHERE tenant_id = $1
     ORDER BY is_default DESC, name ASC, created_at ASC
     LIMIT 50`,
    [tenantId],
  );
  return rows.rows.map(publicDepot);
}

function publicZoneDepotMapping(row) {
  return {
    zone: row.zone_label || row.zone_key || "",
    zoneKey: row.zone_key || "",
    depotId: String(row.depot_id),
    depotName: row.depot_name || "",
  };
}

async function listZoneDepotMap(tenantId) {
  const rows = await dbQuery(
    `SELECT m.zone_key, m.zone_label, m.depot_id, d.name AS depot_name
     FROM dispatch_zone_depot_map m
     JOIN dispatch_depots d ON d.id = m.depot_id AND d.tenant_id = m.tenant_id
     WHERE m.tenant_id = $1
     ORDER BY m.zone_label ASC, m.zone_key ASC
     LIMIT 200`,
    [tenantId],
  );
  return rows.rows.map(publicZoneDepotMapping);
}

/** @returns {Promise<Record<string, string>>} */
async function zoneDepotMapRecord(tenantId) {
  const list = await listZoneDepotMap(tenantId);
  /** @type {Record<string, string>} */
  const out = {};
  for (const m of list) out[m.zoneKey] = m.depotId;
  return out;
}

/** YYYY-MM-DD or null. */
function coordOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param row dispatch_stops row
 * @param jobServiceDate the job's day 0, used to resolve the stop's calendar date
 */
function publicStop(row, jobServiceDate = "") {
  const dayIndex = Number.isFinite(Number(row.day_index)) ? Number(row.day_index) : 0;
  return {
    id: row.id,
    orderId: row.order_id || null,
    sortOrder: Number(row.sort_order) || 0,
    dayIndex,
    // Resolved so clients never have to redo the offset arithmetic.
    serviceDate: jobServiceDate ? addDays(jobServiceDate, dayIndex) : "",
    name: row.name || "",
    address: row.address || "",
    lat: row.lat == null ? null : Number(row.lat),
    lon: row.lon == null ? null : Number(row.lon),
    notes: row.notes || "",
    zone: row.zone || "",
    volumeM3: row.volume_m3 == null ? null : Number(row.volume_m3),
    weightKg: row.weight_kg == null ? null : Number(row.weight_kg),
    windowStart: row.window_start || "",
    windowEnd: row.window_end || "",
    serviceMinutes: row.service_minutes == null ? null : Number(row.service_minutes),
    proofRequired: row.proof_required === true,
    status: row.status || "pending",
    arrivedAt: row.arrived_at || null,
    completedAt: row.completed_at || null,
    startPhoneLat: coordOrNull(row.start_phone_lat),
    startPhoneLon: coordOrNull(row.start_phone_lon),
    startArmadaLat: coordOrNull(row.start_armada_lat),
    startArmadaLon: coordOrNull(row.start_armada_lon),
    completePhoneLat: coordOrNull(row.complete_phone_lat),
    completePhoneLon: coordOrNull(row.complete_phone_lon),
    completeArmadaLat: coordOrNull(row.complete_armada_lat),
    completeArmadaLon: coordOrNull(row.complete_armada_lon),
    skipReason: row.skip_reason || "",
    rescheduledTo: formatServiceDate(row.rescheduled_to) || null,
    plannedEta: row.planned_eta || "",
    role: row.role === "pickup" ? "pickup" : "drop",
    visitOutcome: row.visit_outcome || null,
    orderProfile: parseOrderProfile(row.order_profile || row.profile) || null,
  };
}

function intOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function capacityFrom(row, stops) {
  const seatCapacity =
    row.seat_capacity != null && Number.isFinite(Number(row.seat_capacity))
      ? Math.max(1, Math.floor(Number(row.seat_capacity)))
      : null;
  const luggageCapacityKg =
    row.luggage_capacity_kg != null && Number.isFinite(Number(row.luggage_capacity_kg))
      ? Math.max(0, Number(row.luggage_capacity_kg))
      : null;
  const volumeCapacityM3 =
    seatCapacity != null
      ? seatCapacity
      : row.volume_capacity_m3 == null
        ? 12
        : Number(row.volume_capacity_m3) || 12;
  const weightCapacityKg =
    luggageCapacityKg != null
      ? luggageCapacityKg
      : row.weight_capacity_kg == null
        ? 1500
        : Number(row.weight_capacity_kg) || 1500;
  let volumeUsed = 0;
  let weightUsed = 0;
  // Pair drop legs store cargo too — count pickup (or drop-only) once.
  const seenPair = new Set();
  for (const s of stops) {
    const role = s.role || s.Role || "drop";
    const oid = s.order_id || s.orderId || "";
    if (role === "drop" && oid && seenPair.has(oid)) continue;
    if (role === "pickup" && oid) seenPair.add(oid);
    if (s.volume_m3 != null) volumeUsed += Number(s.volume_m3) || 0;
    else if (s.volumeM3 != null) volumeUsed += Number(s.volumeM3) || 0;
    if (s.weight_kg != null) weightUsed += Number(s.weight_kg) || 0;
    else if (s.weightKg != null) weightUsed += Number(s.weightKg) || 0;
  }
  const utilV = volumeCapacityM3 > 0 ? (volumeUsed / volumeCapacityM3) * 100 : 0;
  const utilW = weightCapacityKg > 0 ? (weightUsed / weightCapacityKg) * 100 : 0;
  const utilizationPct = Math.round(Math.max(utilV, utilW) * 10) / 10;
  return {
    volumeCapacityM3,
    weightCapacityKg,
    seatCapacity,
    luggageCapacityKg,
    seatsUsed: seatCapacity != null ? Math.round(volumeUsed) : null,
    luggageUsedKg: luggageCapacityKg != null ? Math.round(weightUsed * 10) / 10 : null,
    volumeUsed: Math.round(volumeUsed * 1000) / 1000,
    weightUsed: Math.round(weightUsed * 10) / 10,
    utilizationPct,
  };
}

/** When passenger fields are present, mirror onto volume/weight for CVRP. */
function orderCargoFromBody(body) {
  const hasPax =
    body.passengerCount != null ||
    body.passenger_count != null ||
    body.luggageKg != null ||
    body.luggage_kg != null;
  if (hasPax || String(body.profile || "").toLowerCase() === "passenger") {
    const mapped = passengerDemandToCargo({
      passengerCount: body.passengerCount ?? body.passenger_count,
      luggageKg: body.luggageKg ?? body.luggage_kg,
    });
    return {
      volumeM3: mapped.volumeM3,
      weightKg: mapped.weightKg,
      passengerCount: mapped.passengerCount,
      luggageKg: mapped.luggageKg,
    };
  }
  return {
    volumeM3: numOrNull(body.volumeM3),
    weightKg: numOrNull(body.weightKg),
    passengerCount: intOrNull(body.passengerCount ?? body.passenger_count),
    luggageKg: numOrNull(body.luggageKg ?? body.luggage_kg),
  };
}

function publicJob(row, stops = []) {
  const cap = capacityFrom(row, stops);
  const routeStart = routeAnchorFromRow(
    row.route_start_lat,
    row.route_start_lon,
    row.route_start_label || "Start",
  );
  const routeEnd = routeAnchorFromRow(
    row.route_end_lat,
    row.route_end_lon,
    row.route_end_label || "Return",
  );
  const pathMode = String(row.route_anchor_mode || "").toLowerCase();
  const serviceDate = formatServiceDate(row.service_date) || todayYmd();
  // A NULL end_date is the single-day case, which is every pre-existing job.
  const endDate = formatServiceDate(row.end_date) || serviceDate;
  const dayCount = spanDayCount(serviceDate, endDate);
  return {
    id: row.id,
    status: row.status,
    title: row.title || "",
    notes: row.notes || "",
    armadaUserId: row.armada_user_id == null ? null : Number(row.armada_user_id),
    armadaUsername: row.armada_username || "",
    userDisplayName: row.user_display_name || "",
    trackerDeviceId: row.tracker_device_id || null,
    assignedFieldUserId: row.assigned_field_user_id || null,
    assigneeUsername: row.assignee_username || "",
    assigneeDisplayName: row.assignee_display_name || "",
    assignedAt: row.assigned_at || null,
    startedAt: row.started_at || null,
    arrivedAt: row.arrived_at || null,
    completedAt: row.completed_at || null,
    fieldNote: row.field_note || "",
    serviceDate,
    endDate,
    dayCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    routeAnchorMode: pathMode === "map" || pathMode === "sequence" ? pathMode : null,
    routeStart,
    routeEnd,
    planDayStart: row.plan_day_start || null,
    plannedDistanceKm: row.planned_distance_km == null ? null : Number(row.planned_distance_km),
    plannedDurationSec: row.planned_duration_sec == null ? null : Number(row.planned_duration_sec),
    actualDistanceKm: row.actual_distance_km == null ? null : Number(row.actual_distance_km),
    actualDurationSec: row.actual_duration_sec == null ? null : Number(row.actual_duration_sec),
    opexEstimate: row.opex_estimate == null ? null : Number(row.opex_estimate),
    opexActual: row.opex_actual == null ? null : Number(row.opex_actual),
    opexDepotId: row.opex_depot_id || null,
    fareEstimate: row.fare_estimate == null ? null : Number(row.fare_estimate),
    fareActual: row.fare_actual == null ? null : Number(row.fare_actual),
    ...cap,
    stops: stops.map((s) => publicStop(s, serviceDate)),
  };
}

/**
 * Annotate a public job with which day of its span was asked for, so a client can
 * say "Day 2 of 3" without recomputing the offset.
 */
function withRequestedDay(job, requestedDate) {
  const offset = dayDiff(job.serviceDate, requestedDate);
  const dayNumber =
    offset != null && offset >= 0 && offset < job.dayCount ? offset + 1 : null;
  return { ...job, requestedDate: requestedDate || job.serviceDate, dayNumber };
}

/** Only the stops belonging to one day of the tour. */
function stopsForDay(stops, dayIndex) {
  return (stops || []).filter((s) => {
    const d = Number.isFinite(Number(s.day_index)) ? Number(s.day_index) : 0;
    return d === dayIndex;
  });
}


function publicOrder(row) {
  return {
    id: row.id,
    kind: parseOrderKind(row.kind),
    externalRef: row.external_ref || "",
    customerName: row.customer_name || "",
    address: row.address || "",
    lat: row.lat == null ? null : Number(row.lat),
    lon: row.lon == null ? null : Number(row.lon),
    zone: row.zone || "",
    volumeM3: row.volume_m3 == null ? null : Number(row.volume_m3),
    weightKg: row.weight_kg == null ? null : Number(row.weight_kg),
    passengerCount: row.passenger_count == null ? null : Number(row.passenger_count),
    luggageKg: row.luggage_kg == null ? null : Number(row.luggage_kg),
    profile: parseOrderProfile(row.profile) || "cargo",
    visitOutcome: row.visit_outcome || null,
    spawnedFromOrderId: row.spawned_from_order_id || null,
    goodsSubtotal: row.goods_subtotal == null ? null : Number(row.goods_subtotal),
    goodsCostSubtotal: row.goods_cost_subtotal == null ? null : Number(row.goods_cost_subtotal),
    windowStart: row.window_start || "",
    windowEnd: row.window_end || "",
    serviceDate: formatServiceDate(row.service_date) || todayYmd(),
    serviceMinutes: row.service_minutes == null ? null : Number(row.service_minutes),
    proofRequired: row.proof_required === true,
    pickupAddress: row.pickup_address || "",
    pickupLat: row.pickup_lat == null ? null : Number(row.pickup_lat),
    pickupLon: row.pickup_lon == null ? null : Number(row.pickup_lon),
    pickupZone: row.pickup_zone || "",
    pickupWindowStart: row.pickup_window_start || "",
    pickupWindowEnd: row.pickup_window_end || "",
    pickupServiceMinutes:
      row.pickup_service_minutes == null ? null : Number(row.pickup_service_minutes),
    pickupProofRequired: row.pickup_proof_required === true,
    templateId: row.template_id || null,
    customerId: row.customer_id || null,
    status: row.status || "pending",
    jobId: row.job_id || null,
    stopId: row.stop_id || null,
    notes: row.notes || "",
    cargoTotalsLocked: row.cargo_totals_locked === true,
    sourceDepotId: row.source_depot_id || null,
    lines: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function publicOrderWithLines(tenantId, row) {
  const [order] = await decorateOrdersWithLines(tenantId, [publicOrder(row)]);
  return order;
}

async function publicJobWithLines(tenantId, row, stops = []) {
  const [job] = await decorateJobsWithLines(tenantId, [publicJob(row, stops)]);
  return job;
}

function publicOrderTemplate(row) {
  return {
    id: row.id,
    enabled: row.enabled !== false,
    cadence: row.cadence || "daily",
    weekday: row.weekday == null ? null : Number(row.weekday),
    externalRef: row.external_ref || "",
    customerName: row.customer_name || "",
    address: row.address || "",
    lat: row.lat == null ? null : Number(row.lat),
    lon: row.lon == null ? null : Number(row.lon),
    zone: row.zone || "",
    volumeM3: row.volume_m3 == null ? null : Number(row.volume_m3),
    weightKg: row.weight_kg == null ? null : Number(row.weight_kg),
    windowStart: row.window_start || "",
    windowEnd: row.window_end || "",
    serviceMinutes: row.service_minutes == null ? null : Number(row.service_minutes),
    proofRequired: row.proof_required === true,
    notes: row.notes || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseCadence(v) {
  const s = String(v || "daily").toLowerCase().trim();
  if (s === "weekdays" || s === "weekday" || s === "mon-fri") return "weekdays";
  if (s === "weekly" || s === "week") return "weekly";
  return "daily";
}

/** @param {{ cadence: string, weekday: number|null }} tpl @param {string} ymd */
function templateMatchesDate(tpl, ymd) {
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const dow = d.getDay();
  const cadence = parseCadence(tpl.cadence);
  if (cadence === "daily") return true;
  if (cadence === "weekdays") return dow >= 1 && dow <= 5;
  if (cadence === "weekly") {
    const w = tpl.weekday == null ? dow : Number(tpl.weekday);
    return Number.isInteger(w) && w === dow;
  }
  return false;
}

export function publicDispatchPhoto(row, urlPrefix = "/api/dispatch/photos") {
  return {
    id: row.id,
    stopId: row.stop_id || null,
    contentType: row.content_type || "",
    bytes: row.bytes == null ? null : Number(row.bytes),
    caption: row.caption || "",
    createdAt: row.created_at,
    url: `${urlPrefix}/${row.id}`,
  };
}

async function loadStops(jobId) {
  const rows = await dbQuery(
    `SELECT s.*, o.profile AS order_profile
     FROM dispatch_stops s
     LEFT JOIN dispatch_orders o ON o.id = s.order_id
     WHERE s.job_id = $1
     ORDER BY s.sort_order ASC, s.created_at ASC`,
    [jobId],
  );
  return rows.rows;
}

async function loadJob(tenantId, jobId) {
  const found = await dbQuery(
    `SELECT j.*,
            u.username AS assignee_username,
            u.display_name AS assignee_display_name
     FROM dispatch_jobs j
     LEFT JOIN field_users u ON u.id = j.assigned_field_user_id
     WHERE j.id = $1 AND j.tenant_id = $2`,
    [jobId, tenantId],
  );
  return found.rows[0] || null;
}

/** Reorder remaining stops only (done/skipped frozen); optional depot/GPS as fixed start. */
async function reorderJobStopsRoad(jobId, depot = null, routing = null) {
  const start =
    depot && Number.isFinite(Number(depot.lat)) && Number.isFinite(Number(depot.lon))
      ? { lat: Number(depot.lat), lon: Number(depot.lon) }
      : null;
  const result = await reorderRemainingStops(jobId, { start, routing });
  return result.matrixEngine ? { engine: result.matrixEngine, warning: result.warning } : null;
}

/**
 * Desk master writes: field session required + matching tenant + privilege flag.
 * @returns {Promise<boolean>} true if allowed
 */
/**
 * Hard gate for Goods/Customers masters: desk sign-in + privilege required.
 * @param {string} privilege
 */
async function requireDeskMasterPrivilege(req, res, tenantId, privilege) {
  const user = await fieldFromRequest(req);
  if (!user) {
    json(res, 401, { error: "Desk sign-in required to change master data" });
    return false;
  }
  if (String(user.tenantId) !== String(tenantId)) {
    json(res, 403, { error: "Signed-in user does not match this tenant" });
    return false;
  }
  if (!user.privileges || user.privileges[privilege] !== true) {
    json(res, 403, { error: `Missing desk privilege: ${privilege}` });
    return false;
  }
  return true;
}

/**
 * Soft gate for Jobs / orders / plan / live / settings:
 * no desk session → allow (tenant embed auth unchanged);
 * desk session present → named privilege required.
 * @param {string} privilege
 */
async function requireDeskPrivilege(req, res, tenantId, privilege) {
  const user = await fieldFromRequest(req);
  if (!user) return true;
  if (String(user.tenantId) !== String(tenantId)) {
    json(res, 403, { error: "Signed-in user does not match this tenant" });
    return false;
  }
  if (!user.privileges || user.privileges[privilege] !== true) {
    json(res, 403, { error: `Missing desk privilege: ${privilege}` });
    return false;
  }
  return true;
}

async function requireDispatchModule(tenantId) {
  const row = await dbQuery(`SELECT entitlements FROM tenants WHERE id = $1`, [tenantId]);
  const ent = mergeEntitlements(row.rows[0]?.entitlements);
  return moduleEnabled(ent, "dispatch");
}

function normalizeStops(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (let i = 0; i < raw.length && out.length < 50; i++) {
    const s = raw[i];
    if (!s || typeof s !== "object") continue;
    const lat = s.lat == null || s.lat === "" ? null : Number(s.lat);
    const lon = s.lon == null || s.lon === "" ? null : Number(s.lon ?? s.lng);
    out.push({
      name: String(s.name || s.label || `Stop ${i + 1}`).trim().slice(0, 200) || `Stop ${i + 1}`,
      address: String(s.address || "").trim().slice(0, 500) || null,
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      notes: String(s.notes || "").trim().slice(0, 1000) || null,
      zone: String(s.zone || "").trim().slice(0, 80) || null,
      volumeM3: numOrNull(s.volumeM3 ?? s.volume_m3),
      weightKg: numOrNull(s.weightKg ?? s.weight_kg),
      windowStart: String(s.windowStart || s.window_start || "").trim().slice(0, 16) || null,
      windowEnd: String(s.windowEnd || s.window_end || "").trim().slice(0, 16) || null,
      serviceMinutes: serviceMinutesOrNull(s.serviceMinutes ?? s.service_minutes),
      proofRequired: s.proofRequired === true || s.proof_required === true,
      orderId: s.orderId || s.order_id || null,
      sortOrder: Number.isInteger(Number(s.sortOrder)) ? Number(s.sortOrder) : i,
      dayIndex: clampDayIndex(s.dayIndex ?? s.day_index),
    });
  }
  return out;
}

/** Unlink order from its job stop(s) — both legs of a pickup/drop pair. */
async function detachOrderFromJob(order) {
  if (!order) return;
  await dbQuery(
    `UPDATE dispatch_orders
     SET stop_id = NULL, job_id = NULL, updated_at = now()
     WHERE id = $1`,
    [order.id],
  );
  await dbQuery(`DELETE FROM dispatch_stops WHERE order_id = $1`, [order.id]);
}

/**
 * Attach pending inbox orders to an open job. Completed/cancelled jobs are rejected
 * so extra work becomes a new trip instead of hanging on a finished run.
 * @returns {Promise<{ error?: string, status?: number, capacity?: object, addedNames: string[] }>}
 */
async function assignPendingOrdersToJob(dbTenant, job, orderIds, { rejectOverCapacity } = {}) {
  if (jobIsClosed(job.status)) {
    return {
      error: "This job is completed. Create a new trip for the same driver instead.",
      status: 400,
      addedNames: [],
    };
  }
  const ids = (Array.isArray(orderIds) ? orderIds : []).map(String).filter(Boolean).slice(0, 50);
  const existingStops = await loadStops(job.id);
  const jobProf = inferJobProfile(job, existingStops);
  const pendingProfiles = new Set();
  for (const oid of ids) {
    const ord = await dbQuery(
      `SELECT profile FROM dispatch_orders
       WHERE id = $1 AND tenant_id = $2 AND status = 'pending'`,
      [oid, dbTenant.id],
    );
    if (!ord.rows[0]) continue;
    pendingProfiles.add(normalizeDispatchProfile(ord.rows[0].profile));
  }
  if (pendingProfiles.size > 1) {
    return {
      error: "Cannot assign mixed cargo / passenger / sales orders to one job",
      status: 409,
      addedNames: [],
    };
  }
  const orderProf = pendingProfiles.size ? [...pendingProfiles][0] : null;
  if (orderProf && jobProf !== "open" && jobProf !== orderProf) {
    return {
      error: `This job is ${jobProf}; cannot assign ${orderProf} orders`,
      status: 409,
      addedNames: [],
    };
  }
  const cap = capacityFrom(job, existingStops);
  let pendingVol = 0;
  let pendingWt = 0;
  if (rejectOverCapacity) {
    for (const oid of ids) {
      const ord = await dbQuery(
        `SELECT volume_m3, weight_kg FROM dispatch_orders
         WHERE id = $1 AND tenant_id = $2 AND status = 'pending'`,
        [oid, dbTenant.id],
      );
      const o = ord.rows[0];
      if (!o) continue;
      pendingVol += Number(o.volume_m3) || 0;
      pendingWt += Number(o.weight_kg) || 0;
    }
    if (
      cap.volumeUsed + pendingVol > cap.volumeCapacityM3 + 1e-9 ||
      cap.weightUsed + pendingWt > cap.weightCapacityKg + 1e-9
    ) {
      return {
        error: "Assign would exceed vehicle capacity (volume or weight)",
        status: 409,
        addedNames: [],
        capacity: {
          ...cap,
          pendingVolumeM3: Math.round(pendingVol * 1000) / 1000,
          pendingWeightKg: Math.round(pendingWt * 10) / 10,
        },
      };
    }
  }
  const addedNames = [];
  let sortBase = existingStops.length;
  for (const oid of ids) {
    const ord = await dbQuery(
      `SELECT * FROM dispatch_orders
       WHERE id = $1 AND tenant_id = $2 AND status = 'pending'`,
      [oid, dbTenant.id],
    );
    const o = ord.rows[0];
    if (!o) continue;
    const jobDate = formatServiceDate(job.service_date);
    const jobEndDate = formatServiceDate(job.end_date) || jobDate;
    const orderDate = formatServiceDate(o.service_date);
    let dayIndex = 0;
    if (jobDate && orderDate) {
      const offset = dayIndexForDate(jobDate, jobEndDate, orderDate);
      if (offset == null) continue;
      dayIndex = offset;
    }
    if (parseOrderKind(o.kind) === "pickup_drop" && !pickupCoord(o)) continue;
    const inserted = await insertStopsFromOrder(job.id, o, sortBase, dayIndex);
    if (!inserted.firstStopId) continue;
    sortBase += inserted.count;
    await dbQuery(
      `UPDATE dispatch_orders
       SET status = 'assigned', job_id = $1, stop_id = $2, updated_at = now()
       WHERE id = $3`,
      [job.id, inserted.firstStopId, o.id],
    );
    addedNames.push(String(o.customer_name || o.external_ref || "Stop").trim() || "Stop");
  }
  if (job.status === "draft" && job.assigned_field_user_id) {
    await dbQuery(
      `UPDATE dispatch_jobs SET status = 'assigned', assigned_at = COALESCE(assigned_at, now()), updated_at = now()
       WHERE id = $1`,
      [job.id],
    );
  } else {
    await dbQuery(`UPDATE dispatch_jobs SET updated_at = now() WHERE id = $1`, [job.id]);
  }
  await recomputeJobSpan(job.id);
  return { addedNames };
}

/**
 * Insert one or two stops from a pending order. Pair drop stores cargo on
 * pickup only so job utilization does not double-count.
 * @returns {Promise<{ firstStopId: string, count: number }>}
 */
async function insertStopsFromOrder(jobId, order, sortBase, dayIndex) {
  const kind = parseOrderKind(order.kind);
  const pair = kind === "pickup_drop";
  const pickupOnly = kind === "pickup";
  const legs = [];
  if (pickupOnly) {
    legs.push({
      role: "pickup",
      name: `${order.customer_name || order.external_ref || "Stop"} · pickup`,
      address: order.address,
      lat: order.lat,
      lon: order.lon,
      zone: order.zone,
      volume: order.volume_m3,
      weight: order.weight_kg,
      windowStart: order.window_start,
      windowEnd: order.window_end,
      serviceMinutes: order.service_minutes,
      proof: order.proof_required === true,
    });
  } else if (pair) {
    const p = pickupCoord(order);
    if (!p) {
      return { firstStopId: null, count: 0 };
    }
    legs.push({
      role: "pickup",
      name: `${order.customer_name || order.external_ref || "Stop"} · pickup`,
      address: order.pickup_address,
      lat: p.lat,
      lon: p.lon,
      zone: order.pickup_zone || order.zone,
      volume: order.volume_m3,
      weight: order.weight_kg,
      windowStart: order.pickup_window_start,
      windowEnd: order.pickup_window_end,
      serviceMinutes: order.pickup_service_minutes ?? order.service_minutes,
      proof: order.pickup_proof_required === true,
    });
    legs.push({
      role: "drop",
      name: `${order.customer_name || order.external_ref || "Stop"} · drop`,
      address: order.address,
      lat: order.lat,
      lon: order.lon,
      zone: order.zone,
      volume: null,
      weight: null,
      windowStart: order.window_start,
      windowEnd: order.window_end,
      serviceMinutes: order.service_minutes,
      proof: order.proof_required === true,
    });
  } else {
    legs.push({
      role: "drop",
      name: order.customer_name || order.external_ref || `Stop ${sortBase + 1}`,
      address: order.address,
      lat: order.lat,
      lon: order.lon,
      zone: order.zone,
      volume: order.volume_m3,
      weight: order.weight_kg,
      windowStart: order.window_start,
      windowEnd: order.window_end,
      serviceMinutes: order.service_minutes,
      proof: order.proof_required === true,
    });
  }
  let firstStopId = null;
  let n = 0;
  for (const leg of legs) {
    const inserted = await dbQuery(
      `INSERT INTO dispatch_stops (
         job_id, sort_order, name, address, lat, lon, notes,
         zone, volume_m3, weight_kg, window_start, window_end, service_minutes, proof_required, order_id,
         day_index, role
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id`,
      [
        jobId,
        sortBase + n,
        leg.name,
        leg.address,
        leg.lat,
        leg.lon,
        order.notes,
        leg.zone,
        leg.volume,
        leg.weight,
        leg.windowStart,
        leg.windowEnd,
        leg.serviceMinutes,
        leg.proof,
        order.id,
        dayIndex,
        leg.role,
      ],
    );
    if (!firstStopId) firstStopId = inserted.rows[0].id;
    n += 1;
  }
  return { firstStopId, count: n };
}

/** Insert a single pickup or drop leg (used when Auto-plan sequences other stops between them). */
async function insertStopLeg(jobId, order, role, sortBase, dayIndex) {
  const want = role === "pickup" ? "pickup" : "drop";
  const kind = parseOrderKind(order.kind);
  const pair = kind === "pickup_drop";
  const pickupOnly = kind === "pickup";
  if (want === "pickup" && !pair && !pickupOnly) return null;
  if (want === "drop" && pickupOnly) return null;
  const p = pair ? pickupCoord(order) : null;
  const nameBase = order.customer_name || order.external_ref || "Stop";
  const leg =
    want === "pickup"
      ? pickupOnly
        ? {
            role: "pickup",
            name: `${nameBase} · pickup`,
            address: order.address,
            lat: order.lat,
            lon: order.lon,
            zone: order.zone,
            volume: order.volume_m3,
            weight: order.weight_kg,
            windowStart: order.window_start,
            windowEnd: order.window_end,
            serviceMinutes: order.service_minutes,
            proof: order.proof_required === true,
          }
        : {
          role: "pickup",
          name: `${nameBase} · pickup`,
          address: order.pickup_address,
          lat: p?.lat,
          lon: p?.lon,
          zone: order.pickup_zone || order.zone,
          volume: order.volume_m3,
          weight: order.weight_kg,
          windowStart: order.pickup_window_start,
          windowEnd: order.pickup_window_end,
          serviceMinutes: order.pickup_service_minutes ?? order.service_minutes,
          proof: order.pickup_proof_required === true,
        }
      : {
          role: "drop",
          name: pair ? `${nameBase} · drop` : nameBase,
          address: order.address,
          lat: order.lat,
          lon: order.lon,
          zone: order.zone,
          volume: pair ? null : order.volume_m3,
          weight: pair ? null : order.weight_kg,
          windowStart: order.window_start,
          windowEnd: order.window_end,
          serviceMinutes: order.service_minutes,
          proof: order.proof_required === true,
        };
  if (leg.lat == null || leg.lon == null) return null;
  const inserted = await dbQuery(
    `INSERT INTO dispatch_stops (
       job_id, sort_order, name, address, lat, lon, notes,
       zone, volume_m3, weight_kg, window_start, window_end, service_minutes, proof_required, order_id,
       day_index, role
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING id`,
    [
      jobId,
      sortBase,
      leg.name,
      leg.address,
      leg.lat,
      leg.lon,
      order.notes,
      leg.zone,
      leg.volume,
      leg.weight,
      leg.windowStart,
      leg.windowEnd,
      leg.serviceMinutes,
      leg.proof,
      order.id,
      dayIndex,
      leg.role,
    ],
  );
  return inserted.rows[0]?.id || null;
}

async function replaceStops(jobId, stops) {
  await dbQuery(`UPDATE dispatch_orders SET stop_id = NULL, job_id = NULL, status = 'pending', updated_at = now()
                 WHERE job_id = $1 AND status = 'assigned'`, [jobId]);
  await dbQuery(`DELETE FROM dispatch_stops WHERE job_id = $1`, [jobId]);
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    const inserted = await dbQuery(
      `INSERT INTO dispatch_stops (
         job_id, sort_order, name, address, lat, lon, notes,
         zone, volume_m3, weight_kg, window_start, window_end, service_minutes, proof_required, order_id,
         day_index, role
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id`,
      [
        jobId,
        s.sortOrder ?? i,
        s.name,
        s.address,
        s.lat,
        s.lon,
        s.notes,
        s.zone,
        s.volumeM3,
        s.weightKg,
        s.windowStart,
        s.windowEnd,
        s.serviceMinutes,
        s.proofRequired === true,
        s.orderId,
        s.dayIndex ?? 0,
        s.role === "pickup" ? "pickup" : "drop",
      ],
    );
    if (s.orderId) {
      await dbQuery(
        `UPDATE dispatch_orders
         SET status = 'assigned', job_id = $1, stop_id = $2, updated_at = now()
         WHERE id = $3`,
        [jobId, inserted.rows[0].id, s.orderId],
      );
    }
  }
  await recomputeJobSpan(jobId);
}

export async function saveDispatchStopPhoto(stopId, tenantId, { buffer, contentType, caption, fieldUserId }) {
  const ct = contentType || "image/jpeg";
  let key;
  let payload = null;
  if (objectStorageConfigured()) {
    key = `dispatch-pod/${tenantId}/${stopId}/${crypto.randomUUID()}`;
    await putObject(key, buffer, ct);
  } else {
    key = `inline/dispatch-pod/${tenantId}/${stopId}/${crypto.randomUUID()}`;
    payload = buffer;
  }
  const inserted = await dbQuery(
    `INSERT INTO dispatch_stop_photos
       (stop_id, storage_key, content_type, bytes, caption, uploaded_by_field_user_id, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, stop_id, content_type, bytes, caption, created_at`,
    [stopId, key, ct, buffer.length, caption || null, fieldUserId || null, payload],
  );
  return inserted.rows[0];
}

export async function loadDispatchPhotoBytes(photoId, tenantId) {
  const found = await dbQuery(
    `SELECT p.storage_key, p.content_type, p.payload
     FROM dispatch_stop_photos p
     JOIN dispatch_stops s ON s.id = p.stop_id
     JOIN dispatch_jobs j ON j.id = s.job_id
     WHERE p.id = $1 AND j.tenant_id = $2`,
    [photoId, tenantId],
  );
  const row = found.rows[0];
  if (!row) return null;
  if (row.payload) {
    const body = Buffer.isBuffer(row.payload) ? row.payload : Buffer.from(row.payload);
    return { body, contentType: row.content_type || "image/jpeg" };
  }
  const obj = await getObject(row.storage_key);
  return {
    body: obj.body,
    contentType: obj.contentType || row.content_type || "image/jpeg",
  };
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export async function handleDispatchRequest(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  if (!url.pathname.startsWith("/api/dispatch")) return false;

  try {
    if (!databaseUrlConfigured()) {
      json(res, 503, { error: "Database not configured" });
      return true;
    }
    const dbTenant = await resolveDbTenant(req);
    if (!dbTenant) {
      json(res, 401, { error: "Tenant key required (k=)" });
      return true;
    }
    if (!(await requireDispatchModule(dbTenant.id))) {
      json(res, 403, { error: "Dispatch module not enabled for this tenant" });
      return true;
    }

    if (url.pathname === "/api/dispatch/customers" && req.method === "GET") {
      json(res, 200, { customers: await listCustomers(dbTenant.id) });
      return true;
    }
    if (url.pathname === "/api/dispatch/customers" && req.method === "POST") {
      if (!(await requireDeskMasterPrivilege(req, res, dbTenant.id, "editDispatchCustomers"))) return true;
      const body = await readJson(req);
      const customer = await createCustomer(dbTenant.id, body);
      json(res, 201, { customer });
      return true;
    }
    if (url.pathname === "/api/dispatch/customers/import" && req.method === "POST") {
      if (!(await requireDeskMasterPrivilege(req, res, dbTenant.id, "editDispatchCustomers"))) return true;
      const body = await readJson(req);
      let rawRows = Array.isArray(body.rows) ? body.rows : null;
      if (!rawRows && typeof body.csv === "string") rawRows = parseCsv(body.csv).rows;
      if (!rawRows) {
        json(res, 400, { error: "rows or csv required" });
        return true;
      }
      json(res, 200, await importCustomersFromRows(dbTenant.id, rawRows));
      return true;
    }
    const customerOne = /^\/api\/dispatch\/customers\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (customerOne && req.method === "PATCH") {
      if (!(await requireDeskMasterPrivilege(req, res, dbTenant.id, "editDispatchCustomers"))) return true;
      const body = await readJson(req);
      const customer = await updateCustomer(dbTenant.id, customerOne[1], body);
      json(res, 200, { customer });
      return true;
    }
    if (customerOne && req.method === "DELETE") {
      if (!(await requireDeskMasterPrivilege(req, res, dbTenant.id, "deleteDispatchCustomers"))) return true;
      await deleteCustomer(dbTenant.id, customerOne[1]);
      json(res, 200, { ok: true });
      return true;
    }

    if (url.pathname === "/api/dispatch/goods" && req.method === "GET") {
      const items = await listGoodsItems(dbTenant.id, { includeDisabled: true });
      json(res, 200, { items });
      return true;
    }

    if (url.pathname === "/api/dispatch/goods" && req.method === "POST") {
      if (!(await requireDeskMasterPrivilege(req, res, dbTenant.id, "editDispatchGoods"))) return true;
      const body = await readJson(req);
      const item = await createGoodsItem(dbTenant.id, body);
      json(res, 201, { item });
      return true;
    }

    if (url.pathname === "/api/dispatch/goods/import" && req.method === "POST") {
      if (!(await requireDeskMasterPrivilege(req, res, dbTenant.id, "editDispatchGoods"))) return true;
      const body = await readJson(req);
      let rawRows = Array.isArray(body.rows) ? body.rows : null;
      if (!rawRows && typeof body.csv === "string") {
        rawRows = parseCsv(body.csv).rows;
      }
      if (!rawRows || !rawRows.length) {
        json(res, 400, { error: "rows or csv required" });
        return true;
      }
      const out = await importGoodsItemsFromRows(dbTenant.id, rawRows);
      json(res, 200, out);
      return true;
    }

    const goodsOne = /^\/api\/dispatch\/goods\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (goodsOne && req.method === "PATCH") {
      if (!(await requireDeskMasterPrivilege(req, res, dbTenant.id, "editDispatchGoods"))) return true;
      const body = await readJson(req);
      const item = await updateGoodsItem(dbTenant.id, goodsOne[1], body);
      json(res, 200, { item });
      return true;
    }
    if (goodsOne && req.method === "DELETE") {
      if (!(await requireDeskMasterPrivilege(req, res, dbTenant.id, "deleteDispatchGoods"))) return true;
      await deleteGoodsItem(dbTenant.id, goodsOne[1]);
      json(res, 200, { ok: true });
      return true;
    }

    if (url.pathname === "/api/dispatch/stock" && req.method === "GET") {
      const catalogItemId = String(url.searchParams.get("itemId") || url.searchParams.get("catalogItemId") || "").trim() || null;
      const depotId = String(url.searchParams.get("depotId") || "").trim() || null;
      const jobId = String(url.searchParams.get("jobId") || "").trim() || null;
      const balances = await listStockBalances(dbTenant.id, { catalogItemId, depotId });
      const truck = await listTruckStock(dbTenant.id, { catalogItemId, jobId });
      const settings = parseStockSettings(dbTenant.entitlements);
      json(res, 200, { balances, truck, settings });
      return true;
    }

    if (url.pathname === "/api/dispatch/stock/adjust" && req.method === "POST") {
      const body = await readJson(req);
      const out = await adjustDepotStock(dbTenant.id, body);
      json(res, 200, out);
      return true;
    }

    const stockMoves = /^\/api\/dispatch\/stock\/([0-9a-f-]{36})\/movements$/i.exec(url.pathname);
    if (stockMoves && req.method === "GET") {
      const movements = await listRecentStockMovements(dbTenant.id, stockMoves[1], Number(url.searchParams.get("limit") || 20));
      json(res, 200, { movements });
      return true;
    }

    if (url.pathname === "/api/dispatch/stock/resolve-depot" && req.method === "POST") {
      const body = await readJson(req);
      const depotId = await resolveSourceDepotId(dbTenant.id, {
        order: body.order || body,
        job: body.job || null,
      });
      json(res, 200, { depotId, settings: parseStockSettings(dbTenant.entitlements) });
      return true;
    }

    if (url.pathname === "/api/dispatch/cost-rates" && req.method === "GET") {
      json(res, 200, { rates: await listCostRates(dbTenant.id) });
      return true;
    }
    if (url.pathname === "/api/dispatch/cost-rates" && (req.method === "PUT" || req.method === "POST")) {
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "manageDispatchSettings"))) return true;
      const body = await readJson(req);
      const rate = await upsertCostRates(dbTenant.id, body);
      json(res, 200, { rate, rates: await listCostRates(dbTenant.id) });
      return true;
    }

    if (url.pathname === "/api/dispatch/fare-rates" && req.method === "GET") {
      json(res, 200, {
        rates: await listFareRates(dbTenant.id),
        profiles: parseDispatchProfiles(dbTenant.entitlements),
      });
      return true;
    }
    if (url.pathname === "/api/dispatch/fare-rates" && (req.method === "PUT" || req.method === "POST")) {
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "manageDispatchSettings"))) return true;
      const body = await readJson(req);
      const rate = await upsertFareRates(dbTenant.id, body);
      json(res, 200, { rate, rates: await listFareRates(dbTenant.id) });
      return true;
    }

    if (url.pathname === "/api/dispatch/scan" && req.method === "POST") {
      const body = await readJson(req);
      json(res, 200, await lookupCatalogScan(dbTenant.id, { ...body, context: body.context || "dispatch_cargo" }));
      return true;
    }

    const goodsCodes = /^\/api\/dispatch\/goods\/([0-9a-f-]{36})\/codes$/i.exec(url.pathname);
    if (goodsCodes && req.method === "GET") {
      json(res, 200, { codes: await listCodesForTarget(dbTenant.id, "goods", goodsCodes[1]) });
      return true;
    }
    if (goodsCodes && req.method === "POST") {
      const found = await dbQuery(
        `SELECT id FROM dispatch_goods_items WHERE id = $1 AND tenant_id = $2`,
        [goodsCodes[1], dbTenant.id],
      );
      if (!found.rows[0]) {
        json(res, 404, { error: "Goods item not found" });
        return true;
      }
      const body = await readJson(req);
      const code = await addCatalogCode(dbTenant.id, {
        targetKind: "goods",
        targetId: goodsCodes[1],
        code: body.code,
        codeFormat: body.codeFormat || "ean",
        label: body.label,
      });
      json(res, 201, { code });
      return true;
    }
    const goodsCodeOne =
      /^\/api\/dispatch\/goods\/([0-9a-f-]{36})\/codes\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (goodsCodeOne && req.method === "DELETE") {
      await deleteCatalogCode(dbTenant.id, goodsCodeOne[2]);
      json(res, 200, { ok: true });
      return true;
    }

    const vehicleCodes = /^\/api\/dispatch\/vehicles\/(\d+)\/codes$/i.exec(url.pathname);
    if (vehicleCodes && req.method === "GET") {
      const targetId = vehicleCodes[1];
      const existing = await listCodesForTarget(dbTenant.id, "vehicle", targetId);
      if (!existing.some((c) => c.codeFormat === "sku")) {
        try {
          await syncPrimarySku(dbTenant.id, "vehicle", targetId, targetId);
        } catch (err) {
          if (!err || err.status !== 409) throw err;
        }
      }
      json(res, 200, { codes: await listCodesForTarget(dbTenant.id, "vehicle", targetId) });
      return true;
    }
    if (vehicleCodes && req.method === "POST") {
      const body = await readJson(req);
      const code = await addCatalogCode(dbTenant.id, {
        targetKind: "vehicle",
        targetId: vehicleCodes[1],
        code: body.code,
        codeFormat: body.codeFormat || "other",
        label: body.label,
      });
      json(res, 201, { code });
      return true;
    }
    const vehicleCodeOne =
      /^\/api\/dispatch\/vehicles\/(\d+)\/codes\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (vehicleCodeOne && req.method === "DELETE") {
      await deleteCatalogCode(dbTenant.id, vehicleCodeOne[2]);
      json(res, 200, { ok: true });
      return true;
    }

    const locationCodes = /^\/api\/dispatch\/locations\/([0-9a-f-]{36})\/codes$/i.exec(url.pathname);
    if (locationCodes && req.method === "GET") {
      const depot = await dbQuery(
        `SELECT id FROM dispatch_depots WHERE id = $1 AND tenant_id = $2`,
        [locationCodes[1], dbTenant.id],
      );
      if (!depot.rows[0]) {
        json(res, 404, { error: "Depot not found" });
        return true;
      }
      const existing = await listCodesForTarget(dbTenant.id, "location", locationCodes[1]);
      if (!existing.some((c) => c.codeFormat === "sku")) {
        try {
          await syncPrimarySku(dbTenant.id, "location", locationCodes[1], locationCodes[1]);
        } catch (err) {
          if (!err || err.status !== 409) throw err;
        }
      }
      json(res, 200, { codes: await listCodesForTarget(dbTenant.id, "location", locationCodes[1]) });
      return true;
    }
    if (locationCodes && req.method === "POST") {
      const depot = await dbQuery(
        `SELECT id FROM dispatch_depots WHERE id = $1 AND tenant_id = $2`,
        [locationCodes[1], dbTenant.id],
      );
      if (!depot.rows[0]) {
        json(res, 404, { error: "Depot not found" });
        return true;
      }
      const body = await readJson(req);
      const code = await addCatalogCode(dbTenant.id, {
        targetKind: "location",
        targetId: locationCodes[1],
        code: body.code,
        codeFormat: body.codeFormat || "other",
        label: body.label,
      });
      json(res, 201, { code });
      return true;
    }
    const locationCodeOne =
      /^\/api\/dispatch\/locations\/([0-9a-f-]{36})\/codes\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (locationCodeOne && req.method === "DELETE") {
      await deleteCatalogCode(dbTenant.id, locationCodeOne[2]);
      json(res, 200, { ok: true });
      return true;
    }

    if (url.pathname === "/api/dispatch/field-users" && req.method === "GET") {
      const rows = await dbQuery(
        `SELECT id, username, role, display_name, enabled
         FROM field_users
         WHERE tenant_id = $1 AND enabled = true
         ORDER BY lower(coalesce(nullif(display_name,''), username)) ASC
         LIMIT 200`,
        [dbTenant.id],
      );
      json(res, 200, {
        users: rows.rows.map((r) => ({
          id: r.id,
          username: r.username,
          role: r.role,
          displayName: r.display_name || "",
          enabled: r.enabled !== false,
        })),
      });
      return true;
    }

    // —— Vehicle capacity presets (Armada user id and/or tracker device) ——
    const publicVehicleCapacity = (r) => ({
      id: r.id || null,
      armadaUserId: r.armada_user_id == null ? null : Number(r.armada_user_id),
      trackerDeviceId: r.tracker_device_id || null,
      volumeCapacityM3: Number(r.volume_capacity_m3) || 12,
      weightCapacityKg: Number(r.weight_capacity_kg) || 1500,
      seatCapacity: r.seat_capacity == null ? null : Number(r.seat_capacity),
      luggageCapacityKg:
        r.luggage_capacity_kg == null ? null : Number(r.luggage_capacity_kg),
      label: r.label || "",
      depotId: r.depot_id || null,
      plateParity: normalizePlateParity(r.plate_parity || "unknown"),
      updatedAt: r.updated_at,
    });

    const upsertVehicleCapacityRow = async (opts) => {
      const {
        armadaUserId = null,
        trackerDeviceId = null,
        vol,
        wt,
        seatCapacity,
        luggageCapacityKg,
        label,
        depotId,
        plateParity,
        hasDepotField,
        hasPlateField,
      } = opts;
      const plateVal = plateParity === "unknown" ? null : plateParity;
      if (trackerDeviceId) {
        const updated = await dbQuery(
          `UPDATE vehicle_capacities SET
             volume_capacity_m3 = $3,
             weight_capacity_kg = $4,
             seat_capacity = $5,
             luggage_capacity_kg = $6,
             label = COALESCE($7, label),
             depot_id = CASE WHEN $8 THEN $9 ELSE depot_id END,
             plate_parity = CASE WHEN $10 THEN $11 ELSE plate_parity END,
             updated_at = now()
           WHERE tenant_id = $1 AND tracker_device_id = $2::uuid
           RETURNING id, armada_user_id, tracker_device_id, volume_capacity_m3, weight_capacity_kg,
                     seat_capacity, luggage_capacity_kg, label, depot_id, plate_parity, updated_at`,
          [
            dbTenant.id,
            trackerDeviceId,
            vol,
            wt,
            seatCapacity,
            luggageCapacityKg,
            label,
            hasDepotField,
            depotId,
            hasPlateField,
            plateVal,
          ],
        );
        if (updated.rows[0]) return updated.rows[0];
        const inserted = await dbQuery(
          `INSERT INTO vehicle_capacities (
             tenant_id, armada_user_id, tracker_device_id, volume_capacity_m3, weight_capacity_kg,
             seat_capacity, luggage_capacity_kg, label, depot_id, plate_parity, updated_at
           ) VALUES ($1, $2, $3::uuid, $4, $5, $6, $7, $8, $9, $10, now())
           RETURNING id, armada_user_id, tracker_device_id, volume_capacity_m3, weight_capacity_kg,
                     seat_capacity, luggage_capacity_kg, label, depot_id, plate_parity, updated_at`,
          [
            dbTenant.id,
            armadaUserId,
            trackerDeviceId,
            vol,
            wt,
            seatCapacity,
            luggageCapacityKg,
            label,
            hasDepotField ? depotId : null,
            hasPlateField ? plateVal : null,
          ],
        );
        return inserted.rows[0];
      }
      const updated = await dbQuery(
        `UPDATE vehicle_capacities SET
           volume_capacity_m3 = $3,
           weight_capacity_kg = $4,
           seat_capacity = $5,
           luggage_capacity_kg = $6,
           label = COALESCE($7, label),
           depot_id = CASE WHEN $8 THEN $9 ELSE depot_id END,
           plate_parity = CASE WHEN $10 THEN $11 ELSE plate_parity END,
           updated_at = now()
         WHERE tenant_id = $1 AND armada_user_id = $2
         RETURNING id, armada_user_id, tracker_device_id, volume_capacity_m3, weight_capacity_kg,
                   seat_capacity, luggage_capacity_kg, label, depot_id, plate_parity, updated_at`,
        [
          dbTenant.id,
          armadaUserId,
          vol,
          wt,
          seatCapacity,
          luggageCapacityKg,
          label,
          hasDepotField,
          depotId,
          hasPlateField,
          plateVal,
        ],
      );
      if (updated.rows[0]) return updated.rows[0];
      const inserted = await dbQuery(
        `INSERT INTO vehicle_capacities (
           tenant_id, armada_user_id, tracker_device_id, volume_capacity_m3, weight_capacity_kg,
           seat_capacity, luggage_capacity_kg, label, depot_id, plate_parity, updated_at
         ) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, now())
         RETURNING id, armada_user_id, tracker_device_id, volume_capacity_m3, weight_capacity_kg,
                   seat_capacity, luggage_capacity_kg, label, depot_id, plate_parity, updated_at`,
        [
          dbTenant.id,
          armadaUserId,
          vol,
          wt,
          seatCapacity,
          luggageCapacityKg,
          label,
          hasDepotField ? depotId : null,
          hasPlateField ? plateVal : null,
        ],
      );
      return inserted.rows[0];
    };

    const parseVehicleCapacityBody = async (body) => {
      const hasSeats =
        body.seatCapacity != null ||
        body.seat_capacity != null ||
        body.luggageCapacityKg != null ||
        body.luggage_capacity_kg != null;
      let vol = numOrNull(body.volumeCapacityM3);
      let wt = numOrNull(body.weightCapacityKg);
      let seatCapacity = intOrNull(body.seatCapacity ?? body.seat_capacity);
      let luggageCapacityKg = numOrNull(body.luggageCapacityKg ?? body.luggage_capacity_kg);
      if (hasSeats) {
        const mapped = passengerCapsToCargo({ seatCapacity, luggageCapacityKg });
        seatCapacity = mapped.seatCapacity;
        luggageCapacityKg = mapped.luggageCapacityKg;
        if (mapped.volumeCapacityM3 != null) vol = mapped.volumeCapacityM3;
        if (mapped.weightCapacityKg != null) wt = mapped.weightCapacityKg;
      }
      if (vol == null || vol <= 0 || wt == null || wt <= 0) {
        return {
          error: hasSeats
            ? "seatCapacity and luggageCapacityKg must be > 0"
            : "volumeCapacityM3 and weightCapacityKg must be > 0",
        };
      }
      const label = String(body.label || "").trim().slice(0, 200) || null;
      const hasDepotField = Object.prototype.hasOwnProperty.call(body, "depotId");
      let depotId = null;
      if (hasDepotField) {
        if (body.depotId != null && body.depotId !== "") {
          const did = String(body.depotId);
          const ok = await dbQuery(
            `SELECT id FROM dispatch_depots WHERE id = $1 AND tenant_id = $2`,
            [did, dbTenant.id],
          );
          if (!ok.rows.length) return { error: "Unknown depotId" };
          depotId = ok.rows[0].id;
        }
      }
      const hasPlateField = Object.prototype.hasOwnProperty.call(body, "plateParity");
      const plateParity = hasPlateField ? normalizePlateParity(body.plateParity) : null;
      return {
        vol,
        wt,
        seatCapacity,
        luggageCapacityKg,
        label,
        depotId,
        plateParity,
        hasDepotField,
        hasPlateField,
      };
    };

    if (url.pathname === "/api/dispatch/vehicle-capacities" && req.method === "GET") {
      const rows = await dbQuery(
        `SELECT id, armada_user_id, tracker_device_id, volume_capacity_m3, weight_capacity_kg,
                seat_capacity, luggage_capacity_kg, label, depot_id, plate_parity, updated_at
         FROM vehicle_capacities
         WHERE tenant_id = $1
         ORDER BY armada_user_id ASC NULLS LAST, tracker_device_id ASC NULLS LAST
         LIMIT 500`,
        [dbTenant.id],
      );
      json(res, 200, {
        capacities: rows.rows.map((r) => publicVehicleCapacity(r)),
      });
      return true;
    }

    const vehicleCapDevice = /^\/api\/dispatch\/vehicle-capacities\/device\/([0-9a-f-]{36})$/i.exec(
      url.pathname,
    );
    if (vehicleCapDevice && req.method === "PUT") {
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "manageDispatchSettings"))) return true;
      const trackerDeviceId = vehicleCapDevice[1];
      const device = await dbQuery(
        `SELECT id, armada_user_id FROM tracker_devices
         WHERE id = $1::uuid AND tenant_id = $2 AND enabled = true`,
        [trackerDeviceId, dbTenant.id],
      );
      if (!device.rows[0]) {
        json(res, 404, { error: "tracker device not found" });
        return true;
      }
      const body = await readJson(req);
      const parsed = await parseVehicleCapacityBody(body);
      if (parsed.error) {
        json(res, 400, { error: parsed.error });
        return true;
      }
      const linkedArmada =
        device.rows[0].armada_user_id != null && Number(device.rows[0].armada_user_id) > 0
          ? Number(device.rows[0].armada_user_id)
          : null;
      const r = await upsertVehicleCapacityRow({
        armadaUserId: linkedArmada,
        trackerDeviceId,
        ...parsed,
      });
      json(res, 200, { capacity: publicVehicleCapacity(r) });
      return true;
    }

    const vehicleCapOne = /^\/api\/dispatch\/vehicle-capacities\/(\d+)$/i.exec(url.pathname);
    if (vehicleCapOne && req.method === "PUT") {
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "manageDispatchSettings"))) return true;
      const armadaUserId = Number(vehicleCapOne[1]);
      if (!Number.isInteger(armadaUserId) || armadaUserId <= 0) {
        json(res, 400, { error: "Invalid armada user id" });
        return true;
      }
      const body = await readJson(req);
      const parsed = await parseVehicleCapacityBody(body);
      if (parsed.error) {
        json(res, 400, { error: parsed.error });
        return true;
      }
      const r = await upsertVehicleCapacityRow({
        armadaUserId,
        trackerDeviceId: null,
        ...parsed,
      });
      json(res, 200, { capacity: publicVehicleCapacity(r) });
      return true;
    }

    // —— Tenant depot (CVRP default / single) ——
    if (url.pathname === "/api/dispatch/depot" && req.method === "GET") {
      const depots = await listDepotsForTenant(dbTenant.id);
      const def = depots.find((d) => d.isDefault) || depots[0] || null;
      if (def) {
        json(res, 200, { depot: { lat: def.lat, lon: def.lon, id: def.id, name: def.name } });
        return true;
      }
      const row = await dbQuery(
        `SELECT dispatch_depot_lat, dispatch_depot_lon FROM tenants WHERE id = $1`,
        [dbTenant.id],
      );
      const r = row.rows[0] || {};
      const lat = r.dispatch_depot_lat == null ? null : Number(r.dispatch_depot_lat);
      const lon = r.dispatch_depot_lon == null ? null : Number(r.dispatch_depot_lon);
      json(res, 200, {
        depot:
          lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)
            ? { lat, lon }
            : null,
      });
      return true;
    }

    if (url.pathname === "/api/dispatch/depot" && req.method === "PUT") {
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "manageDispatchSettings"))) return true;
      const body = await readJson(req);
      const clear = body.depot === null || body.clear === true;
      if (clear) {
        await dbQuery(
          `UPDATE tenants SET dispatch_depot_lat = NULL, dispatch_depot_lon = NULL, updated_at = now()
           WHERE id = $1`,
          [dbTenant.id],
        );
        await dbQuery(
          `UPDATE dispatch_depots SET is_default = false, updated_at = now()
           WHERE tenant_id = $1 AND is_default = true`,
          [dbTenant.id],
        );
        json(res, 200, { depot: null });
        return true;
      }
      const lat = numOrNull(body.lat ?? body.depot?.lat);
      const lon = numOrNull(body.lon ?? body.depot?.lon);
      if (
        lat == null ||
        lon == null ||
        Math.abs(lat) > 90 ||
        Math.abs(lon) > 180
      ) {
        json(res, 400, { error: "Valid lat and lon required (or depot: null to clear)" });
        return true;
      }
      await syncTenantDefaultDepot(dbTenant.id, lat, lon);
      const name = String(body.name || body.depot?.name || "")
        .trim()
        .slice(0, 80);
      const existing = await dbQuery(
        `SELECT id, name FROM dispatch_depots WHERE tenant_id = $1 AND is_default = true LIMIT 1`,
        [dbTenant.id],
      );
      let depotRow;
      if (existing.rows[0]) {
        const upd = await dbQuery(
          name
            ? `UPDATE dispatch_depots SET lat = $1, lon = $2, name = $4, updated_at = now()
               WHERE id = $3
               RETURNING id, name, lat, lon, is_default, updated_at`
            : `UPDATE dispatch_depots SET lat = $1, lon = $2, updated_at = now()
               WHERE id = $3
               RETURNING id, name, lat, lon, is_default, updated_at`,
          name ? [lat, lon, existing.rows[0].id, name] : [lat, lon, existing.rows[0].id],
        );
        depotRow = upd.rows[0];
      } else {
        const ins = await dbQuery(
          `INSERT INTO dispatch_depots (tenant_id, name, lat, lon, is_default)
           VALUES ($1, $2, $3, $4, true)
           RETURNING id, name, lat, lon, is_default, updated_at`,
          [dbTenant.id, name || "Default", lat, lon],
        );
        depotRow = ins.rows[0];
      }
      json(res, 200, {
        depot: { lat, lon, id: depotRow.id, name: depotRow.name || name || "Default" },
      });
      return true;
    }

    // —— Named depots (multi-depot) ——
    if (url.pathname === "/api/dispatch/depots" && req.method === "GET") {
      const depots = await listDepotsForTenant(dbTenant.id);
      json(res, 200, { depots });
      return true;
    }

    if (url.pathname === "/api/dispatch/depots" && req.method === "POST") {
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "manageDispatchSettings"))) return true;
      const body = await readJson(req);
      const lat = numOrNull(body.lat);
      const lon = numOrNull(body.lon);
      if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        json(res, 400, { error: "Valid lat and lon required" });
        return true;
      }
      const name = String(body.name || "Depot").trim().slice(0, 80) || "Depot";
      const current = await listDepotsForTenant(dbTenant.id);
      if (current.length >= 20) {
        json(res, 400, { error: "Maximum 20 depots per tenant" });
        return true;
      }
      const makeDefault = body.isDefault === true || current.length === 0;
      if (makeDefault) {
        await dbQuery(
          `UPDATE dispatch_depots SET is_default = false, updated_at = now()
           WHERE tenant_id = $1 AND is_default = true`,
          [dbTenant.id],
        );
      }
      const ins = await dbQuery(
        `INSERT INTO dispatch_depots (tenant_id, name, lat, lon, is_default)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, lat, lon, is_default, updated_at`,
        [dbTenant.id, name, lat, lon, makeDefault],
      );
      if (makeDefault) {
        await syncTenantDefaultDepot(dbTenant.id, lat, lon);
      }
      json(res, 201, { depot: publicDepot(ins.rows[0]) });
      return true;
    }

    const depotOne = /^\/api\/dispatch\/depots\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (depotOne && req.method === "PATCH") {
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "manageDispatchSettings"))) return true;
      const depotId = depotOne[1];
      const body = await readJson(req);
      const existing = await dbQuery(
        `SELECT * FROM dispatch_depots WHERE id = $1 AND tenant_id = $2`,
        [depotId, dbTenant.id],
      );
      if (!existing.rows[0]) {
        json(res, 404, { error: "Depot not found" });
        return true;
      }
      const cur = existing.rows[0];
      const lat = body.lat != null ? numOrNull(body.lat) : Number(cur.lat);
      const lon = body.lon != null ? numOrNull(body.lon) : Number(cur.lon);
      if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        json(res, 400, { error: "Valid lat and lon required" });
        return true;
      }
      const name =
        body.name != null
          ? String(body.name).trim().slice(0, 80) || cur.name
          : cur.name;
      if (body.isDefault === true) {
        await clearOtherDefaultDepots(dbTenant.id, depotId);
        isDefault = true;
      }
      if (body.isDefault === false && isDefault) {
        // keep at least one default if this is the only depot
        const count = await dbQuery(
          `SELECT COUNT(*)::int AS n FROM dispatch_depots WHERE tenant_id = $1`,
          [dbTenant.id],
        );
        if ((count.rows[0]?.n || 0) > 1) isDefault = false;
      }
      const upd = await dbQuery(
        `UPDATE dispatch_depots
         SET name = $1, lat = $2, lon = $3, is_default = $4, updated_at = now()
         WHERE id = $5
         RETURNING id, name, lat, lon, is_default, updated_at`,
        [name, lat, lon, isDefault, depotId],
      );
      if (isDefault) {
        await syncTenantDefaultDepot(dbTenant.id, lat, lon);
      }
      json(res, 200, { depot: publicDepot(upd.rows[0]) });
      return true;
    }

    if (depotOne && req.method === "DELETE") {
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "manageDispatchSettings"))) return true;
      const depotId = depotOne[1];
      const existing = await dbQuery(
        `SELECT * FROM dispatch_depots WHERE id = $1 AND tenant_id = $2`,
        [depotId, dbTenant.id],
      );
      if (!existing.rows[0]) {
        json(res, 404, { error: "Depot not found" });
        return true;
      }
      const wasDefault = Boolean(existing.rows[0].is_default);
      await dbQuery(`DELETE FROM dispatch_depots WHERE id = $1`, [depotId]);
      if (wasDefault) {
        const next = await dbQuery(
          `SELECT id, lat, lon FROM dispatch_depots
           WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1`,
          [dbTenant.id],
        );
        if (next.rows[0]) {
          await dbQuery(
            `UPDATE dispatch_depots SET is_default = true, updated_at = now() WHERE id = $1`,
            [next.rows[0].id],
          );
          await syncTenantDefaultDepot(dbTenant.id, Number(next.rows[0].lat), Number(next.rows[0].lon));
        } else {
          await dbQuery(
            `UPDATE tenants SET dispatch_depot_lat = NULL, dispatch_depot_lon = NULL, updated_at = now()
             WHERE id = $1`,
            [dbTenant.id],
          );
        }
      }
      json(res, 200, { ok: true });
      return true;
    }

    // —— Optional zone → depot map ——
    if (url.pathname === "/api/dispatch/zone-depot-map" && req.method === "GET") {
      const mappings = await listZoneDepotMap(dbTenant.id);
      json(res, 200, { mappings });
      return true;
    }

    if (url.pathname === "/api/dispatch/zone-depot-map" && req.method === "PUT") {
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "manageDispatchSettings"))) return true;
      const body = await readJson(req);
      const raw = Array.isArray(body.mappings) ? body.mappings : [];
      const depots = await listDepotsForTenant(dbTenant.id);
      const depotIds = new Set(depots.map((d) => String(d.id)));
      /** @type {{ zoneKey: string, zoneLabel: string, depotId: string }[]} */
      const cleaned = [];
      const seen = new Set();
      for (const item of raw.slice(0, 200)) {
        const zoneLabel = String(item?.zone || item?.zoneLabel || "").trim().slice(0, 80);
        const zoneKey = normalizeZoneKey(item?.zoneKey || zoneLabel);
        const depotId = String(item?.depotId || "").trim();
        if (!zoneKey || !depotIds.has(depotId) || seen.has(zoneKey)) continue;
        seen.add(zoneKey);
        cleaned.push({ zoneKey, zoneLabel: zoneLabel || zoneKey, depotId });
      }
      await dbQuery(`DELETE FROM dispatch_zone_depot_map WHERE tenant_id = $1`, [dbTenant.id]);
      for (const m of cleaned) {
        await dbQuery(
          `INSERT INTO dispatch_zone_depot_map (tenant_id, zone_key, zone_label, depot_id)
           VALUES ($1, $2, $3, $4)`,
          [dbTenant.id, m.zoneKey, m.zoneLabel, m.depotId],
        );
      }
      const mappings = await listZoneDepotMap(dbTenant.id);
      json(res, 200, { mappings });
      return true;
    }

    // —— Orders ——
    if (url.pathname === "/api/dispatch/order-templates" && req.method === "GET") {
      const rows = await dbQuery(
        `SELECT * FROM dispatch_order_templates
         WHERE tenant_id = $1
         ORDER BY enabled DESC, customer_name ASC, updated_at DESC
         LIMIT 200`,
        [dbTenant.id],
      );
      json(res, 200, { templates: rows.rows.map(publicOrderTemplate) });
      return true;
    }

    if (url.pathname === "/api/dispatch/order-templates" && req.method === "POST") {
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "editDispatchOrders"))) return true;
      const body = await readJson(req);
      const customerName = String(body.customerName || body.name || "").trim().slice(0, 200);
      if (!customerName) {
        json(res, 400, { error: "customerName is required" });
        return true;
      }
      const lat = numOrNull(body.lat);
      const lon = numOrNull(body.lon ?? body.lng);
      if (lat == null || lon == null) {
        json(res, 400, { error: "lat and lon are required for a routine template" });
        return true;
      }
      const cadence = parseCadence(body.cadence);
      let weekday = body.weekday == null || body.weekday === "" ? null : Number(body.weekday);
      if (cadence === "weekly") {
        if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
          weekday = new Date().getDay();
        }
      } else {
        weekday = null;
      }
      const inserted = await dbQuery(
        `INSERT INTO dispatch_order_templates (
           tenant_id, enabled, cadence, weekday, external_ref, customer_name, address, lat, lon, zone,
           volume_m3, weight_kg, window_start, window_end, service_minutes, proof_required, notes
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING *`,
        [
          dbTenant.id,
          body.enabled !== false,
          cadence,
          weekday,
          String(body.externalRef || "").trim().slice(0, 80) || null,
          customerName,
          String(body.address || "").trim().slice(0, 500) || null,
          lat,
          lon,
          String(body.zone || "").trim().slice(0, 80) || null,
          numOrNull(body.volumeM3),
          numOrNull(body.weightKg),
          normalizeWindowClock(body.windowStart),
          normalizeWindowClock(body.windowEnd),
          serviceMinutesOrNull(body.serviceMinutes),
          body.proofRequired === true || body.proof_required === true,
          String(body.notes || "").trim().slice(0, 2000) || null,
        ],
      );
      json(res, 201, { template: publicOrderTemplate(inserted.rows[0]) });
      return true;
    }

    if (url.pathname === "/api/dispatch/order-templates/generate" && req.method === "POST") {
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "editDispatchOrders"))) return true;
      const body = await readJson(req);
      const serviceDate = parseServiceDate(body.serviceDate || body.date) || todayYmd();
      const templates = await dbQuery(
        `SELECT * FROM dispatch_order_templates
         WHERE tenant_id = $1 AND enabled = true
         ORDER BY customer_name ASC`,
        [dbTenant.id],
      );
      const created = [];
      const skipped = [];
      for (const tpl of templates.rows) {
        if (!templateMatchesDate(tpl, serviceDate)) {
          skipped.push({ templateId: tpl.id, reason: "cadence_mismatch" });
          continue;
        }
        const exists = await dbQuery(
          `SELECT id FROM dispatch_orders
           WHERE tenant_id = $1 AND template_id = $2 AND service_date = $3::date
             AND status <> 'cancelled'
           LIMIT 1`,
          [dbTenant.id, tpl.id, serviceDate],
        );
        if (exists.rows[0]) {
          skipped.push({ templateId: tpl.id, reason: "already_exists", orderId: exists.rows[0].id });
          continue;
        }
        const inserted = await dbQuery(
          `INSERT INTO dispatch_orders (
             tenant_id, external_ref, customer_name, address, lat, lon, zone,
             volume_m3, weight_kg, window_start, window_end, notes, service_date,
             service_minutes, proof_required, template_id, status
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'pending')
           RETURNING *`,
          [
            dbTenant.id,
            tpl.external_ref,
            tpl.customer_name,
            tpl.address,
            tpl.lat,
            tpl.lon,
            tpl.zone,
            tpl.volume_m3,
            tpl.weight_kg,
            tpl.window_start,
            tpl.window_end,
            tpl.notes,
            serviceDate,
            tpl.service_minutes,
            tpl.proof_required === true,
            tpl.id,
          ],
        );
        created.push(publicOrder(inserted.rows[0]));
      }
      json(res, 200, {
        serviceDate,
        created: created.length,
        skipped: skipped.length,
        orders: created,
        skipDetails: skipped,
      });
      return true;
    }

    const templateOne = /^\/api\/dispatch\/order-templates\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (templateOne && req.method === "PATCH") {
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "editDispatchOrders"))) return true;
      const existing = await dbQuery(
        `SELECT * FROM dispatch_order_templates WHERE id = $1 AND tenant_id = $2`,
        [templateOne[1], dbTenant.id],
      );
      if (!existing.rows[0]) {
        json(res, 404, { error: "Template not found" });
        return true;
      }
      const body = await readJson(req);
      const sets = [];
      const params = [];
      if ("enabled" in body) {
        params.push(body.enabled === true || body.enabled === "true");
        sets.push(`enabled = $${params.length}`);
      }
      if ("cadence" in body) {
        const cadence = parseCadence(body.cadence);
        params.push(cadence);
        sets.push(`cadence = $${params.length}`);
        if (cadence !== "weekly") {
          sets.push(`weekday = NULL`);
        } else if (!("weekday" in body)) {
          const w = existing.rows[0].weekday;
          params.push(w == null ? new Date().getDay() : Number(w));
          sets.push(`weekday = $${params.length}`);
        }
      }
      if ("weekday" in body) {
        const w = body.weekday == null || body.weekday === "" ? null : Number(body.weekday);
        params.push(Number.isInteger(w) && w >= 0 && w <= 6 ? w : null);
        sets.push(`weekday = $${params.length}`);
      }
      const map = {
        externalRef: ["external_ref", (v) => String(v || "").trim().slice(0, 80) || null],
        customerName: ["customer_name", (v) => String(v || "").trim().slice(0, 200)],
        address: ["address", (v) => String(v || "").trim().slice(0, 500) || null],
        zone: ["zone", (v) => String(v || "").trim().slice(0, 80) || null],
        notes: ["notes", (v) => String(v || "").trim().slice(0, 2000) || null],
        windowStart: ["window_start", (v) => normalizeWindowClock(v)],
        windowEnd: ["window_end", (v) => normalizeWindowClock(v)],
      };
      for (const [key, [col, fn]] of Object.entries(map)) {
        if (key in body) {
          const val = fn(body[key]);
          if (key === "customerName" && !val) {
            json(res, 400, { error: "customerName cannot be empty" });
            return true;
          }
          params.push(val);
          sets.push(`${col} = $${params.length}`);
        }
      }
      if ("lat" in body) {
        params.push(numOrNull(body.lat));
        sets.push(`lat = $${params.length}`);
      }
      if ("lon" in body || "lng" in body) {
        params.push(numOrNull(body.lon ?? body.lng));
        sets.push(`lon = $${params.length}`);
      }
      if ("volumeM3" in body) {
        params.push(numOrNull(body.volumeM3));
        sets.push(`volume_m3 = $${params.length}`);
      }
      if ("weightKg" in body) {
        params.push(numOrNull(body.weightKg));
        sets.push(`weight_kg = $${params.length}`);
      }
      if ("serviceMinutes" in body) {
        params.push(serviceMinutesOrNull(body.serviceMinutes));
        sets.push(`service_minutes = $${params.length}`);
      }
      if ("proofRequired" in body || "proof_required" in body) {
        params.push(body.proofRequired === true || body.proof_required === true);
        sets.push(`proof_required = $${params.length}`);
      }
      if (!sets.length) {
        json(res, 400, { error: "No fields to update" });
        return true;
      }
      sets.push(`updated_at = now()`);
      params.push(templateOne[1], dbTenant.id);
      const updated = await dbQuery(
        `UPDATE dispatch_order_templates SET ${sets.join(", ")}
         WHERE id = $${params.length - 1} AND tenant_id = $${params.length}
         RETURNING *`,
        params,
      );
      json(res, 200, { template: publicOrderTemplate(updated.rows[0]) });
      return true;
    }

    if (templateOne && req.method === "DELETE") {
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "editDispatchOrders"))) return true;
      const deleted = await dbQuery(
        `DELETE FROM dispatch_order_templates WHERE id = $1 AND tenant_id = $2 RETURNING id`,
        [templateOne[1], dbTenant.id],
      );
      if (!deleted.rows[0]) {
        json(res, 404, { error: "Template not found" });
        return true;
      }
      json(res, 200, { ok: true });
      return true;
    }

    if (url.pathname === "/api/dispatch/run-numbers" && req.method === "GET") {
      const date = parseServiceDate(url.searchParams.get("date")) || todayYmd();
      const jobs = await dbQuery(
        `SELECT title AS value FROM dispatch_jobs
         WHERE tenant_id = $1 AND service_date = $2::date`,
        [dbTenant.id, date],
      );
      const orders = await dbQuery(
        `SELECT external_ref AS value FROM dispatch_orders
         WHERE tenant_id = $1 AND service_date = $2::date AND external_ref IS NOT NULL`,
        [dbTenant.id, date],
      );
      json(res, 200, {
        jobTitles: jobs.rows.map((row) => String(row.value || "")),
        orderRefs: orders.rows.map((row) => String(row.value || "")),
      });
      return true;
    }

    if (url.pathname === "/api/dispatch/orders" && req.method === "GET") {
      const status = String(url.searchParams.get("status") || "pending").toLowerCase();
      const date = parseServiceDate(url.searchParams.get("date")) || todayYmd();
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
      const clauses = ["tenant_id = $1", "service_date = $2::date"];
      const params = [dbTenant.id, date];
      if (status === "open" || status === "pending") {
        clauses.push(`status = 'pending'`);
      } else if (ORDER_STATUSES.includes(status)) {
        params.push(status);
        clauses.push(`status = $${params.length}`);
      } else if (status !== "all") {
        json(res, 400, { error: "Invalid order status filter" });
        return true;
      }
      params.push(limit);
      const rows = await dbQuery(
        `SELECT * FROM dispatch_orders
         WHERE ${clauses.join(" AND ")}
         ORDER BY updated_at DESC
         LIMIT $${params.length}`,
        params,
      );
      json(res, 200, {
        orders: await decorateOrdersWithLines(dbTenant.id, rows.rows.map(publicOrder)),
        serviceDate: date,
      });
      return true;
    }

    if (url.pathname === "/api/dispatch/orders" && req.method === "POST") {
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "editDispatchOrders"))) return true;
      const body = await readJson(req);
      const customerName = String(body.customerName || body.name || "").trim().slice(0, 200);
      if (!customerName) {
        json(res, 400, { error: "customerName is required" });
        return true;
      }
      const lat = numOrNull(body.lat);
      const lon = numOrNull(body.lon ?? body.lng);
      const serviceDate = parseServiceDate(body.serviceDate) || todayYmd();
      const kind = parseOrderKind(body.kind);
      if (kind === "pickup_drop") {
        const pLat = numOrNull(body.pickupLat);
        const pLon = numOrNull(body.pickupLon);
        if (pLat == null || pLon == null) {
          json(res, 400, { error: "pickup_drop orders require pickupLat and pickupLon" });
          return true;
        }
      }
      const orderProfile = parseOrderProfile(body.profile) || "cargo";
      const cargo =
        orderProfile === "passenger"
          ? orderCargoFromBody({ ...body, profile: "passenger" })
          : orderProfile === "sales"
            ? { volumeM3: null, weightKg: null, passengerCount: null, luggageKg: null }
            : orderCargoFromBody(body);
      const inserted = await dbQuery(
        `INSERT INTO dispatch_orders (
           tenant_id, external_ref, customer_name, address, lat, lon, zone,
           volume_m3, weight_kg, passenger_count, luggage_kg, profile,
           window_start, window_end, notes, service_date, service_minutes, proof_required,
           kind, pickup_address, pickup_lat, pickup_lon, pickup_zone,
           pickup_window_start, pickup_window_end, pickup_service_minutes, pickup_proof_required,
           cargo_totals_locked
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
         RETURNING *`,
        [
          dbTenant.id,
          String(body.externalRef || "").trim().slice(0, 80) || null,
          customerName,
          String(body.address || "").trim().slice(0, 500) || null,
          lat,
          lon,
          String(body.zone || "").trim().slice(0, 80) || null,
          cargo.volumeM3,
          cargo.weightKg,
          cargo.passengerCount,
          cargo.luggageKg,
          orderProfile === "cargo" ? null : orderProfile,
          normalizeWindowClock(body.windowStart),
          normalizeWindowClock(body.windowEnd),
          String(body.notes || "").trim().slice(0, 2000) || null,
          serviceDate,
          serviceMinutesOrNull(body.serviceMinutes),
          body.proofRequired === true || body.proof_required === true,
          parseOrderKind(body.kind),
          String(body.pickupAddress || "").trim().slice(0, 500) || null,
          numOrNull(body.pickupLat),
          numOrNull(body.pickupLon),
          String(body.pickupZone || "").trim().slice(0, 80) || null,
          normalizeWindowClock(body.pickupWindowStart),
          normalizeWindowClock(body.pickupWindowEnd),
          serviceMinutesOrNull(body.pickupServiceMinutes),
          body.pickupProofRequired === true,
          body.cargoTotalsLocked === true,
        ],
      );
      const created = inserted.rows[0];
      if (Array.isArray(body.lines)) {
        await replaceOrderLines(dbTenant.id, created.id, body.lines);
      }
      if (body.cargoTotalsLocked === true) {
        await setCargoTotalsLocked(dbTenant.id, created.id, true);
      } else {
        await applyCargoTotals(dbTenant.id, created.id, { locked: false });
      }
      const customerId = /^[0-9a-f-]{36}$/i.test(String(body.customerId || "")) ? String(body.customerId) : null;
      if (customerId) {
        await dbQuery(
          `UPDATE dispatch_orders SET customer_id = $1 WHERE id = $2 AND tenant_id = $3`,
          [customerId, created.id, dbTenant.id],
        );
      }
      const sourceDepotId = /^[0-9a-f-]{36}$/i.test(String(body.sourceDepotId || ""))
        ? String(body.sourceDepotId)
        : null;
      if (sourceDepotId) {
        const depotOk = await dbQuery(
          `SELECT id FROM dispatch_depots WHERE id = $1 AND tenant_id = $2`,
          [sourceDepotId, dbTenant.id],
        );
        if (!depotOk.rows[0]) {
          json(res, 400, { error: "Unknown sourceDepotId" });
          return true;
        }
        await dbQuery(
          `UPDATE dispatch_orders SET source_depot_id = $1 WHERE id = $2 AND tenant_id = $3`,
          [sourceDepotId, created.id, dbTenant.id],
        );
      }
      const fresh = await dbQuery(`SELECT * FROM dispatch_orders WHERE id = $1`, [created.id]);
      json(res, 201, { order: await publicOrderWithLines(dbTenant.id, fresh.rows[0] || created) });
      return true;
    }

    if (url.pathname === "/api/dispatch/orders/import" && req.method === "POST") {
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "editDispatchOrders"))) return true;
      const body = await readJson(req);
      const defaultDate = parseServiceDate(body.serviceDate) || todayYmd();
      let rawRows = Array.isArray(body.rows) ? body.rows : null;
      if (!rawRows && typeof body.csv === "string") {
        rawRows = parseCsv(body.csv).rows;
      }
      if (!rawRows || !rawRows.length) {
        json(res, 400, { error: "rows or csv required" });
        return true;
      }
      if (rawRows.length > 200) {
        json(res, 400, { error: "Maximum 200 rows per import" });
        return true;
      }

      const created = [];
      const skipped = [];
      const errors = [];
      const customers = await listCustomers(dbTenant.id);
      const customersByName = new Map();
      for (const customer of customers) {
        if (customer.enabled === false) continue;
        const key = customer.name.trim().toLowerCase();
        if (key && !customersByName.has(key)) customersByName.set(key, customer);
      }

      for (let i = 0; i < rawRows.length; i++) {
        const row = rawRows[i] && typeof rawRows[i] === "object" ? rawRows[i] : {};
        const line = i + 2; // header is line 1
        const customerName = String(
          row.customer_name || row.customerName || row.name || "",
        )
          .trim()
          .slice(0, 200);
        if (!customerName) {
          errors.push({ line, error: "customer_name is required" });
          continue;
        }
        const known = customersByName.get(customerName.toLowerCase()) || null;
        let lat = csvNum(row.lat);
        let lon = csvNum(row.lon ?? row.lng);
        if (known) {
          if (lat == null) lat = known.lat;
          if (lon == null) lon = known.lon;
        }
        if (
          lat == null ||
          lon == null ||
          Math.abs(lat) > 90 ||
          Math.abs(lon) > 180
        ) {
          errors.push({
            line,
            error: known
              ? "valid lat and lon are required"
              : `No customer named "${customerName}", so lat and lon are required`,
          });
          continue;
        }
        const serviceDate = parseServiceDate(row.service_date || row.serviceDate) || defaultDate;
        const externalRef = String(row.external_ref || row.externalRef || "")
          .trim()
          .slice(0, 80);
        if (externalRef) {
          const dup = await dbQuery(
            `SELECT id FROM dispatch_orders
             WHERE tenant_id = $1 AND service_date = $2::date
               AND external_ref = $3 AND status = 'pending'
             LIMIT 1`,
            [dbTenant.id, serviceDate, externalRef],
          );
          if (dup.rows[0]) {
            skipped.push({
              line,
              reason: "duplicate external_ref for date",
              externalRef,
              orderId: dup.rows[0].id,
            });
            continue;
          }
        }
        const csvText = (value, max) => String(value || "").trim().slice(0, max);
        const address =
          csvText(row.address, 500) ||
          (known ? csvText(known.address, 500) : "") ||
          null;
        const zone = csvText(row.zone, 80) || (known ? csvText(known.zone, 80) : "") || null;
        const notes = csvText(row.notes, 2000) || (known ? csvText(known.notes, 2000) : "") || null;
        const windowStart =
          csvText(row.window_start || row.windowStart, 16) ||
          (known ? csvText(known.windowStart, 16) : "") ||
          null;
        const windowEnd =
          csvText(row.window_end || row.windowEnd, 16) ||
          (known ? csvText(known.windowEnd, 16) : "") ||
          null;
        const proofCell = row.proof_required ?? row.proofRequired;
        const proofRequired =
          proofCell == null || String(proofCell).trim() === ""
            ? Boolean(known?.proofRequired)
            : csvBool(proofCell);
        const orderProfile = resolveOrderCsvProfile(row);
        const cargo = cargoFromOrderCsvRow(row, orderProfile);
        const pickup = pickupFromOrderCsvRow(row);
        if (pickup.error) {
          errors.push({ line, error: pickup.error });
          continue;
        }
        try {
          const inserted = await dbQuery(
            `INSERT INTO dispatch_orders (
               tenant_id, external_ref, customer_name, address, lat, lon, zone,
               volume_m3, weight_kg, passenger_count, luggage_kg, profile,
               window_start, window_end, notes, service_date,
               service_minutes, proof_required,
               kind, pickup_address, pickup_lat, pickup_lon, pickup_zone
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
             RETURNING *`,
            [
              dbTenant.id,
              externalRef || null,
              customerName,
              address,
              lat,
              lon,
              zone,
              cargo.volumeM3,
              cargo.weightKg,
              cargo.passengerCount,
              cargo.luggageKg,
              orderProfile === "cargo" ? null : orderProfile,
              windowStart,
              windowEnd,
              notes,
              serviceDate,
              serviceMinutesOrNull(row.service_minutes ?? row.serviceMinutes),
              proofRequired,
              pickup.kind,
              pickup.pickupAddress,
              pickup.pickupLat,
              pickup.pickupLon,
              pickup.pickupZone,
            ],
          );
          if (known?.id) {
            await dbQuery(
              `UPDATE dispatch_orders SET customer_id = $1 WHERE id = $2 AND tenant_id = $3`,
              [known.id, inserted.rows[0].id, dbTenant.id],
            );
          }
          if (orderCsvAllowsGoodsLines(orderProfile)) {
            const goodsCell = row.goods || row.cargo || "";
            const lines = await resolveCsvGoodsLines(dbTenant.id, goodsCell, row);
            if (lines.length) {
              await replaceOrderLines(dbTenant.id, inserted.rows[0].id, lines);
              const hasManualTotals =
                csvNum(row.volume_m3 ?? row.volumeM3) != null ||
                csvNum(row.weight_kg ?? row.weightKg) != null;
              if (hasManualTotals) {
                await setCargoTotalsLocked(dbTenant.id, inserted.rows[0].id, true);
              } else {
                await applyCargoTotals(dbTenant.id, inserted.rows[0].id, { locked: false });
              }
            }
          }
          const fresh = await dbQuery(`SELECT * FROM dispatch_orders WHERE id = $1`, [
            inserted.rows[0].id,
          ]);
          created.push(await publicOrderWithLines(dbTenant.id, fresh.rows[0] || inserted.rows[0]));
        } catch (err) {
          errors.push({
            line,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      json(res, 200, {
        created: created.length,
        skipped: skipped.length,
        errors: errors.length,
        orders: created,
        skippedRows: skipped,
        errorRows: errors,
        serviceDate: defaultDate,
      });
      return true;
    }

    if (url.pathname === "/api/dispatch/orders/carry-over" && req.method === "POST") {
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "editDispatchOrders"))) return true;
      const body = await readJson(req);
      const fromDate = parseServiceDate(body.fromDate || body.serviceDate) || todayYmd();
      let toDate = parseServiceDate(body.toDate);
      if (!toDate) toDate = addDays(fromDate, 1);
      if (toDate < fromDate) {
        json(res, 400, { error: "toDate cannot be before fromDate" });
        return true;
      }
      const rawIds = Array.isArray(body.orderIds) ? body.orderIds : null;
      const orderIds = rawIds
        ? rawIds
            .map((id) => String(id || "").trim())
            .filter((id) => /^[0-9a-f-]{36}$/i.test(id))
            .slice(0, 200)
        : null;

      let updated;
      if (orderIds && orderIds.length) {
        updated = await dbQuery(
          `UPDATE dispatch_orders
           SET service_date = $1::date, updated_at = now()
           WHERE tenant_id = $2
             AND status = 'pending'
             AND service_date = $3::date
             AND id = ANY($4::uuid[])
           RETURNING *`,
          [toDate, dbTenant.id, fromDate, orderIds],
        );
      } else {
        updated = await dbQuery(
          `UPDATE dispatch_orders
           SET service_date = $1::date, updated_at = now()
           WHERE tenant_id = $2
             AND status = 'pending'
             AND service_date = $3::date
           RETURNING *`,
          [toDate, dbTenant.id, fromDate],
        );
      }
      json(res, 200, {
        fromDate,
        toDate,
        moved: updated.rows.length,
        orders: updated.rows.map(publicOrder),
      });
      return true;
    }

    const orderOne = /^\/api\/dispatch\/orders\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (orderOne && req.method === "PATCH") {
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "editDispatchOrders"))) return true;
      const existing = await dbQuery(
        `SELECT * FROM dispatch_orders WHERE id = $1 AND tenant_id = $2`,
        [orderOne[1], dbTenant.id],
      );
      if (!existing.rows[0]) {
        json(res, 404, { error: "Order not found" });
        return true;
      }
      const body = await readJson(req);
      const sets = [];
      const params = [];
      const map = {
        externalRef: ["external_ref", (v) => String(v || "").trim().slice(0, 80) || null],
        customerName: ["customer_name", (v) => String(v || "").trim().slice(0, 200)],
        address: ["address", (v) => String(v || "").trim().slice(0, 500) || null],
        zone: ["zone", (v) => String(v || "").trim().slice(0, 80) || null],
        notes: ["notes", (v) => String(v || "").trim().slice(0, 2000) || null],
        customerId: [
          "customer_id",
          (v) => (/^[0-9a-f-]{36}$/i.test(String(v || "")) ? String(v) : null),
        ],
        sourceDepotId: [
          "source_depot_id",
          (v) => (/^[0-9a-f-]{36}$/i.test(String(v || "")) ? String(v) : null),
        ],
        windowStart: ["window_start", (v) => normalizeWindowClock(v)],
        windowEnd: ["window_end", (v) => normalizeWindowClock(v)],
      };
      for (const [key, [col, fn]] of Object.entries(map)) {
        if (key in body) {
          const val = fn(body[key]);
          if (key === "customerName" && !val) {
            json(res, 400, { error: "customerName cannot be empty" });
            return true;
          }
          params.push(val);
          sets.push(`${col} = $${params.length}`);
        }
      }
      if ("serviceDate" in body) {
        const sd = parseServiceDate(body.serviceDate);
        if (!sd) {
          json(res, 400, { error: "Invalid serviceDate (use YYYY-MM-DD)" });
          return true;
        }
        params.push(sd);
        sets.push(`service_date = $${params.length}`);
      }
      if ("lat" in body) {
        params.push(numOrNull(body.lat));
        sets.push(`lat = $${params.length}`);
      }
      if ("lon" in body || "lng" in body) {
        params.push(numOrNull(body.lon ?? body.lng));
        sets.push(`lon = $${params.length}`);
      }
      if ("profile" in body) {
        const orderProfile = parseOrderProfile(body.profile) || "cargo";
        params.push(orderProfile === "cargo" ? null : orderProfile);
        sets.push(`profile = $${params.length}`);
      }
      if (
        "passengerCount" in body ||
        "passenger_count" in body ||
        "luggageKg" in body ||
        "luggage_kg" in body ||
        String(body.profile || "").toLowerCase() === "passenger"
      ) {
        const cargo = orderCargoFromBody(body);
        params.push(cargo.volumeM3);
        sets.push(`volume_m3 = $${params.length}`);
        params.push(cargo.weightKg);
        sets.push(`weight_kg = $${params.length}`);
        params.push(cargo.passengerCount);
        sets.push(`passenger_count = $${params.length}`);
        params.push(cargo.luggageKg);
        sets.push(`luggage_kg = $${params.length}`);
      } else if (String(body.profile || "").toLowerCase() === "sales") {
        params.push(null);
        sets.push(`volume_m3 = $${params.length}`);
        params.push(null);
        sets.push(`weight_kg = $${params.length}`);
      } else {
        if ("volumeM3" in body) {
          params.push(numOrNull(body.volumeM3));
          sets.push(`volume_m3 = $${params.length}`);
        }
        if ("weightKg" in body) {
          params.push(numOrNull(body.weightKg));
          sets.push(`weight_kg = $${params.length}`);
        }
      }
      if ("serviceMinutes" in body) {
        params.push(serviceMinutesOrNull(body.serviceMinutes));
        sets.push(`service_minutes = $${params.length}`);
      }
      if ("proofRequired" in body || "proof_required" in body) {
        params.push(body.proofRequired === true || body.proof_required === true);
        sets.push(`proof_required = $${params.length}`);
      }
      if ("kind" in body) {
        params.push(parseOrderKind(body.kind));
        sets.push(`kind = $${params.length}`);
      }
      if ("pickupAddress" in body) {
        params.push(String(body.pickupAddress || "").trim().slice(0, 500) || null);
        sets.push(`pickup_address = $${params.length}`);
      }
      if ("pickupLat" in body) {
        params.push(numOrNull(body.pickupLat));
        sets.push(`pickup_lat = $${params.length}`);
      }
      if ("pickupLon" in body) {
        params.push(numOrNull(body.pickupLon));
        sets.push(`pickup_lon = $${params.length}`);
      }
      if ("pickupZone" in body) {
        params.push(String(body.pickupZone || "").trim().slice(0, 80) || null);
        sets.push(`pickup_zone = $${params.length}`);
      }
      if ("pickupWindowStart" in body) {
        params.push(normalizeWindowClock(body.pickupWindowStart));
        sets.push(`pickup_window_start = $${params.length}`);
      }
      if ("pickupWindowEnd" in body) {
        params.push(normalizeWindowClock(body.pickupWindowEnd));
        sets.push(`pickup_window_end = $${params.length}`);
      }
      if ("pickupServiceMinutes" in body) {
        params.push(serviceMinutesOrNull(body.pickupServiceMinutes));
        sets.push(`pickup_service_minutes = $${params.length}`);
      }
      if ("pickupProofRequired" in body) {
        params.push(body.pickupProofRequired === true);
        sets.push(`pickup_proof_required = $${params.length}`);
      }
      if ("cargoTotalsLocked" in body) {
        params.push(body.cargoTotalsLocked === true);
        sets.push(`cargo_totals_locked = $${params.length}`);
      }
      if ("status" in body) {
        const st = String(body.status || "").toLowerCase();
        if (!ORDER_STATUSES.includes(st)) {
          json(res, 400, { error: "Invalid order status" });
          return true;
        }
        params.push(st);
        sets.push(`status = $${params.length}`);
        if (st === "cancelled" || st === "pending") {
          if (existing.rows[0].stop_id || existing.rows[0].job_id) {
            await detachOrderFromJob(existing.rows[0]);
          }
          sets.push(`job_id = NULL`);
          sets.push(`stop_id = NULL`);
        }
      }
      const nextKind = "kind" in body ? parseOrderKind(body.kind) : parseOrderKind(existing.rows[0].kind);
      if (nextKind === "pickup_drop") {
        const pLat = "pickupLat" in body ? numOrNull(body.pickupLat) : existing.rows[0].pickup_lat;
        const pLon = "pickupLon" in body ? numOrNull(body.pickupLon) : existing.rows[0].pickup_lon;
        if (pLat == null || pLon == null) {
          json(res, 400, { error: "pickup_drop orders require pickupLat and pickupLon" });
          return true;
        }
      }
      if (!sets.length && !Array.isArray(body.lines)) {
        json(res, 400, { error: "No fields to update" });
        return true;
      }
      let row = existing.rows[0];
      if (sets.length) {
        sets.push(`updated_at = now()`);
        params.push(orderOne[1], dbTenant.id);
        const updated = await dbQuery(
          `UPDATE dispatch_orders SET ${sets.join(", ")}
           WHERE id = $${params.length - 1} AND tenant_id = $${params.length}
           RETURNING *`,
          params,
        );
        row = updated.rows[0];
      }
      if (Array.isArray(body.lines)) {
        await replaceOrderLines(dbTenant.id, row.id, body.lines);
      }
      const locked =
        body.cargoTotalsLocked === true ||
        (body.cargoTotalsLocked !== false && row.cargo_totals_locked === true);
      if (!locked) {
        await applyCargoTotals(dbTenant.id, row.id, { locked: false });
      }
      const fresh = await dbQuery(
        `SELECT * FROM dispatch_orders WHERE id = $1 AND tenant_id = $2`,
        [row.id, dbTenant.id],
      );
      row = fresh.rows[0] || row;
      // Keep linked stop in sync when dispatcher edits an assigned order
      if (row.stop_id && row.status === "assigned") {
        await dbQuery(
          `UPDATE dispatch_stops SET
             name = COALESCE($1, name),
             address = $2,
             lat = $3,
             lon = $4,
             zone = $5,
             volume_m3 = $6,
             weight_kg = $7,
             window_start = $8,
             window_end = $9,
             notes = $10,
             service_minutes = $11,
             proof_required = $12
           WHERE id = $13`,
          [
            row.customer_name || row.external_ref || null,
            row.address,
            row.lat,
            row.lon,
            row.zone,
            row.volume_m3,
            row.weight_kg,
            row.window_start,
            row.window_end,
            row.notes,
            row.service_minutes,
            row.proof_required === true,
            row.stop_id,
          ],
        );
      }
      json(res, 200, { order: await publicOrderWithLines(dbTenant.id, row) });
      return true;
    }

    if (orderOne && req.method === "DELETE") {
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "editDispatchOrders"))) return true;
      const existing = await dbQuery(
        `SELECT * FROM dispatch_orders WHERE id = $1 AND tenant_id = $2`,
        [orderOne[1], dbTenant.id],
      );
      if (!existing.rows[0]) {
        json(res, 404, { error: "Order not found" });
        return true;
      }
      await detachOrderFromJob(existing.rows[0]);
      await dbQuery(`DELETE FROM dispatch_orders WHERE id = $1 AND tenant_id = $2`, [
        orderOne[1],
        dbTenant.id,
      ]);
      json(res, 200, { ok: true, id: orderOne[1] });
      return true;
    }

    // —— Photos ——
    const stopPhotos = /^\/api\/dispatch\/stops\/([0-9a-f-]{36})\/photos$/i.exec(url.pathname);
    if (stopPhotos && req.method === "GET") {
      const ok = await dbQuery(
        `SELECT s.id FROM dispatch_stops s
         JOIN dispatch_jobs j ON j.id = s.job_id
         WHERE s.id = $1 AND j.tenant_id = $2`,
        [stopPhotos[1], dbTenant.id],
      );
      if (!ok.rows[0]) {
        json(res, 404, { error: "Stop not found" });
        return true;
      }
      const rows = await dbQuery(
        `SELECT id, stop_id, content_type, bytes, caption, created_at
         FROM dispatch_stop_photos WHERE stop_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [stopPhotos[1]],
      );
      json(res, 200, { photos: rows.rows.map((r) => publicDispatchPhoto(r)) });
      return true;
    }

    const photoGet = /^\/api\/dispatch\/photos\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (photoGet && req.method === "GET") {
      const loaded = await loadDispatchPhotoBytes(photoGet[1], dbTenant.id);
      if (!loaded) {
        json(res, 404, { error: "Photo not found" });
        return true;
      }
      send(
        res,
        200,
        {
          "Content-Type": loaded.contentType,
          "Cache-Control": "private, max-age=3600",
        },
        loaded.body,
      );
      return true;
    }

    // —— Jobs ——
    if (url.pathname === "/api/dispatch/live" && req.method === "GET") {
      const date = parseServiceDate(url.searchParams.get("date")) || todayYmd();
      const vault = tenantFromRequest(req);
      const deviceGroupIds = [
        ...url.searchParams.getAll("deviceGroupId"),
        ...url.searchParams.getAll("groupId").filter((id) => /^[0-9a-f-]{36}$/i.test(id)),
        ...String(url.searchParams.get("deviceGroupIds") || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ].filter((id, i, arr) => id && arr.indexOf(id) === i);
      const snapshot = await buildDispatchLiveSnapshot({
        tenantId: dbTenant.id,
        serviceDate: date,
        vaultTenant: vault,
        deviceGroupIds,
      });
      json(res, 200, snapshot);
      return true;
    }

    if (url.pathname === "/api/dispatch/phone-trail" && req.method === "GET") {
      const fieldUserId = String(url.searchParams.get("fieldUserId") || "").trim();
      const date = parseServiceDate(url.searchParams.get("date")) || todayYmd();
      if (!/^[0-9a-f-]{36}$/i.test(fieldUserId)) {
        json(res, 400, { error: "fieldUserId required" });
        return true;
      }
      const owned = await dbQuery(
        `SELECT id FROM field_users WHERE id = $1 AND tenant_id = $2`,
        [fieldUserId, dbTenant.id],
      );
      if (!owned.rows[0]) {
        json(res, 404, { error: "Field user not found" });
        return true;
      }
      const trailRaw = await pingTrailForServiceDate(dbTenant.id, fieldUserId, date);
      const timed = trailRaw.map((p) => ({
        lat: Number(p.lat),
        lon: Number(p.lon),
        recordedAt: p.recordedAt,
      })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && p.recordedAt);
      // Cap timed payload for map clients that clip to job windows.
      const max = 800;
      let slimTimed = timed;
      if (timed.length > max) {
        const step = (timed.length - 1) / (max - 1);
        slimTimed = [];
        for (let i = 0; i < max; i++) slimTimed.push(timed[Math.round(i * step)]);
      }
      const trail = slimTimed.map((p) => [p.lat, p.lon]);
      json(res, 200, { trail, points: slimTimed, date, fieldUserId });
      return true;
    }

    if (url.pathname === "/api/dispatch/device-day-tracks" && req.method === "POST") {
      const source = await tenantTelematicsSource(dbTenant.id);
      if (!telematicsUsesDevices(source)) {
        json(res, 200, { tracks: {}, telematicsSource: source });
        return true;
      }
      const body = await readJson(req);
      const days = Array.isArray(body.days) ? body.days : [];
      const map = await deviceTrailsByArmadaDays(dbTenant.id, days);
      /** @type {Record<string, Array<{ lat: number, lon: number, recordedAt: string }>>} */
      const tracks = {};
      for (const [key, pts] of map) {
        const max = 800;
        let slim = pts;
        if (pts.length > max) {
          const step = (pts.length - 1) / (max - 1);
          slim = [];
          for (let i = 0; i < max; i++) slim.push(pts[Math.round(i * step)]);
        }
        tracks[key] = slim;
      }
      json(res, 200, { tracks, telematicsSource: source });
      return true;
    }

    if (url.pathname === "/api/dispatch/sla" && req.method === "GET") {
      const date = parseServiceDate(url.searchParams.get("date")) || todayYmd();
      const vault = tenantFromRequest(req);
      const deviceGroupIds = [
        ...url.searchParams.getAll("deviceGroupId"),
        ...url.searchParams.getAll("groupId").filter((id) => /^[0-9a-f-]{36}$/i.test(id)),
        ...String(url.searchParams.get("deviceGroupIds") || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ].filter((id, i, arr) => id && arr.indexOf(id) === i);
      const snapshot = await buildDispatchLiveSnapshot({
        tenantId: dbTenant.id,
        serviceDate: date,
        vaultTenant: vault,
        deviceGroupIds,
      });
      json(res, 200, {
        sla: snapshot.sla || computeSlaFromSnapshot(snapshot),
        exceptionSummary: snapshot.exceptionSummary || null,
      });
      return true;
    }

    if (url.pathname === "/api/dispatch/ops-exceptions" && req.method === "GET") {
      const date = parseServiceDate(url.searchParams.get("date")) || todayYmd();
      const status = String(url.searchParams.get("status") || "open").toLowerCase();
      let sql = `SELECT * FROM dispatch_ops_exceptions
         WHERE tenant_id = $1 AND service_date = $2::date`;
      if (status === "open") sql += ` AND resolved_at IS NULL`;
      else if (status === "acked") sql += ` AND acked_at IS NOT NULL AND resolved_at IS NULL`;
      else if (status === "resolved") sql += ` AND resolved_at IS NOT NULL`;
      sql += ` ORDER BY created_at DESC LIMIT 200`;
      const rows = await dbQuery(sql, [dbTenant.id, date]);
      json(res, 200, {
        serviceDate: date,
        exceptions: rows.rows.map(publicOpsException),
      });
      return true;
    }

    const opsAck = /^\/api\/dispatch\/ops-exceptions\/([0-9a-f-]{36})\/ack$/i.exec(
      url.pathname,
    );
    if (opsAck && req.method === "POST") {
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "editDispatchLive"))) return true;
      const body = await readJson(req);
      const row = await ackOpsException(dbTenant.id, opsAck[1], body.note || "");
      if (!row) {
        json(res, 404, { error: "Exception not found" });
        return true;
      }
      json(res, 200, { exception: row });
      return true;
    }

    if (url.pathname === "/api/dispatch/replan-remaining" && req.method === "POST") {
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "editDispatchLive"))) return true;
      const body = await readJson(req);
      const serviceDate = parseServiceDate(body.serviceDate || body.date) || todayYmd();
      const apply = body.apply === true;
      const autoSafe = body.autoSafe === true || body.autoSafeOnly === true;
      const jobIds = Array.isArray(body.jobIds) ? body.jobIds : [];
      const suggestionIds = Array.isArray(body.suggestionIds) ? body.suggestionIds : null;
      let routing = parseRoutingOptions({
        routing: body.routing && typeof body.routing === "object" ? body.routing : {},
      });
      const vault = tenantFromRequest(req);
      const deviceGroupIds = [
        ...(Array.isArray(body.deviceGroupIds) ? body.deviceGroupIds : []),
        body.deviceGroupId,
      ]
        .map((id) => String(id || "").trim())
        .filter((id) => /^[0-9a-f-]{36}$/i.test(id));
      let posMap = new Map();
      try {
        posMap = await buildTelematicsPosMap(dbTenant.id, vault || {}, {
          groupIds: deviceGroupIds.length ? deviceGroupIds : undefined,
        });
      } catch {
        posMap = new Map();
      }
      const preview = await buildReplanRemainingPreview(dbTenant.id, {
        serviceDate,
        jobIds,
        posMap,
        routing,
      });
      if (!apply) {
        json(res, 200, { preview, apply: false });
        return true;
      }
      const result = await applyReplanSuggestions(dbTenant.id, {
        serviceDate,
        preview,
        suggestionIds: suggestionIds || undefined,
        autoSafeOnly: autoSafe,
        actor: autoSafe && !suggestionIds?.length ? "auto_safe" : "user",
        posMap,
        routing,
        jobIds,
      });
      json(res, 200, { preview, apply: true, result });
      return true;
    }

    if (url.pathname === "/api/dispatch/jobs" && req.method === "GET") {
      const status = String(url.searchParams.get("status") || "open").toLowerCase();
      const date = parseServiceDate(url.searchParams.get("date")) || todayYmd();
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
      // Span overlap, not equality: a 3-day tour must show on all three of its days.
      const clauses = [
        "j.tenant_id = $1",
        "$2::date BETWEEN j.service_date AND COALESCE(j.end_date, j.service_date)",
      ];
      const params = [dbTenant.id, date];
      if (status === "open") {
        clauses.push(`j.status IN ('draft','assigned','en_route','arrived')`);
      } else if (STATUSES.includes(status)) {
        params.push(status);
        clauses.push(`j.status = $${params.length}`);
      } else if (status !== "all") {
        json(res, 400, { error: "Invalid status filter" });
        return true;
      }
      params.push(limit);
      const rows = await dbQuery(
        `SELECT j.*,
                u.username AS assignee_username,
                u.display_name AS assignee_display_name
         FROM dispatch_jobs j
         LEFT JOIN field_users u ON u.id = j.assigned_field_user_id
         WHERE ${clauses.join(" AND ")}
         ORDER BY j.updated_at DESC
         LIMIT $${params.length}`,
        params,
      );
      const jobs = [];
      for (const row of rows.rows) {
        const stops = await loadStops(row.id);
        const healed = await markJobDoneIfNoOpenStops(row.id, stops);
        const jobRow = healed || row;
        if (status === "open" && jobIsClosed(jobRow.status)) continue;
        jobs.push(withRequestedDay(publicJob(jobRow, stops), date));
      }
      json(res, 200, {
        jobs: await decorateJobsWithLines(dbTenant.id, jobs),
        serviceDate: date,
      });
      return true;
    }

    if (url.pathname === "/api/dispatch/jobs" && req.method === "POST") {
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "editDispatchJobs"))) return true;
      const body = await readJson(req);
      const title = String(body.title || "").trim().slice(0, 200);
      if (!title) {
        json(res, 400, { error: "title is required" });
        return true;
      }
      const notes = String(body.notes || "").trim().slice(0, 4000) || null;
      let armadaUserId =
        body.armadaUserId == null || body.armadaUserId === ""
          ? null
          : Number.isInteger(Number(body.armadaUserId)) && Number(body.armadaUserId) > 0
            ? Number(body.armadaUserId)
            : null;
      let armadaUsername = String(body.armadaUsername || "").trim().slice(0, 120) || null;
      let userDisplayName = String(body.userDisplayName || "").trim().slice(0, 200) || null;
      let trackerDeviceId = null;
      {
        const { resolveTenantTrackerDevice } = await import("./tracker-device-resolve.mjs");
        const device = await resolveTenantTrackerDevice(dbTenant.id, body.trackerDeviceId);
        if (body.trackerDeviceId && !device) {
          json(res, 400, { error: "trackerDeviceId not found" });
          return true;
        }
        if (device) {
          trackerDeviceId = device.id;
          if (!userDisplayName) userDisplayName = device.label;
          if (!armadaUsername && device.imei) armadaUsername = device.imei;
          if (armadaUserId == null && device.armadaUserId != null) {
            armadaUserId = device.armadaUserId;
          }
        }
      }
      let assigneeId = body.assignedFieldUserId || null;
      if (assigneeId) {
        const ok = await dbQuery(
          `SELECT id FROM field_users WHERE id = $1 AND tenant_id = $2 AND enabled = true`,
          [assigneeId, dbTenant.id],
        );
        if (!ok.rows[0]) {
          json(res, 400, { error: "assignedFieldUserId not found" });
          return true;
        }
      }
      let status = String(body.status || (assigneeId ? "assigned" : "draft")).toLowerCase();
      if (!STATUSES.includes(status)) status = assigneeId ? "assigned" : "draft";
      if (assigneeId && status === "draft") status = "assigned";
      let volCap = numOrNull(body.volumeCapacityM3);
      let wtCap = numOrNull(body.weightCapacityKg);
      let seatCap = intOrNull(body.seatCapacity ?? body.seat_capacity);
      let luggageCap = numOrNull(body.luggageCapacityKg ?? body.luggage_capacity_kg);
      if (
        seatCap != null ||
        luggageCap != null ||
        String(body.profile || "").toLowerCase() === "passenger"
      ) {
        const mapped = passengerCapsToCargo({
          seatCapacity: seatCap,
          luggageCapacityKg: luggageCap,
        });
        seatCap = mapped.seatCapacity;
        luggageCap = mapped.luggageCapacityKg;
        if (mapped.volumeCapacityM3 != null) volCap = mapped.volumeCapacityM3;
        if (mapped.weightCapacityKg != null) wtCap = mapped.weightCapacityKg;
      }
      if (volCap == null || wtCap == null || seatCap == null || luggageCap == null) {
        let p = null;
        if (trackerDeviceId) {
          const preset = await dbQuery(
            `SELECT volume_capacity_m3, weight_capacity_kg, seat_capacity, luggage_capacity_kg
             FROM vehicle_capacities
             WHERE tenant_id = $1 AND tracker_device_id = $2::uuid`,
            [dbTenant.id, trackerDeviceId],
          );
          p = preset.rows[0] || null;
        }
        if (!p && armadaUserId != null) {
          const preset = await dbQuery(
            `SELECT volume_capacity_m3, weight_capacity_kg, seat_capacity, luggage_capacity_kg
             FROM vehicle_capacities
             WHERE tenant_id = $1 AND armada_user_id = $2`,
            [dbTenant.id, armadaUserId],
          );
          p = preset.rows[0] || null;
        }
        if (p) {
          if (volCap == null) volCap = Number(p.volume_capacity_m3);
          if (wtCap == null) wtCap = Number(p.weight_capacity_kg);
          if (seatCap == null && p.seat_capacity != null) seatCap = Number(p.seat_capacity);
          if (luggageCap == null && p.luggage_capacity_kg != null) {
            luggageCap = Number(p.luggage_capacity_kg);
          }
        }
      }
      const serviceDate = parseServiceDate(body.serviceDate) || todayYmd();

      const inserted = await dbQuery(
        `INSERT INTO dispatch_jobs (
           tenant_id, status, title, notes,
           armada_user_id, armada_username, user_display_name, tracker_device_id,
           assigned_field_user_id, assigned_at,
           volume_capacity_m3, weight_capacity_kg, seat_capacity, luggage_capacity_kg, service_date
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,
           CASE WHEN $9::uuid IS NULL THEN NULL ELSE now() END,
           COALESCE($10, 12), COALESCE($11, 1500), $12, $13, $14
         )
         RETURNING id`,
        [
          dbTenant.id,
          status,
          title,
          notes,
          armadaUserId,
          armadaUsername,
          userDisplayName,
          trackerDeviceId,
          assigneeId,
          volCap,
          wtCap,
          seatCap,
          luggageCap,
          serviceDate,
        ],
      );
      const jobId = inserted.rows[0].id;
      await replaceStops(jobId, normalizeStops(body.stops));
      const row = await loadJob(dbTenant.id, jobId);
      const stops = await loadStops(jobId);
      const job = await publicJobWithLines(dbTenant.id, row, stops);
      if (assigneeId) {
        try {
          await maybeNotifyDispatchJobAssigned({
            tenantId: dbTenant.id,
            tenantKey: dbTenant.key,
            job,
            prevAssignedFieldUserId: null,
          });
        } catch (err) {
          console.error("[dispatch] assigned notify", err);
        }
      }
      json(res, 201, { job });
      return true;
    }

    const assignOrders = /^\/api\/dispatch\/jobs\/([0-9a-f-]{36})\/assign-orders$/i.exec(
      url.pathname,
    );
    if (assignOrders && req.method === "POST") {
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "editDispatchJobs"))) return true;
      const job = await loadJob(dbTenant.id, assignOrders[1]);
      if (!job) {
        json(res, 404, { error: "Job not found" });
        return true;
      }
      const body = await readJson(req);
      const orderIds = Array.isArray(body.orderIds) ? body.orderIds.map(String) : [];
      if (!orderIds.length) {
        json(res, 400, { error: "orderIds required" });
        return true;
      }
      const assigned = await assignPendingOrdersToJob(dbTenant, job, orderIds, {
        rejectOverCapacity: body.rejectOverCapacity === true,
      });
      if (assigned.error) {
        json(res, assigned.status || 400, {
          error: assigned.error,
          ...(assigned.capacity ? { capacity: assigned.capacity } : {}),
        });
        return true;
      }
      const row = await loadJob(dbTenant.id, job.id);
      const publicJobRow = await publicJobWithLines(dbTenant.id, row, await loadStops(job.id));
      if (assigned.addedNames.length && publicJobRow.assignedFieldUserId) {
        try {
          await maybeNotifyDispatchRouteUpdated({
            tenantId: dbTenant.id,
            tenantKey: dbTenant.key,
            job: publicJobRow,
            addedNames: assigned.addedNames,
          });
        } catch (err) {
          console.error("[dispatch] route-updated notify", err);
        }
      }
      json(res, 200, { job: publicJobRow });
      return true;
    }

    const returnStock = /^\/api\/dispatch\/jobs\/([0-9a-f-]{36})\/return-stock$/i.exec(url.pathname);
    if (returnStock && req.method === "POST") {
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "editDispatchJobs"))) return true;
      const job = await loadJob(dbTenant.id, returnStock[1]);
      if (!job) {
        json(res, 404, { error: "Job not found" });
        return true;
      }
      const body = await readJson(req);
      const out = await returnTruckStockToDepot(dbTenant.id, {
        jobId: job.id,
        job,
        depotId: body.depotId || body.depot_id || null,
        writeOff: body.writeOff === true || body.write_off === true,
        note: body.note || (body.writeOff ? "Write-off truck stock" : "Manual return truck → depot"),
      });
      json(res, 200, out);
      return true;
    }

    const nextTrip = /^\/api\/dispatch\/jobs\/([0-9a-f-]{36})\/next-trip$/i.exec(url.pathname);
    if (nextTrip && req.method === "POST") {
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "editDispatchJobs"))) return true;
      const source = await loadJob(dbTenant.id, nextTrip[1]);
      if (!source) {
        json(res, 404, { error: "Job not found" });
        return true;
      }
      const body = await readJson(req);
      const orderIds = Array.isArray(body.orderIds) ? body.orderIds.map(String) : [];
      if (!orderIds.length) {
        json(res, 400, { error: "orderIds required" });
        return true;
      }
      let assigneeId = source.assigned_field_user_id || null;
      if (assigneeId) {
        const ok = await dbQuery(
          `SELECT id FROM field_users WHERE id = $1 AND tenant_id = $2 AND enabled = true`,
          [assigneeId, dbTenant.id],
        );
        if (!ok.rows[0]) assigneeId = null;
      }
      const status = assigneeId ? "assigned" : "draft";
      const title = nextDispatchTripTitle(source.title);
      const serviceDate = formatServiceDate(source.service_date) || todayYmd();
      const inserted = await dbQuery(
        `INSERT INTO dispatch_jobs (
           tenant_id, status, title, notes,
           armada_user_id, armada_username, user_display_name, tracker_device_id,
           assigned_field_user_id, assigned_at,
           volume_capacity_m3, weight_capacity_kg, service_date
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,
           CASE WHEN $9::uuid IS NULL THEN NULL ELSE now() END,
           COALESCE($10, 12), COALESCE($11, 1500), $12
         )
         RETURNING id`,
        [
          dbTenant.id,
          status,
          title,
          null,
          source.armada_user_id == null ? null : Number(source.armada_user_id),
          source.armada_username || null,
          source.user_display_name || null,
          source.tracker_device_id || null,
          assigneeId,
          source.volume_capacity_m3 == null ? null : Number(source.volume_capacity_m3),
          source.weight_capacity_kg == null ? null : Number(source.weight_capacity_kg),
          serviceDate,
        ],
      );
      const jobId = inserted.rows[0].id;
      const created = await loadJob(dbTenant.id, jobId);
      const assigned = await assignPendingOrdersToJob(dbTenant, created, orderIds, {
        rejectOverCapacity: body.rejectOverCapacity === true,
      });
      if (assigned.error) {
        await dbQuery(`DELETE FROM dispatch_jobs WHERE id = $1 AND tenant_id = $2`, [
          jobId,
          dbTenant.id,
        ]);
        json(res, assigned.status || 400, {
          error: assigned.error,
          ...(assigned.capacity ? { capacity: assigned.capacity } : {}),
        });
        return true;
      }
      const row = await loadJob(dbTenant.id, jobId);
      const job = await publicJobWithLines(dbTenant.id, row, await loadStops(jobId));
      if (assigneeId) {
        try {
          await maybeNotifyDispatchJobAssigned({
            tenantId: dbTenant.id,
            tenantKey: dbTenant.key,
            job,
            prevAssignedFieldUserId: null,
          });
        } catch (err) {
          console.error("[dispatch] next-trip assigned notify", err);
        }
      }
      json(res, 201, { job });
      return true;
    }

    const optimizeStops = /^\/api\/dispatch\/jobs\/([0-9a-f-]{36})\/optimize-stops$/i.exec(
      url.pathname,
    );
    if (optimizeStops && req.method === "POST") {
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "editDispatchJobs"))) return true;
      const job = await loadJob(dbTenant.id, optimizeStops[1]);
      if (!job) {
        json(res, 404, { error: "Job not found" });
        return true;
      }
      const body = await readJson(req);
      let routing = parseRoutingOptions({
        ...body,
        routing: {
          ...(body.routing && typeof body.routing === "object" ? body.routing : {}),
          ...(body.plateParity != null ? { plateParity: body.plateParity } : {}),
          ...(body.respectGanjilGenap != null
            ? { respectGanjilGenap: body.respectGanjilGenap }
            : {}),
        },
      });
      if (
        (!body.routing?.plateParity && body.plateParity == null) ||
        routing.plateParity === "unknown"
      ) {
        const uid = job.armada_user_id == null ? null : Number(job.armada_user_id);
        const deviceId = String(job.tracker_device_id || "").trim();
        let plateRow = null;
        if (/^[0-9a-f-]{36}$/i.test(deviceId)) {
          const cap = await dbQuery(
            `SELECT plate_parity FROM vehicle_capacities
             WHERE tenant_id = $1 AND tracker_device_id = $2::uuid`,
            [dbTenant.id, deviceId],
          );
          plateRow = cap.rows[0] || null;
        }
        if (!plateRow?.plate_parity && uid) {
          const cap = await dbQuery(
            `SELECT plate_parity FROM vehicle_capacities
             WHERE tenant_id = $1 AND armada_user_id = $2`,
            [dbTenant.id, uid],
          );
          plateRow = cap.rows[0] || null;
        }
        if (plateRow?.plate_parity) {
          routing = parseRoutingOptions({
            routing: {
              ...routing,
              plateParity: plateRow.plate_parity,
              respectGanjilGenap:
                routing.respectGanjilGenap ||
                body.respectGanjilGenap === true ||
                Boolean(plateRow.plate_parity),
            },
          });
        }
      }
      // Each day of a multi-day tour optimizes on its own; day 1 stays put while
      // day 2 is resequenced. Defaults to day 1, which is every single-day job.
      const jobServiceDate = formatServiceDate(job.service_date);
      const jobEndDate = formatServiceDate(job.end_date) || jobServiceDate;
      const requestedDay =
        body.dayIndex != null || body.day_index != null
          ? clampDayIndex(body.dayIndex ?? body.day_index)
          : (dayIndexForDate(jobServiceDate, jobEndDate, parseServiceDate(body.date)) ?? 0);
      const allStops = await loadStops(job.id);
      const stops = allStops.filter((s) => (Number(s.day_index) || 0) === requestedDay);
      const remaining = stops.filter((s) => {
        const st = String(s.status || "").toLowerCase();
        return st !== "done" && st !== "skipped";
      });
      const withCoords = remaining.filter(
        (s) => s.lat != null && s.lon != null && Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon)),
      );
      if (withCoords.length < 2 && !(job.route_start_lat != null && withCoords.length >= 1)) {
        json(res, 400, {
          error: "Need at least 2 remaining stops with coordinates to optimize (done/skipped are frozen)",
        });
        return true;
      }
      const spanDays = spanDayCount(jobServiceDate, jobEndDate);
      const startAnchor = routeAnchorFromRow(
        job.route_start_lat,
        job.route_start_lon,
        job.route_start_label || "Start",
      );
      const endAnchor = routeAnchorFromRow(
        job.route_end_lat,
        job.route_end_lon,
        job.route_end_label || "Return",
      );
      const pathMode = String(job.route_anchor_mode || "").toLowerCase();
      const useStart = Boolean(startAnchor);
      const optResult = await reorderRemainingStops(job.id, {
        start: useStart ? { lat: startAnchor.lat, lon: startAnchor.lon } : null,
        routing,
        dayIndex: spanDays > 1 ? requestedDay : null,
      });
      const orderedStops = await loadStops(job.id);
      let planDayStart = job.plan_day_start || null;
      if (body.dayStart || body.day_start) {
        const raw = String(body.dayStart || body.day_start).trim();
        const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw);
        if (m) {
          planDayStart = `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`;
          await dbQuery(`UPDATE dispatch_jobs SET plan_day_start = $1, updated_at = now() WHERE id = $2`, [
            planDayStart,
            job.id,
          ]);
          job.plan_day_start = planDayStart;
        }
      }
      await refreshAndPersistPlannedEtas(job, orderedStops, {
        persist: true,
        dayStart: planDayStart,
      });
      const customerPoints = withCoords.map((s) => ({ lat: Number(s.lat), lon: Number(s.lon) }));
      const geomPts = geometryPointsFromStopsAndAnchors(
        orderedStops,
        pathMode === "map" || pathMode === "sequence" ? startAnchor : null,
        pathMode === "map" || pathMode === "sequence" ? endAnchor : null,
        pathMode === "map" || pathMode === "sequence" ? pathMode : "calc",
      );
      const route = await buildRouteForPoints(
        geomPts.length >= 2 ? geomPts : customerPoints,
        routing,
      );
      await refreshJobOpexEstimate(dbTenant.id, job.id, {
        distanceKm: route.distanceKm,
        durationSec: route.durationSec,
        stopCount: orderedStops.length,
      }).catch(() => null);
      await refreshJobFareEstimate(dbTenant.id, job.id, {
        distanceKm: route.distanceKm,
      }).catch(() => null);
      const row = await loadJob(dbTenant.id, job.id);
      json(res, 200, {
        job: await publicJobWithLines(dbTenant.id, row, orderedStops),
        engine: route.engine,
        matrixEngine: optResult.matrixEngine || null,
        frozenStops: stops.length - remaining.length,
        routing,
        route,
        warning: optResult.warning || route.warning || null,
      });
      return true;
    }

    const one = /^\/api\/dispatch\/jobs\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (one && req.method === "GET") {
      const row = await loadJob(dbTenant.id, one[1]);
      if (!row) {
        json(res, 404, { error: "Job not found" });
        return true;
      }
      json(res, 200, { job: await publicJobWithLines(dbTenant.id, row, await loadStops(row.id)) });
      return true;
    }

    if (one && req.method === "PATCH") {
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "editDispatchJobs"))) return true;
      const existing = await loadJob(dbTenant.id, one[1]);
      if (!existing) {
        json(res, 404, { error: "Job not found" });
        return true;
      }
      const prevAssignedFieldUserId = existing.assigned_field_user_id || null;
      const body = await readJson(req);
      const sets = [];
      const params = [];
      let assigneeChanged = false;

      if ("title" in body) {
        const title = String(body.title || "").trim().slice(0, 200);
        if (!title) {
          json(res, 400, { error: "title cannot be empty" });
          return true;
        }
        params.push(title);
        sets.push(`title = $${params.length}`);
      }
      if ("notes" in body) {
        params.push(String(body.notes || "").trim().slice(0, 4000) || null);
        sets.push(`notes = $${params.length}`);
      }
      if ("armadaUserId" in body) {
        const n = body.armadaUserId;
        params.push(
          n == null || n === ""
            ? null
            : Number.isInteger(Number(n)) && Number(n) > 0
              ? Number(n)
              : null,
        );
        sets.push(`armada_user_id = $${params.length}`);
      }
      if ("armadaUsername" in body) {
        params.push(String(body.armadaUsername || "").trim().slice(0, 120) || null);
        sets.push(`armada_username = $${params.length}`);
      }
      if ("userDisplayName" in body) {
        params.push(String(body.userDisplayName || "").trim().slice(0, 200) || null);
        sets.push(`user_display_name = $${params.length}`);
      }
      if ("trackerDeviceId" in body) {
        const { resolveTenantTrackerDevice } = await import("./tracker-device-resolve.mjs");
        if (body.trackerDeviceId == null || body.trackerDeviceId === "") {
          params.push(null);
          sets.push(`tracker_device_id = $${params.length}`);
        } else {
          const device = await resolveTenantTrackerDevice(dbTenant.id, body.trackerDeviceId);
          if (!device) {
            json(res, 400, { error: "trackerDeviceId not found" });
            return true;
          }
          params.push(device.id);
          sets.push(`tracker_device_id = $${params.length}`);
          if (!("userDisplayName" in body)) {
            params.push(device.label);
            sets.push(`user_display_name = $${params.length}`);
          }
          if (!("armadaUsername" in body) && device.imei) {
            params.push(device.imei);
            sets.push(`armada_username = $${params.length}`);
          }
          if (!("armadaUserId" in body) && device.armadaUserId != null) {
            params.push(device.armadaUserId);
            sets.push(`armada_user_id = $${params.length}`);
          }
        }
      }
      if ("assignedFieldUserId" in body) {
        let assigneeId = body.assignedFieldUserId || null;
        if (assigneeId) {
          const ok = await dbQuery(
            `SELECT id FROM field_users WHERE id = $1 AND tenant_id = $2 AND enabled = true`,
            [assigneeId, dbTenant.id],
          );
          if (!ok.rows[0]) {
            json(res, 400, { error: "assignedFieldUserId not found" });
            return true;
          }
        }
        params.push(assigneeId);
        sets.push(`assigned_field_user_id = $${params.length}`);
        if (assigneeId) {
          sets.push(`assigned_at = COALESCE(assigned_at, now())`);
          if (!("status" in body) && existing.status === "draft") {
            sets.push(`status = 'assigned'`);
          }
        } else {
          sets.push(`assigned_at = NULL`);
        }
        assigneeChanged =
          String(assigneeId || "") !== String(prevAssignedFieldUserId || "");
      }
      if ("status" in body) {
        const status = String(body.status || "").toLowerCase();
        if (!STATUSES.includes(status)) {
          json(res, 400, { error: "Invalid status" });
          return true;
        }
        params.push(status);
        sets.push(`status = $${params.length}`);
        if (status === "en_route") sets.push(`started_at = COALESCE(started_at, now())`);
        if (status === "arrived") sets.push(`arrived_at = COALESCE(arrived_at, now())`);
        if (status === "done" || status === "cancelled") {
          sets.push(`completed_at = COALESCE(completed_at, now())`);
        }
        if (status === "done" && existing.status !== "done") {
          await returnTruckStockToDepot(dbTenant.id, {
            jobId: existing.id,
            job: existing,
            note: "Return remaining truck stock on job done",
          }).catch(() => null);
        }
        // Cancelling returns linked orders to the inbox so they can be re-planned.
        if (status === "cancelled" && existing.status !== "cancelled") {
          // Truck cargo must return before stops are wiped.
          await returnTruckStockToDepot(dbTenant.id, {
            jobId: existing.id,
            job: existing,
            note: "Return truck stock on job cancel",
          }).catch(() => null);
          await dbQuery(
            `UPDATE dispatch_orders
             SET status = 'pending', job_id = NULL, stop_id = NULL, updated_at = now()
             WHERE job_id = $1 AND status = 'assigned'`,
            [existing.id],
          );
          await dbQuery(`DELETE FROM dispatch_stops WHERE job_id = $1`, [existing.id]);
          // No stops left, so the tour collapses back to a single day.
          await recomputeJobSpan(existing.id);
        }
      }
      if ("fieldNote" in body) {
        params.push(String(body.fieldNote || "").trim().slice(0, 2000) || null);
        sets.push(`field_note = $${params.length}`);
      }
      if (
        "seatCapacity" in body ||
        "seat_capacity" in body ||
        "luggageCapacityKg" in body ||
        "luggage_capacity_kg" in body ||
        String(body.profile || "").toLowerCase() === "passenger"
      ) {
        const mapped = passengerCapsToCargo({
          seatCapacity: body.seatCapacity ?? body.seat_capacity,
          luggageCapacityKg: body.luggageCapacityKg ?? body.luggage_capacity_kg,
        });
        params.push(mapped.volumeCapacityM3 ?? numOrNull(body.volumeCapacityM3) ?? 12);
        sets.push(`volume_capacity_m3 = $${params.length}`);
        params.push(mapped.weightCapacityKg ?? numOrNull(body.weightCapacityKg) ?? 1500);
        sets.push(`weight_capacity_kg = $${params.length}`);
        params.push(mapped.seatCapacity);
        sets.push(`seat_capacity = $${params.length}`);
        params.push(mapped.luggageCapacityKg);
        sets.push(`luggage_capacity_kg = $${params.length}`);
      } else {
        if ("volumeCapacityM3" in body) {
          params.push(numOrNull(body.volumeCapacityM3) ?? 12);
          sets.push(`volume_capacity_m3 = $${params.length}`);
        }
        if ("weightCapacityKg" in body) {
          params.push(numOrNull(body.weightCapacityKg) ?? 1500);
          sets.push(`weight_capacity_kg = $${params.length}`);
        }
      }
      if ("serviceDate" in body) {
        const sd = parseServiceDate(body.serviceDate);
        if (!sd) {
          json(res, 400, { error: "Invalid serviceDate (use YYYY-MM-DD)" });
          return true;
        }
        params.push(sd);
        sets.push(`service_date = $${params.length}`);
      }
      if ("stops" in body) {
        await replaceStops(existing.id, normalizeStops(body.stops));
      }

      if (sets.length) {
        sets.push(`updated_at = now()`);
        params.push(existing.id, dbTenant.id);
        await dbQuery(
          `UPDATE dispatch_jobs SET ${sets.join(", ")}
           WHERE id = $${params.length - 1} AND tenant_id = $${params.length}`,
          params,
        );
      }

      const becameDone =
        "status" in body &&
        String(body.status || "").toLowerCase() === "done" &&
        existing.status !== "done";
      if (becameDone) {
        await refreshJobOpexActual(dbTenant.id, existing.id).catch(() => null);
        await refreshJobFareActual(dbTenant.id, existing.id).catch(() => null);
      }

      const row = await loadJob(dbTenant.id, existing.id);
      const stops = await loadStops(row.id);
      const job = await publicJobWithLines(dbTenant.id, row, stops);
      if (assigneeChanged && job.assignedFieldUserId) {
        try {
          await maybeNotifyDispatchJobAssigned({
            tenantId: dbTenant.id,
            tenantKey: dbTenant.key,
            job,
            prevAssignedFieldUserId,
          });
        } catch (err) {
          console.error("[dispatch] assigned notify", err);
        }
      }
      json(res, 200, { job });
      return true;
    }

    const stopPatch = /^\/api\/dispatch\/jobs\/([0-9a-f-]{36})\/stops\/([0-9a-f-]{36})$/i.exec(
      url.pathname,
    );
    if (stopPatch && req.method === "PATCH") {
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "editDispatchJobs"))) return true;
      const job = await loadJob(dbTenant.id, stopPatch[1]);
      if (!job) {
        json(res, 404, { error: "Job not found" });
        return true;
      }
      const body = await readJson(req);
      const status = String(body.status || "").toLowerCase();
      if (!STOP_STATUSES.includes(status)) {
        json(res, 400, { error: "Invalid stop status" });
        return true;
      }
      const updated = await dbQuery(
        `UPDATE dispatch_stops s
         SET status = $1,
             arrived_at = CASE WHEN $1 = 'arrived' THEN COALESCE(arrived_at, now()) ELSE arrived_at END,
             completed_at = CASE WHEN $1 IN ('done','skipped') THEN COALESCE(completed_at, now()) ELSE completed_at END
         FROM dispatch_jobs j
         WHERE s.id = $2 AND s.job_id = j.id AND j.id = $3 AND j.tenant_id = $4
         RETURNING s.*`,
        [status, stopPatch[2], stopPatch[1], dbTenant.id],
      );
      if (!updated.rows[0]) {
        json(res, 404, { error: "Stop not found" });
        return true;
      }
      json(res, 200, {
        stop: publicStop(updated.rows[0], formatServiceDate(job.service_date)),
        job: await publicJobWithLines(dbTenant.id, await loadJob(dbTenant.id, job.id), await loadStops(job.id)),
      });
      return true;
    }

    // Move a stop to another day of the same tour. Assigning a stop to the day
    // after the current last one is how a tour grows: recomputeJobSpan extends
    // end_date, so there is no separate "add day" write.
    const stopDay =
      /^\/api\/dispatch\/jobs\/([0-9a-f-]{36})\/stops\/([0-9a-f-]{36})\/day$/i.exec(url.pathname);
    if (stopDay && req.method === "PATCH") {
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "editDispatchJobs"))) return true;
      const job = await loadJob(dbTenant.id, stopDay[1]);
      if (!job) {
        json(res, 404, { error: "Job not found" });
        return true;
      }
      if (job.status === "done" || job.status === "cancelled") {
        json(res, 400, { error: "Cannot change stops on a closed job" });
        return true;
      }
      const body = await readJson(req);
      const raw = Number(body.dayIndex ?? body.day_index);
      if (!Number.isInteger(raw) || raw < 0 || raw > MAX_DAY_INDEX) {
        json(res, 400, { error: `dayIndex must be an integer between 0 and ${MAX_DAY_INDEX}` });
        return true;
      }
      const existing = await dbQuery(
        `SELECT * FROM dispatch_stops WHERE id = $1 AND job_id = $2`,
        [stopDay[2], job.id],
      );
      const stopRow = existing.rows[0];
      if (!stopRow) {
        json(res, 404, { error: "Stop not found" });
        return true;
      }
      if (stopRow.status === "done" || stopRow.status === "skipped") {
        json(res, 400, { error: "Completed stops cannot be moved to another day" });
        return true;
      }
      const dayIndex = clampDayIndex(raw);
      // A gap would leave an empty day in the middle of the tour.
      const maxDay = await dbQuery(
        `SELECT COALESCE(MAX(day_index), 0)::int AS m FROM dispatch_stops WHERE job_id = $1`,
        [job.id],
      );
      if (dayIndex > (maxDay.rows[0]?.m ?? 0) + 1) {
        json(res, 400, { error: "Days must be added one at a time — no empty day in between" });
        return true;
      }
      const nextSort = await dbQuery(
        `SELECT COALESCE(MAX(sort_order), -1)::int AS m
         FROM dispatch_stops WHERE job_id = $1 AND day_index = $2 AND id <> $3`,
        [job.id, dayIndex, stopRow.id],
      );
      const updated = await dbQuery(
        `UPDATE dispatch_stops
         SET day_index = $1, sort_order = $2, planned_eta = NULL
         WHERE id = $3 AND job_id = $4
         RETURNING *`,
        [dayIndex, (nextSort.rows[0]?.m ?? -1) + 1, stopRow.id, job.id],
      );
      await recomputeJobSpan(job.id);
      const row = await loadJob(dbTenant.id, job.id);
      json(res, 200, {
        stop: publicStop(updated.rows[0], formatServiceDate(row.service_date)),
        job: await publicJobWithLines(dbTenant.id, row, await loadStops(job.id)),
      });
      return true;
    }

    const stopReturn =
      /^\/api\/dispatch\/jobs\/([0-9a-f-]{36})\/stops\/([0-9a-f-]{36})\/return$/i.exec(url.pathname);
    if (stopReturn && req.method === "POST") {
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "editDispatchJobs"))) return true;
      const job = await loadJob(dbTenant.id, stopReturn[1]);
      if (!job) {
        json(res, 404, { error: "Job not found" });
        return true;
      }
      if (job.status === "done" || job.status === "cancelled") {
        json(res, 400, { error: "Cannot change stops on a closed job" });
        return true;
      }
      const stopRow = await dbQuery(
        `SELECT s.* FROM dispatch_stops s
         WHERE s.id = $1 AND s.job_id = $2`,
        [stopReturn[2], job.id],
      );
      const stop = stopRow.rows[0];
      if (!stop) {
        json(res, 404, { error: "Stop not found" });
        return true;
      }
      if (stop.status === "done" || stop.status === "skipped") {
        json(res, 400, { error: "Completed stops cannot be returned to the inbox" });
        return true;
      }
      if (stop.order_id) {
        await dbQuery(
          `UPDATE dispatch_orders
           SET status = 'pending', job_id = NULL, stop_id = NULL, updated_at = now()
           WHERE id = $1 AND tenant_id = $2`,
          [stop.order_id, dbTenant.id],
        );
        await dbQuery(`DELETE FROM dispatch_stops WHERE order_id = $1 AND job_id = $2`, [
          stop.order_id,
          job.id,
        ]);
      } else {
        await dbQuery(`DELETE FROM dispatch_stops WHERE id = $1 AND job_id = $2`, [stop.id, job.id]);
      }
      await dbQuery(`UPDATE dispatch_jobs SET updated_at = now() WHERE id = $1`, [job.id]);
      // Returning the last stop of the final day shortens the tour.
      await recomputeJobSpan(job.id);
      const row = await loadJob(dbTenant.id, job.id);
      json(res, 200, {
        job: await publicJobWithLines(dbTenant.id, row, await loadStops(job.id)),
        returnedOrderId: stop.order_id || null,
      });
      return true;
    }

    if (url.pathname === "/api/dispatch/plan-day" && req.method === "POST") {
      return handlePlanDayPost(req, res, {
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
        requirePlanPrivilege: async (apply) => {
          if (!apply) return true;
          return requireDeskPrivilege(req, res, dbTenant.id, "planDispatch");
        },
      });
    }


    json(res, 404, { error: "Not found" });
    return true;
  } catch (err) {
    const status = err?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[dispatch]", message);
    json(res, status >= 400 && status < 600 ? status : 500, { error: message });
    return true;
  }
}
