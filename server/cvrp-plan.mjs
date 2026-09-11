/**
 * Capacitated VRP (dual volume + weight) — greedy cheapest insertion,
 * soft time-window preference, inter-route balance relocate, open-tour 2-opt.
 * Multi-depot: partition orders to nearest depot, then planCvrp per cluster.
 */
import { haversineKm, optimizeOpenTour, pathCost } from "./route-optimize.mjs";

const SPEED_KMH = 35;
const TW_LATE_PENALTY_KM = 40;
const TW_EARLY_PENALTY_KM = 2;
const DEFAULT_DAY_START_MIN = 8 * 60; // 08:00
const DEFAULT_SERVICE_MIN = 8;

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
    const departMin = t + serviceMinutes;
    stops.push({
      matrixIdx: cur,
      orderId: order?.id || null,
      label: order?.label || "",
      arriveMin,
      arriveAt: formatMinutesClock(arriveMin),
      departMin,
      departAt: formatMinutesClock(departMin),
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

function bestInsertion(route, nodeIdx, matrix, depotIdx) {
  if (!route.length) {
    const seedCost = depotIdx != null ? matrix[depotIdx][nodeIdx] : 0;
    return { pos: 0, cost: seedCost };
  }
  let bestPos = 0;
  let bestCost = Infinity;
  for (let pos = 0; pos <= route.length; pos++) {
    let delta;
    if (pos === 0) {
      const next = route[0];
      const from = depotIdx != null ? depotIdx : null;
      delta =
        from != null
          ? matrix[from][nodeIdx] + matrix[nodeIdx][next] - matrix[from][next]
          : matrix[nodeIdx][next];
    } else if (pos === route.length) {
      const prev = route[route.length - 1];
      delta = matrix[prev][nodeIdx];
    } else {
      const prev = route[pos - 1];
      const next = route[pos];
      delta = matrix[prev][nodeIdx] + matrix[nodeIdx][next] - matrix[prev][next];
    }
    if (delta < bestCost) {
      bestCost = delta;
      bestPos = pos;
    }
  }
  return { pos: bestPos, cost: bestCost };
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
    t += serviceMinutes;
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
  let vol = 0;
  let wt = 0;
  for (const oi of vs.orderIndexes) {
    vol += Math.max(0, num(orders[oi].volumeM3, 0));
    wt += Math.max(0, num(orders[oi].weightKg, 0));
  }
  return { vol, wt };
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
        const demand = {
          vol: Math.max(0, num(orders[oi].volumeM3, 0)),
          wt: Math.max(0, num(orders[oi].weightKg, 0)),
        };
        for (const to of vehicleStates) {
          if (to.key === from.key) continue;
          if (maxStops > 0 && to.orderIndexes.length >= maxStops) continue;
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
            dayStartMin,
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
          from.residualVol = from.volumeCapacityM3 - usedDemand(from, orders).vol;
          from.residualWt = from.weightCapacityKg - usedDemand(from, orders).wt;
          to.residualVol = to.volumeCapacityM3 - usedDemand(to, orders).vol;
          to.residualWt = to.weightCapacityKg - usedDemand(to, orders).wt;
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
 * Assign each order index to the nearest depot (haversine).
 * @param {{ lat: number, lon: number }[]} orders
 * @param {{ id: string, lat: number, lon: number }[]} depots
 * @returns {Map<string, number[]>} depotId → order indexes
 */
export function partitionOrdersByNearestDepot(orders, depots) {
  /** @type {Map<string, number[]>} */
  const clusters = new Map();
  for (const d of depots) clusters.set(String(d.id), []);
  if (!depots.length) return clusters;
  for (let i = 0; i < orders.length; i++) {
    const o = orders[i];
    let bestId = String(depots[0].id);
    let bestKm = Infinity;
    for (const d of depots) {
      const km = haversineKm(o.lat, o.lon, d.lat, d.lon);
      if (km < bestKm) {
        bestKm = km;
        bestId = String(d.id);
      }
    }
    clusters.get(bestId).push(i);
  }
  return clusters;
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
 * @param {number} [input.maxStopsPerVehicle]
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
  maxStopsPerVehicle = 0,
}) {
  const mode = ["off", "soft", "hard"].includes(twMode) ? twMode : "soft";
  const svcMin = Math.max(0, Math.min(120, Number(serviceMinutes) || DEFAULT_SERVICE_MIN));
  const startMin = Number.isFinite(Number(dayStartMin)) ? Number(dayStartMin) : DEFAULT_DAY_START_MIN;
  const maxStops = Math.max(0, Math.floor(Number(maxStopsPerVehicle) || 0));

  const orderMatrixIndex = (orderPos) => (depotIndex != null ? orderPos + 1 : orderPos);
  const unassigned = new Set(orders.map((_, i) => i));

  const vehicleStates = vehicles.map((v) => ({
    key: v.key,
    label: v.label || v.key,
    volumeCapacityM3: num(v.volumeCapacityM3, 12),
    weightCapacityKg: num(v.weightCapacityKg, 1500),
    meta: v.meta || {},
    residualVol: num(v.volumeCapacityM3, 12),
    residualWt: num(v.weightCapacityKg, 1500),
    route: [],
    orderIndexes: [],
  }));

  vehicleStates.sort(
    (a, b) =>
      (Number(a.meta?.existingStops) || 0) - (Number(b.meta?.existingStops) || 0) ||
      b.volumeCapacityM3 * b.weightCapacityKg - a.volumeCapacityM3 * a.weightCapacityKg ||
      b.volumeCapacityM3 - a.volumeCapacityM3,
  );

  let guard = 0;
  const maxIter = orders.length * Math.max(1, vehicles.length) * 4 + 50;
  while (unassigned.size > 0 && guard++ < maxIter) {
    let best = null;
    for (const vs of vehicleStates) {
      if (maxStops > 0 && vs.orderIndexes.length >= maxStops) continue;
      for (const oi of unassigned) {
        const demand = {
          vol: Math.max(0, num(orders[oi].volumeM3, 0)),
          wt: Math.max(0, num(orders[oi].weightKg, 0)),
        };
        if (!fits({ vol: vs.residualVol, wt: vs.residualWt }, demand)) continue;
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
          dayStartMin: startMin,
          serviceMinutes: svcMin,
        });
        if (!tw.feasible) continue;
        const score = ins.cost + (mode === "off" ? 0 : tw.penalty);
        if (!best || score < best.score - 1e-9) {
          best = { vs, oi, nodeIdx, pos: ins.pos, score, demand };
        }
      }
    }
    if (!best) break;
    best.vs.route.splice(best.pos, 0, best.nodeIdx);
    best.vs.orderIndexes.splice(best.pos, 0, best.oi);
    best.vs.residualVol -= best.demand.vol;
    best.vs.residualWt -= best.demand.wt;
    unassigned.delete(best.oi);
  }

  const balanceMoves = balanceRelocate(
    vehicleStates,
    orders,
    matrixKm,
    depotIndex,
    roundtrip,
    orderMatrixIndex,
    { twMode: mode, dayStartMin: startMin, serviceMinutes: svcMin, maxStopsPerVehicle: maxStops },
  );

  const ordersByMatrixIdx = new Map();
  for (let i = 0; i < orders.length; i++) {
    ordersByMatrixIdx.set(orderMatrixIndex(i), orders[i]);
  }

  for (const vs of vehicleStates) {
    if (vs.route.length < 2) {
      vs.distanceKm = vs.route.length ? pathKm(vs.route, matrixKm, depotIndex, roundtrip) : 0;
    } else {
      const improved = routeDistance(vs.route, matrixKm, depotIndex, roundtrip);
      vs.route = improved.order;
      const byMatrix = new Map();
      for (let i = 0; i < orders.length; i++) {
        byMatrix.set(orderMatrixIndex(i), i);
      }
      vs.orderIndexes = vs.route.map((mi) => byMatrix.get(mi)).filter((x) => x != null);
      vs.distanceKm = Math.round(improved.distanceKm * 100) / 100;
    }
    vs.schedule = simulateRouteSchedule({
      route: vs.route,
      ordersByMatrixIdx,
      matrix: matrixKm,
      depotIdx: depotIndex,
      dayStartMin: startMin,
      serviceMinutes: svcMin,
    });
  }

  const routes = vehicleStates
    .filter((vs) => vs.orderIndexes.length > 0)
    .map((vs) => {
      const { vol: volUsed, wt: wtUsed } = usedDemand(vs, orders);
      const lateCount = (vs.schedule || []).filter((s) => s.late).length;
      return {
        key: vs.key,
        label: vs.label,
        meta: vs.meta,
        orderIds: vs.orderIndexes.map((i) => orders[i].id),
        orderIndexes: vs.orderIndexes,
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
          windowStart: s.windowStart,
          windowEnd: s.windowEnd,
          late: s.late,
          early: s.early,
        })),
      };
    });

  const unassignedList = [...unassigned].map((i) => {
    const o = orders[i];
    const demand = {
      vol: Math.max(0, num(o.volumeM3, 0)),
      wt: Math.max(0, num(o.weightKg, 0)),
    };
    const anyFit = vehicleStates.some((vs) =>
      fits({ vol: vs.volumeCapacityM3, wt: vs.weightCapacityKg }, demand),
    );
    let reason = anyFit ? "no_feasible_insertion" : "exceeds_all_vehicle_capacity";
    if (anyFit && mode === "hard" && (o.windowStart || o.windowEnd)) {
      reason = "time_window_or_capacity";
    }
    return {
      orderId: o.id,
      label: o.label || o.id,
      reason,
    };
  });

  return {
    routes,
    unassigned: unassignedList,
    pointCount: points.length,
    depotIndex,
    roundtrip: Boolean(roundtrip && depotIndex != null),
    balanceMoves,
    twMode: mode,
    serviceMinutes: svcMin,
    dayStartMin: startMin,
    maxStopsPerVehicle: maxStops,
  };
}
