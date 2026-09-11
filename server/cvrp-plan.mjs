/**
 * Capacitated VRP (dual volume + weight) — greedy cheapest insertion,
 * soft time-window preference, inter-route balance relocate, open-tour 2-opt.
 */
import { optimizeOpenTour, pathCost } from "./route-optimize.mjs";

const SPEED_KMH = 35;
const TW_LATE_PENALTY_KM = 40;
const TW_EARLY_PENALTY_KM = 2;
const DAY_START_MIN = 8 * 60; // 08:00

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
 * Soft TW penalty for inserting `oi` at `pos` in route (matrix indices).
 * Estimates travel time along the tentative path from day start / depot.
 */
function softTwPenalty(route, pos, oi, orders, matrix, depotIdx, orderMatrixIndex) {
  const order = orders[oi];
  const winStart = parseWindowMinutes(order.windowStart);
  const winEnd = parseWindowMinutes(order.windowEnd);
  if (winStart == null && winEnd == null) return 0;

  const nodeIdx = orderMatrixIndex(oi);
  const tentative = route.slice();
  tentative.splice(pos, 0, nodeIdx);

  let t = DAY_START_MIN;
  let prev = depotIdx;
  for (let i = 0; i < tentative.length; i++) {
    const cur = tentative[i];
    const km = prev != null ? matrix[prev][cur] : 0;
    const travelMin = Number.isFinite(km) && km < 1e8 ? (km / SPEED_KMH) * 60 : 0;
    t += travelMin;
    if (cur === nodeIdx) {
      let penalty = 0;
      if (winStart != null && t < winStart) penalty += ((winStart - t) / 60) * TW_EARLY_PENALTY_KM;
      if (winEnd != null && t > winEnd) penalty += ((t - winEnd) / 60) * TW_LATE_PENALTY_KM;
      return penalty;
    }
    // Service dwell ~8 min
    t += 8;
    prev = cur;
  }
  return 0;
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
function balanceRelocate(vehicleStates, orders, matrix, depotIdx, roundtrip, orderMatrixIndex) {
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

          // Apply move
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
 * @param {object} input
 * @param {{ id: string, lat: number, lon: number, volumeM3?: number|null, weightKg?: number|null, label?: string, windowStart?: string, windowEnd?: string }[]} input.orders
 * @param {{ key: string, label?: string, volumeCapacityM3: number, weightCapacityKg: number, meta?: object }[]} input.vehicles
 * @param {number[][]} input.matrixKm
 * @param {{ lat: number, lon: number }[]} input.points
 * @param {number|null} input.depotIndex
 * @param {boolean} [input.roundtrip]
 */
export function planCvrp({
  orders,
  vehicles,
  matrixKm,
  points,
  depotIndex = null,
  roundtrip = false,
}) {
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
      for (const oi of unassigned) {
        const demand = {
          vol: Math.max(0, num(orders[oi].volumeM3, 0)),
          wt: Math.max(0, num(orders[oi].weightKg, 0)),
        };
        if (!fits({ vol: vs.residualVol, wt: vs.residualWt }, demand)) continue;
        const nodeIdx = orderMatrixIndex(oi);
        const ins = bestInsertion(vs.route, nodeIdx, matrixKm, depotIndex);
        const tw = softTwPenalty(
          vs.route,
          ins.pos,
          oi,
          orders,
          matrixKm,
          depotIndex,
          orderMatrixIndex,
        );
        const score = ins.cost + tw;
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
  );

  for (const vs of vehicleStates) {
    if (vs.route.length < 2) {
      vs.distanceKm = vs.route.length ? pathKm(vs.route, matrixKm, depotIndex, roundtrip) : 0;
      continue;
    }
    const improved = routeDistance(vs.route, matrixKm, depotIndex, roundtrip);
    vs.route = improved.order;
    const byMatrix = new Map();
    for (let i = 0; i < orders.length; i++) {
      byMatrix.set(orderMatrixIndex(i), i);
    }
    vs.orderIndexes = vs.route.map((mi) => byMatrix.get(mi)).filter((x) => x != null);
    vs.distanceKm = Math.round(improved.distanceKm * 100) / 100;
  }

  const routes = vehicleStates
    .filter((vs) => vs.orderIndexes.length > 0)
    .map((vs) => {
      const { vol: volUsed, wt: wtUsed } = usedDemand(vs, orders);
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
    return {
      orderId: o.id,
      label: o.label || o.id,
      reason: anyFit ? "no_feasible_insertion" : "exceeds_all_vehicle_capacity",
    };
  });

  return {
    routes,
    unassigned: unassignedList,
    pointCount: points.length,
    depotIndex,
    roundtrip: Boolean(roundtrip && depotIndex != null),
    balanceMoves,
  };
}
