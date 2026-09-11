/**
 * Capacitated VRP (dual volume + weight) — greedy cheapest insertion + open-tour 2-opt.
 * Pure logic; matrix and persistence live outside.
 */
import { optimizeOpenTour, pathCost } from "./route-optimize.mjs";

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function fits(residual, demand) {
  return residual.vol + 1e-9 >= demand.vol && residual.wt + 1e-9 >= demand.wt;
}

/**
 * Cheapest insertion cost delta for inserting nodeIdx into open path `route`
 * (route holds matrix indices). matrix[i][j] = km.
 */
function bestInsertion(route, nodeIdx, matrix, depotIdx) {
  if (!route.length) {
    // Seed: cost from depot (if any) else 0
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

function routeDistance(route, matrix, depotIdx, roundtrip) {
  if (!route.length) return 0;
  let order = route.slice();
  if (depotIdx != null) {
    // Optimize customer order only, then score with depot legs
    const n = order.length;
    const sub = Array.from({ length: n }, () => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) sub[i][j] = matrix[order[i]][order[j]];
    }
    // Re-seed: put closest-to-depot first
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
      const rotated = order.slice(startLocal).concat(order.slice(0, startLocal));
      order = rotated;
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
  // Open: fix start as current first, 2-opt
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

/**
 * @param {object} input
 * @param {{ id: string, lat: number, lon: number, volumeM3?: number|null, weightKg?: number|null, label?: string }[]} input.orders
 * @param {{ key: string, label?: string, volumeCapacityM3: number, weightCapacityKg: number, meta?: object }[]} input.vehicles
 * @param {number[][]} input.matrixKm — indexes match `points`
 * @param {{ lat: number, lon: number }[]} input.points — [depot?, ...orders]
 * @param {number|null} input.depotIndex — 0 if depot present, else null
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
  const assigned = [];

  const vehicleStates = vehicles.map((v) => ({
    key: v.key,
    label: v.label || v.key,
    volumeCapacityM3: num(v.volumeCapacityM3, 12),
    weightCapacityKg: num(v.weightCapacityKg, 1500),
    meta: v.meta || {},
    residualVol: num(v.volumeCapacityM3, 12),
    residualWt: num(v.weightCapacityKg, 1500),
    route: [], // matrix indices of customers
    orderIndexes: [], // indexes into orders[]
  }));

  // Prefer empty / lighter jobs, then larger residual capacity
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
        if (!best || ins.cost < best.cost - 1e-9) {
          best = { vs, oi, nodeIdx, pos: ins.pos, cost: ins.cost, demand };
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

  // Improve each route order
  for (const vs of vehicleStates) {
    if (vs.route.length < 2) continue;
    const improved = routeDistance(vs.route, matrixKm, depotIndex, roundtrip);
    vs.route = improved.order;
    // Rebuild orderIndexes to match matrix route order
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
      const volUsed = vs.orderIndexes.reduce(
        (s, i) => s + Math.max(0, num(orders[i].volumeM3, 0)),
        0,
      );
      const wtUsed = vs.orderIndexes.reduce(
        (s, i) => s + Math.max(0, num(orders[i].weightKg, 0)),
        0,
      );
      const utilV = vs.volumeCapacityM3 > 0 ? (volUsed / vs.volumeCapacityM3) * 100 : 0;
      const utilW = vs.weightCapacityKg > 0 ? (wtUsed / vs.weightCapacityKg) * 100 : 0;
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
        utilizationPct: Math.round(Math.max(utilV, utilW) * 10) / 10,
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
  };
}
