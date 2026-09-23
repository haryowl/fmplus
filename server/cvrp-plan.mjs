/**
 * Capacitated VRP (dual volume + weight) — greedy cheapest insertion,
 * soft time-window preference, inter-route balance relocate, open-tour 2-opt.
 * Multi-depot: partition orders to nearest depot (optional zone→depot), then planCvrp per cluster.
 * Optional soft same-zone preference on insertion (default off).
 */
import { haversineKm, optimizeOpenTour, pathCost } from "./route-optimize.mjs";
import {
  normalizeZoneKey,
  partitionOrdersToDepots,
  routeDominantZone,
  zoneMixPenalty,
} from "./dispatch-zone.mjs";
import {
  pairMateIndex,
  restorePairPrecedence,
  routeLoadFeasible,
  routePeakLoad,
} from "./dispatch-pickup-drop.mjs";

const SPEED_KMH = 35;
const TW_LATE_PENALTY_KM = 40;
const TW_EARLY_PENALTY_KM = 2;
const DEFAULT_DAY_START_MIN = 8 * 60; // 08:00
const DEFAULT_DAY_END_MIN = 18 * 60; // 18:00
const DEFAULT_SERVICE_MIN = 8;
const DEFAULT_RELOAD_MIN = 15;

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function fits(residual, demand) {
  return residual.vol + 1e-9 >= demand.vol && residual.wt + 1e-9 >= demand.wt;
}

/** Parse "HH:MM" / "H:MM" → minutes from midnight, or null. */
export function parseWindowMinutes(v) {
  const s = String(v || "").trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

export function formatMinutesClock(mins) {
  if (mins == null || !Number.isFinite(mins)) return "";
  const m = Math.max(0, Math.round(mins)) % (24 * 60);
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function travelMinutes(matrix, fromIdx, toIdx) {
  if (fromIdx == null) return 0;
  const km = matrix[fromIdx]?.[toIdx];
  if (!Number.isFinite(km) || km >= 1e8) return 0;
  return (km / SPEED_KMH) * 60;
}

/** Per-order dwell minutes; null/undefined → plan default. */
export function resolveServiceMinutes(order, defaultMin = DEFAULT_SERVICE_MIN) {
  const fallback = Math.max(0, Math.min(120, Number(defaultMin) || DEFAULT_SERVICE_MIN));
  if (order == null || order.serviceMinutes == null || order.serviceMinutes === "") {
    return fallback;
  }
  const n = Number(order.serviceMinutes);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(120, n));
}

/**
 * Simulate arrivals along a customer route (matrix indices).
 * Returns per-stop { matrixIdx, arriveMin, departMin, late, early }.
 */
export function simulateRouteSchedule({
  route,
  ordersByMatrixIdx,
  matrix,
  depotIdx,
  dayStartMin = DEFAULT_DAY_START_MIN,
  serviceMinutes = DEFAULT_SERVICE_MIN,
}) {
  const stops = [];
  let t = dayStartMin;
  let prev = depotIdx;
  for (const cur of route) {
    t += travelMinutes(matrix, prev, cur);
    const order = ordersByMatrixIdx.get(cur);
    const winStart = order ? parseWindowMinutes(order.windowStart) : null;
    const winEnd = order ? parseWindowMinutes(order.windowEnd) : null;
    const arriveMin = t;
    const early = winStart != null && arriveMin < winStart;
    const late = winEnd != null && arriveMin > winEnd;
    if (early) t = winStart; // wait until window opens
    const svc = resolveServiceMinutes(order, serviceMinutes);
    const departMin = t + svc;
    stops.push({
      matrixIdx: cur,
      orderId: order?.sourceOrderId || order?.id || null,
      role: order?.role === "pickup" ? "pickup" : "drop",
      label: order?.label || "",
      arriveMin,
      arriveAt: formatMinutesClock(arriveMin),
      departMin,
      departAt: formatMinutesClock(departMin),
      serviceMinutes: svc,
      windowStart: order?.windowStart || "",
      windowEnd: order?.windowEnd || "",
      early,
      late,
    });
    t = departMin;
    prev = cur;
  }
  return stops;
}

function insertionDelta(route, pos, nodeIdx, matrix, depotIdx) {
  if (!route.length) {
    return depotIdx != null ? matrix[depotIdx][nodeIdx] : 0;
  }
  if (pos === 0) {
    const next = route[0];
    return depotIdx != null
      ? matrix[depotIdx][nodeIdx] + matrix[nodeIdx][next] - matrix[depotIdx][next]
      : matrix[nodeIdx][next];
  }
  if (pos === route.length) {
    return matrix[route[route.length - 1]][nodeIdx];
  }
  const prev = route[pos - 1];
  const next = route[pos];
  return matrix[prev][nodeIdx] + matrix[nodeIdx][next] - matrix[prev][next];
}

function bestInsertion(route, nodeIdx, matrix, depotIdx) {
  let bestPos = 0;
  let bestCost = Infinity;
  for (let pos = 0; pos <= route.length; pos++) {
    const delta = insertionDelta(route, pos, nodeIdx, matrix, depotIdx);
    if (delta < bestCost) {
      bestCost = delta;
      bestPos = pos;
    }
  }
  return { pos: bestPos, cost: bestCost };
}

/** Cheapest pickup-then-drop placement (other stops may sit between). */
function bestPairInsertion(route, pickupNode, dropNode, matrix, depotIdx) {
  let best = null;
  for (let pPos = 0; pPos <= route.length; pPos++) {
    const pCost = insertionDelta(route, pPos, pickupNode, matrix, depotIdx);
    const afterP = route.slice();
    afterP.splice(pPos, 0, pickupNode);
    for (let dPos = pPos + 1; dPos <= afterP.length; dPos++) {
      const dCost = insertionDelta(afterP, dPos, dropNode, matrix, depotIdx);
      const cost = pCost + dCost;
      if (!best || cost < best.cost) best = { pPos, dPos, cost };
    }
  }
  return best || { pPos: 0, dPos: 1, cost: 0 };
}

/**
 * Evaluate TW for inserting oi at pos.
 * @returns {{ penalty: number, feasible: boolean }}
 */
function evaluateTwInsertion({
  route,
  pos,
  oi,
  orders,
  matrix,
  depotIdx,
  orderMatrixIndex,
  twMode,
  dayStartMin,
  serviceMinutes,
}) {
  if (twMode === "off") return { penalty: 0, feasible: true };
  const order = orders[oi];
  const winStart = parseWindowMinutes(order.windowStart);
  const winEnd = parseWindowMinutes(order.windowEnd);
  if (winStart == null && winEnd == null) return { penalty: 0, feasible: true };

  const nodeIdx = orderMatrixIndex(oi);
  const tentative = route.slice();
  tentative.splice(pos, 0, nodeIdx);

  let t = dayStartMin;
  let prev = depotIdx;
  for (let i = 0; i < tentative.length; i++) {
    const cur = tentative[i];
    t += travelMinutes(matrix, prev, cur);
    let curOrder = order;
    if (cur !== nodeIdx) {
      const found = orders.findIndex((_, idx) => orderMatrixIndex(idx) === cur);
      curOrder = found >= 0 ? orders[found] : null;
    }
    const ws = curOrder ? parseWindowMinutes(curOrder.windowStart) : null;
    const we = curOrder ? parseWindowMinutes(curOrder.windowEnd) : null;
    if (cur === nodeIdx) {
      let penalty = 0;
      if (ws != null && t < ws) penalty += ((ws - t) / 60) * TW_EARLY_PENALTY_KM;
      if (we != null && t > we) {
        if (twMode === "hard") return { penalty: Infinity, feasible: false };
        penalty += ((t - we) / 60) * TW_LATE_PENALTY_KM;
      }
      return { penalty, feasible: true };
    }
    if (ws != null && t < ws) t = ws;
    t += resolveServiceMinutes(curOrder, serviceMinutes);
    prev = cur;
  }
  return { penalty: 0, feasible: true };
}

function routeDistance(route, matrix, depotIdx, roundtrip) {
  if (!route.length) return { order: route.slice(), distanceKm: 0 };
  let order = route.slice();
  if (depotIdx != null) {
    const n = order.length;
    const sub = Array.from({ length: n }, () => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) sub[i][j] = matrix[order[i]][order[j]];
    }
    let startLocal = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = matrix[depotIdx][order[i]];
      if (d < bestD) {
        bestD = d;
        startLocal = i;
      }
    }
    if (startLocal !== 0) {
      order = order.slice(startLocal).concat(order.slice(0, startLocal));
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) sub[i][j] = matrix[order[i]][order[j]];
      }
    }
    const opt = optimizeOpenTour(
      order.map(() => ({ lat: 0, lon: 0 })),
      sub,
    );
    order = opt.order.map((i) => order[i]);
    let dist = matrix[depotIdx][order[0]];
    for (let i = 0; i < order.length - 1; i++) dist += matrix[order[i]][order[i + 1]];
    if (roundtrip) dist += matrix[order[order.length - 1]][depotIdx];
    return { order, distanceKm: dist };
  }
  const n = order.length;
  const sub = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) sub[i][j] = matrix[order[i]][order[j]];
  }
  const opt = optimizeOpenTour(
    order.map(() => ({ lat: 0, lon: 0 })),
    sub,
  );
  const improved = opt.order.map((i) => order[i]);
  return { order: improved, distanceKm: pathCost(opt.order, sub) };
}

function syncRouteFromOrderIndexes(vs, orderMatrixIndex) {
  vs.route = vs.orderIndexes.map((oi) => orderMatrixIndex(oi));
}

function usedDemand(vs, orders) {
  return routePeakLoad(vs.orderIndexes, orders);
}

function refreshResidual(vs, orders) {
  const used = usedDemand(vs, orders);
  vs.residualVol = vs.volumeCapacityM3 - used.vol;
  vs.residualWt = vs.weightCapacityKg - used.wt;
}

function isPairPickup(order) {
  return Boolean(order?.pairKey && order.role === "pickup");
}

function isPairDrop(order) {
  return Boolean(order?.pairKey && order.role === "drop");
}

function syncPairOrder(vs, orders, orderMatrixIndex) {
  vs.orderIndexes = restorePairPrecedence(vs.orderIndexes.slice(), (oi) => {
    const o = orders[oi];
    if (!o?.pairKey) return null;
    return { key: String(o.pairKey), role: o.role === "pickup" ? "pickup" : "drop" };
  });
  syncRouteFromOrderIndexes(vs, orderMatrixIndex);
}

function utilPct(vs, orders) {
  const { vol, wt } = usedDemand(vs, orders);
  const utilV = vs.volumeCapacityM3 > 0 ? (vol / vs.volumeCapacityM3) * 100 : 0;
  const utilW = vs.weightCapacityKg > 0 ? (wt / vs.weightCapacityKg) * 100 : 0;
  return Math.max(utilV, utilW);
}

function pathKm(route, matrix, depotIdx, roundtrip) {
  return routeDistance(route, matrix, depotIdx, roundtrip).distanceKm;
}

/**
 * Move orders from overloaded vehicles to lighter ones when capacity allows
 * and total distance does not grow more than 8%.
 */
function balanceRelocate(
  vehicleStates,
  orders,
  matrix,
  depotIdx,
  roundtrip,
  orderMatrixIndex,
  opts = {},
) {
  const twMode = opts.twMode || "soft";
  const dayStartMin = opts.dayStartMin ?? DEFAULT_DAY_START_MIN;
  const serviceMinutes = opts.serviceMinutes ?? DEFAULT_SERVICE_MIN;
  const maxStops = opts.maxStopsPerVehicle || 0;
  const preferSameZone = Boolean(opts.preferSameZone);
  let moves = 0;
  for (let pass = 0; pass < 24; pass++) {
    const active = vehicleStates.filter((v) => v.orderIndexes.length > 0);
    if (active.length < 2) break;
    const utils = active.map((v) => utilPct(v, orders));
    const avg = utils.reduce((a, b) => a + b, 0) / utils.length;
    let improved = false;

    for (const from of active) {
      const fromUtil = utilPct(from, orders);
      if (fromUtil < avg + 8) continue;
      for (let i = 0; i < from.orderIndexes.length; i++) {
        const oi = from.orderIndexes[i];
        if (isPairDrop(orders[oi])) continue;
        const dropI = isPairPickup(orders[oi]) ? pairMateIndex(orders, oi) : -1;
        const pairMove = dropI >= 0 && from.orderIndexes.includes(dropI);
        const extra = pairMove ? 1 : 0;
        const demand = {
          vol: Math.max(0, num(orders[oi].volumeM3, 0)),
          wt: Math.max(0, num(orders[oi].weightKg, 0)),
        };
        for (const to of vehicleStates) {
          if (to.key === from.key) continue;
          if (maxStops > 0 && to.orderIndexes.length + 1 + extra > maxStops) continue;
          if (preferSameZone) {
            const cand = normalizeZoneKey(orders[oi]?.zone);
            const toDom = routeDominantZone(to.orderIndexes, orders);
            if (cand && toDom && cand !== toDom) continue;
          }
          if (pairMove) {
            const tentative = to.orderIndexes.concat([oi, dropI]);
            if (
              !routeLoadFeasible(tentative, orders, to.volumeCapacityM3, to.weightCapacityKg)
            ) {
              continue;
            }
            const pNode = orderMatrixIndex(oi);
            const dNode = orderMatrixIndex(dropI);
            const ins = bestPairInsertion(to.route, pNode, dNode, matrix, depotIdx);
            const fromBefore = pathKm(from.route, matrix, depotIdx, roundtrip);
            const toBefore = pathKm(to.route, matrix, depotIdx, roundtrip);
            const fromNext = from.orderIndexes.filter((x) => x !== oi && x !== dropI);
            const toNext = to.orderIndexes.slice();
            toNext.splice(ins.pPos, 0, oi);
            toNext.splice(ins.dPos, 0, dropI);
            const fromVs = { route: fromNext.map((x) => orderMatrixIndex(x)) };
            const toVs = { route: toNext.map((x) => orderMatrixIndex(x)) };
            const after =
              pathKm(fromVs.route, matrix, depotIdx, roundtrip) +
              pathKm(toVs.route, matrix, depotIdx, roundtrip);
            if (after > (fromBefore + toBefore) * 1.08 + 0.5) continue;
            from.orderIndexes = fromNext;
            to.orderIndexes = toNext;
            syncPairOrder(from, orders, orderMatrixIndex);
            syncPairOrder(to, orders, orderMatrixIndex);
            refreshResidual(from, orders);
            refreshResidual(to, orders);
            moves += 1;
            improved = true;
            break;
          }
          const toUsed = usedDemand(to, orders);
          if (
            !fits(
              {
                vol: to.volumeCapacityM3 - toUsed.vol,
                wt: to.weightCapacityKg - toUsed.wt,
              },
              demand,
            )
          ) {
            continue;
          }
          const nodeIdx = orderMatrixIndex(oi);
          const ins = bestInsertion(to.route, nodeIdx, matrix, depotIdx);
          const tw = evaluateTwInsertion({
            route: to.route,
            pos: ins.pos,
            oi,
            orders,
            matrix,
            depotIdx,
            orderMatrixIndex,
            twMode,
            dayStartMin:
              opts.perVehicleDayStart && to.dayStartMin != null ? to.dayStartMin : dayStartMin,
            serviceMinutes,
          });
          if (!tw.feasible) continue;

          const fromBefore = pathKm(from.route, matrix, depotIdx, roundtrip);
          const toBefore = pathKm(to.route, matrix, depotIdx, roundtrip);

          const fromRouteNext = from.route.slice();
          const fromIdx = fromRouteNext.indexOf(nodeIdx);
          if (fromIdx < 0) continue;
          fromRouteNext.splice(fromIdx, 1);
          const toRouteNext = to.route.slice();
          toRouteNext.splice(ins.pos, 0, nodeIdx);

          const fromAfter = pathKm(fromRouteNext, matrix, depotIdx, roundtrip);
          const toAfter = pathKm(toRouteNext, matrix, depotIdx, roundtrip);
          const before = fromBefore + toBefore;
          const after = fromAfter + toAfter;
          if (after > before * 1.08 + 0.5) continue;

          from.orderIndexes.splice(i, 1);
          to.orderIndexes.splice(ins.pos, 0, oi);
          syncRouteFromOrderIndexes(from, orderMatrixIndex);
          syncRouteFromOrderIndexes(to, orderMatrixIndex);
          refreshResidual(from, orders);
          refreshResidual(to, orders);
          moves += 1;
          improved = true;
          break;
        }
        if (improved) break;
      }
      if (improved) break;
    }
    if (!improved) break;
  }
  return moves;
}

/**
 * Assign each order index to a depot (nearest haversine; optional zone→depot prefer).
 * @param {{ lat: number, lon: number, zone?: string }[]} orders
 * @param {{ id: string, lat: number, lon: number }[]} depots
 * @param {{ preferZoneDepot?: boolean, zoneDepotMap?: Record<string, string> }} [opts]
 * @returns {Map<string, number[]>} depotId → order indexes
 */
export function partitionOrdersByNearestDepot(orders, depots, opts) {
  return partitionOrdersToDepots(orders, depots, opts, haversineKm);
}

/**
 * Bind vehicles to depots: honor meta.depotId, then greedily fill depots
 * with the highest remaining order demand / assigned capacity ratio.
 * @param {{ volumeCapacityM3: number, weightCapacityKg: number, meta?: object }[]} vehicles
 * @param {{ id: string }[]} depots
 * @param {Map<string, { vol: number, wt: number, orderCount: number }>} demandByDepot
 * @returns {Map<string, number[]>} depotId → vehicle indexes
 */
export function assignVehiclesToDepots(vehicles, depots, demandByDepot) {
  /** @type {Map<string, number[]>} */
  const out = new Map();
  for (const d of depots) out.set(String(d.id), []);
  if (!depots.length) return out;

  const depotIds = new Set(depots.map((d) => String(d.id)));
  const unbound = [];
  for (let i = 0; i < vehicles.length; i++) {
    const raw = vehicles[i].meta?.depotId;
    const id = raw != null && raw !== "" ? String(raw) : "";
    if (id && depotIds.has(id)) out.get(id).push(i);
    else unbound.push(i);
  }

  const capScore = (v) =>
    Math.max(0.1, num(v.volumeCapacityM3, 12)) * Math.max(1, num(v.weightCapacityKg, 1500));

  /** @type {Map<string, number>} */
  const assignedCap = new Map();
  for (const d of depots) {
    const id = String(d.id);
    let cap = 0;
    for (const vi of out.get(id) || []) cap += capScore(vehicles[vi]);
    assignedCap.set(id, cap);
  }

  unbound.sort((a, b) => capScore(vehicles[b]) - capScore(vehicles[a]));
  for (const vi of unbound) {
    let bestId = String(depots[0].id);
    let bestNeed = -Infinity;
    for (const d of depots) {
      const id = String(d.id);
      const dem = demandByDepot.get(id) || { vol: 0, wt: 0, orderCount: 0 };
      if (dem.orderCount <= 0) continue;
      const demand = dem.vol * dem.wt + dem.orderCount;
      const cap = assignedCap.get(id) || 0.1;
      const need = demand / cap;
      if (need > bestNeed) {
        bestNeed = need;
        bestId = id;
      }
    }
    // If no depot has orders, spread evenly by current vehicle count
    if (bestNeed === -Infinity) {
      bestId = [...out.entries()].sort((a, b) => a[1].length - b[1].length)[0][0];
    }
    out.get(bestId).push(vi);
    assignedCap.set(bestId, (assignedCap.get(bestId) || 0) + capScore(vehicles[vi]));
  }
  return out;
}

/**
 * @param {object} input
 * @param {"off"|"soft"|"hard"} [input.twMode]
 * @param {number} [input.serviceMinutes]
 * @param {number} [input.dayStartMin]
 * @param {number} [input.dayEndMin] — shift end for multi-trip (default 18:00)
 * @param {number} [input.maxStopsPerVehicle]
 * @param {boolean} [input.preferSameZone]
 * @param {"off"|"max2"|"unlimited"} [input.multiTripMode]
 * @param {number} [input.reloadMinutes] — depot dwell between trips
 */
export function planCvrp({
  orders,
  vehicles,
  matrixKm,
  points,
  depotIndex = null,
  roundtrip = false,
  twMode = "soft",
  serviceMinutes = DEFAULT_SERVICE_MIN,
  dayStartMin = DEFAULT_DAY_START_MIN,
  dayEndMin = DEFAULT_DAY_END_MIN,
  maxStopsPerVehicle = 0,
  preferSameZone = false,
  multiTripMode = "off",
  reloadMinutes = DEFAULT_RELOAD_MIN,
}) {
  const mode = ["off", "soft", "hard"].includes(twMode) ? twMode : "soft";
  const svcMin = Math.max(0, Math.min(120, Number(serviceMinutes) || DEFAULT_SERVICE_MIN));
  const startMin = Number.isFinite(Number(dayStartMin)) ? Number(dayStartMin) : DEFAULT_DAY_START_MIN;
  const endMin = Number.isFinite(Number(dayEndMin)) ? Number(dayEndMin) : DEFAULT_DAY_END_MIN;
  const reloadMin = Math.max(0, Math.min(120, Number(reloadMinutes) || DEFAULT_RELOAD_MIN));
  const maxStops = Math.max(0, Math.floor(Number(maxStopsPerVehicle) || 0));
  const sameZone = Boolean(preferSameZone);
  const tripMode = ["off", "max2", "unlimited"].includes(multiTripMode) ? multiTripMode : "off";
  // Multi-trip needs a depot (return → unload → go again). Open tours stay single-trip.
  const maxTrips =
    tripMode === "off" || depotIndex == null
      ? 1
      : tripMode === "max2"
        ? 2
        : 12;
  // Time budget for a second trip assumes a return to depot.
  const forceRoundtrip = Boolean(roundtrip && depotIndex != null) || maxTrips > 1;

  const orderMatrixIndex = (orderPos) => (depotIndex != null ? orderPos + 1 : orderPos);
  const unassigned = new Set(orders.map((_, i) => i));

  const vehicleStates = vehicles.map((v) => {
    const fullVol = num(v.meta?.fullVolumeCapacityM3, num(v.volumeCapacityM3, 12));
    const fullWt = num(v.meta?.fullWeightCapacityKg, num(v.weightCapacityKg, 1500));
    return {
      key: v.key,
      label: v.label || v.key,
      volumeCapacityM3: num(v.volumeCapacityM3, 12),
      weightCapacityKg: num(v.weightCapacityKg, 1500),
      fullVol,
      fullWt,
      meta: v.meta || {},
      residualVol: num(v.volumeCapacityM3, 12),
      residualWt: num(v.weightCapacityKg, 1500),
      route: [],
      orderIndexes: [],
      dayStartMin: startMin,
      locked: false,
    };
  });

  vehicleStates.sort(
    (a, b) =>
      (Number(a.meta?.existingStops) || 0) - (Number(b.meta?.existingStops) || 0) ||
      b.fullVol * b.fullWt - a.fullVol * a.fullWt ||
      b.fullVol - a.fullVol,
  );

  const ordersByMatrixIdx = new Map();
  for (let i = 0; i < orders.length; i++) {
    ordersByMatrixIdx.set(orderMatrixIndex(i), orders[i]);
  }

  /** @type {any[]} */
  const collectedRoutes = [];
  let balanceMoves = 0;

  for (let trip = 1; trip <= maxTrips; trip++) {
    if (unassigned.size === 0) break;
    const eligible = vehicleStates.filter((vs) => !vs.locked);
    if (!eligible.length) break;

    // Reset this trip's load (trip 1 keeps residual; trip 2+ uses full capacity after depot unload).
    for (const vs of eligible) {
      if (trip > 1) {
        vs.volumeCapacityM3 = vs.fullVol;
        vs.weightCapacityKg = vs.fullWt;
        vs.residualVol = vs.fullVol;
        vs.residualWt = vs.fullWt;
      }
      vs.route = [];
      vs.orderIndexes = [];
    }

    let guard = 0;
    const maxIter = unassigned.size * Math.max(1, eligible.length) * 4 + 50;
    while (unassigned.size > 0 && guard++ < maxIter) {
      let best = null;
      for (const vs of eligible) {
        if (maxStops > 0 && vs.orderIndexes.length >= maxStops) continue;
        for (const oi of unassigned) {
          if (isPairDrop(orders[oi])) continue;
          if (isPairPickup(orders[oi])) {
            const dropI = pairMateIndex(orders, oi);
            if (dropI < 0 || !unassigned.has(dropI)) continue;
            if (maxStops > 0 && vs.orderIndexes.length + 2 > maxStops) continue;
            const pNode = orderMatrixIndex(oi);
            const dNode = orderMatrixIndex(dropI);
            const ins = bestPairInsertion(vs.route, pNode, dNode, matrixKm, depotIndex);
            const tentativeIdx = vs.orderIndexes.slice();
            tentativeIdx.splice(ins.pPos, 0, oi);
            tentativeIdx.splice(ins.dPos, 0, dropI);
            if (
              !routeLoadFeasible(tentativeIdx, orders, vs.volumeCapacityM3, vs.weightCapacityKg)
            ) {
              continue;
            }
            const twP = evaluateTwInsertion({
              route: vs.route,
              pos: ins.pPos,
              oi,
              orders,
              matrix: matrixKm,
              depotIdx: depotIndex,
              orderMatrixIndex,
              twMode: mode,
              dayStartMin: vs.dayStartMin,
              serviceMinutes: svcMin,
            });
            if (!twP.feasible) continue;
            const routeAfterP = vs.route.slice();
            routeAfterP.splice(ins.pPos, 0, pNode);
            const twD = evaluateTwInsertion({
              route: routeAfterP,
              pos: ins.dPos,
              oi: dropI,
              orders,
              matrix: matrixKm,
              depotIdx: depotIndex,
              orderMatrixIndex,
              twMode: mode,
              dayStartMin: vs.dayStartMin,
              serviceMinutes: svcMin,
            });
            if (!twD.feasible) continue;
            const tentativeRoute = routeAfterP.slice();
            tentativeRoute.splice(ins.dPos, 0, dNode);
            if (maxTrips > 1 && depotIndex != null) {
              const ret = estimateReturnMin({
                route: tentativeRoute,
                ordersByMatrixIdx,
                matrix: matrixKm,
                depotIdx: depotIndex,
                dayStartMin: vs.dayStartMin,
                serviceMinutes: svcMin,
              });
              if (ret != null && ret > endMin) continue;
            }
            const score =
              ins.cost +
              (mode === "off" ? 0 : twP.penalty + twD.penalty) +
              zoneMixPenalty(sameZone, vs.orderIndexes, orders, oi);
            if (!best || score < best.score - 1e-9) {
              best = {
                kind: "pair",
                vs,
                oi,
                dropI,
                pPos: ins.pPos,
                dPos: ins.dPos,
                pNode,
                dNode,
                score,
              };
            }
            continue;
          }
          const demand = {
            vol: Math.max(0, num(orders[oi].volumeM3, 0)),
            wt: Math.max(0, num(orders[oi].weightKg, 0)),
          };
          if (!fits({ vol: vs.residualVol, wt: vs.residualWt }, demand)) continue;
          if (maxStops > 0 && vs.orderIndexes.length + 1 > maxStops) continue;
          const nodeIdx = orderMatrixIndex(oi);
          const ins = bestInsertion(vs.route, nodeIdx, matrixKm, depotIndex);
          const tw = evaluateTwInsertion({
            route: vs.route,
            pos: ins.pos,
            oi,
            orders,
            matrix: matrixKm,
            depotIdx: depotIndex,
            orderMatrixIndex,
            twMode: mode,
            dayStartMin: vs.dayStartMin,
            serviceMinutes: svcMin,
          });
          if (!tw.feasible) continue;
          const tentativeIdx = vs.orderIndexes.slice();
          tentativeIdx.splice(ins.pos, 0, oi);
          if (!routeLoadFeasible(tentativeIdx, orders, vs.volumeCapacityM3, vs.weightCapacityKg)) {
            continue;
          }
          if (maxTrips > 1 && depotIndex != null) {
            const tentative = vs.route.slice();
            tentative.splice(ins.pos, 0, nodeIdx);
            const ret = estimateReturnMin({
              route: tentative,
              ordersByMatrixIdx,
              matrix: matrixKm,
              depotIdx: depotIndex,
              dayStartMin: vs.dayStartMin,
              serviceMinutes: svcMin,
            });
            if (ret != null && ret > endMin) continue;
          }
          const score =
            ins.cost +
            (mode === "off" ? 0 : tw.penalty) +
            zoneMixPenalty(sameZone, vs.orderIndexes, orders, oi);
          if (!best || score < best.score - 1e-9) {
            best = { kind: "single", vs, oi, nodeIdx, pos: ins.pos, score, demand };
          }
        }
      }
      if (!best) break;
      if (best.kind === "pair") {
        best.vs.route.splice(best.pPos, 0, best.pNode);
        best.vs.orderIndexes.splice(best.pPos, 0, best.oi);
        best.vs.route.splice(best.dPos, 0, best.dNode);
        best.vs.orderIndexes.splice(best.dPos, 0, best.dropI);
        refreshResidual(best.vs, orders);
        unassigned.delete(best.oi);
        unassigned.delete(best.dropI);
      } else {
        best.vs.route.splice(best.pos, 0, best.nodeIdx);
        best.vs.orderIndexes.splice(best.pos, 0, best.oi);
        refreshResidual(best.vs, orders);
        unassigned.delete(best.oi);
      }
    }

    // Balance only within this trip (shared start times roughly similar).
    balanceMoves += balanceRelocate(
      eligible,
      orders,
      matrixKm,
      depotIndex,
      forceRoundtrip,
      orderMatrixIndex,
      {
        twMode: mode,
        dayStartMin: startMin,
        serviceMinutes: svcMin,
        maxStopsPerVehicle: maxStops,
        preferSameZone: sameZone,
        perVehicleDayStart: true,
      },
    );

    let anyTripBuilt = false;
    for (const vs of eligible) {
      if (!vs.orderIndexes.length) continue;
      anyTripBuilt = true;

      if (vs.route.length < 2) {
        vs.distanceKm = vs.route.length
          ? pathKm(vs.route, matrixKm, depotIndex, forceRoundtrip)
          : 0;
      } else {
        const improved = routeDistance(vs.route, matrixKm, depotIndex, forceRoundtrip);
        vs.route = improved.order;
        const byMatrix = new Map();
        for (let i = 0; i < orders.length; i++) {
          byMatrix.set(orderMatrixIndex(i), i);
        }
        vs.orderIndexes = vs.route.map((mi) => byMatrix.get(mi)).filter((x) => x != null);
        syncPairOrder(vs, orders, orderMatrixIndex);
        vs.distanceKm = Math.round(improved.distanceKm * 100) / 100;
      }

      vs.schedule = simulateRouteSchedule({
        route: vs.route,
        ordersByMatrixIdx,
        matrix: matrixKm,
        depotIdx: depotIndex,
        dayStartMin: vs.dayStartMin,
        serviceMinutes: svcMin,
      });

      const { vol: volUsed, wt: wtUsed } = usedDemand(vs, orders);
      const lateCount = (vs.schedule || []).filter((s) => s.late).length;
      const tripKey = trip === 1 ? vs.key : `${vs.key}:trip${trip}`;
      const tripLabel = trip === 1 ? vs.label : `${vs.label} · trip ${trip}`;
      collectedRoutes.push({
        key: tripKey,
        label: tripLabel,
        meta: {
          ...vs.meta,
          tripIndex: trip,
          parentKey: vs.key,
          tripStartMin: vs.dayStartMin,
        },
        orderIds: vs.orderIndexes.map((i) => orders[i].sourceOrderId || orders[i].id),
        stopRoles: vs.orderIndexes.map((i) => (orders[i].role === "pickup" ? "pickup" : "drop")),
        orderIndexes: vs.orderIndexes.slice(),
        volumeUsed: Math.round(volUsed * 1000) / 1000,
        weightUsed: Math.round(wtUsed * 10) / 10,
        volumeCapacityM3: vs.volumeCapacityM3,
        weightCapacityKg: vs.weightCapacityKg,
        utilizationPct: Math.round(utilPct(vs, orders) * 10) / 10,
        distanceKm: vs.distanceKm ?? 0,
        lateStops: lateCount,
        stops: (vs.schedule || []).map((s) => ({
          orderId: s.orderId,
          label: s.label,
          arriveAt: s.arriveAt,
          departAt: s.departAt,
          serviceMinutes: s.serviceMinutes,
          windowStart: s.windowStart,
          windowEnd: s.windowEnd,
          late: s.late,
          early: s.early,
          role: s.role || "drop",
        })),
      });

      // Prepare next trip window: return to depot + reload.
      if (trip < maxTrips && depotIndex != null) {
        const ret = estimateReturnMin({
          route: vs.route,
          ordersByMatrixIdx,
          matrix: matrixKm,
          depotIdx: depotIndex,
          dayStartMin: vs.dayStartMin,
          serviceMinutes: svcMin,
        });
        const nextStart = (ret ?? vs.dayStartMin) + reloadMin;
        // Need room for at least a short next hop before day end.
        if (nextStart + 30 >= endMin) {
          vs.locked = true;
        } else {
          vs.dayStartMin = nextStart;
        }
      } else if (trip >= maxTrips) {
        vs.locked = true;
      }
    }

    if (!anyTripBuilt) break;
    if (unassigned.size === 0) break;
    if (trip < maxTrips && vehicleStates.every((vs) => vs.locked)) break;
  }

  const unassignedList = [];
  const seenUnassigned = new Set();
  for (const i of unassigned) {
    const o = orders[i];
    if (isPairDrop(o)) continue;
    const oid = o.sourceOrderId || o.id;
    if (seenUnassigned.has(oid)) continue;
    seenUnassigned.add(oid);
    const demand = {
      vol: Math.max(0, num(o.volumeM3, 0)),
      wt: Math.max(0, num(o.weightKg, 0)),
    };
    const anyFit = vehicleStates.some((vs) =>
      fits({ vol: vs.fullVol, wt: vs.fullWt }, demand),
    );
    let reason = anyFit ? "no_feasible_insertion" : "exceeds_all_vehicle_capacity";
    if (anyFit && mode === "hard" && (o.windowStart || o.windowEnd)) {
      reason = "time_window_or_capacity";
    }
    if (anyFit && maxTrips > 1 && vehicleStates.every((vs) => vs.locked)) {
      reason = "no_shift_time_for_next_trip";
    }
    unassignedList.push({
      orderId: oid,
      label: o.label || oid,
      reason,
    });
  }

  return {
    routes: collectedRoutes,
    unassigned: unassignedList,
    pointCount: points.length,
    depotIndex,
    roundtrip: forceRoundtrip,
    balanceMoves,
    twMode: mode,
    serviceMinutes: svcMin,
    dayStartMin: startMin,
    dayEndMin: endMin,
    maxStopsPerVehicle: maxStops,
    multiTripMode: maxTrips > 1 ? tripMode : "off",
    reloadMinutes: reloadMin,
    maxTrips,
  };
}

/** Last-stop depart + drive back to depot (or last depart if open). */
function estimateReturnMin({
  route,
  ordersByMatrixIdx,
  matrix,
  depotIdx,
  dayStartMin,
  serviceMinutes,
}) {
  if (!route.length) return dayStartMin;
  const schedule = simulateRouteSchedule({
    route,
    ordersByMatrixIdx,
    matrix,
    depotIdx,
    dayStartMin,
    serviceMinutes,
  });
  const last = schedule[schedule.length - 1];
  if (!last) return dayStartMin;
  if (depotIdx == null) return last.departMin;
  return last.departMin + travelMinutes(matrix, route[route.length - 1], depotIdx);
}
