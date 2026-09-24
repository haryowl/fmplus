/**
 * Pickup/drop helpers — drop-only, pickup-only, and pickup_drop pairs
 * (same vehicle, pickup before drop, no cross-depot).
 */
import { haversineKm } from "./route-optimize.mjs";
import { partitionOrdersToDepots } from "./dispatch-zone.mjs";

export function parseOrderKind(v) {
  const s = String(v || "drop").toLowerCase().replace(/[\s-]+/g, "_");
  if (s === "pickup_drop" || s === "both") return "pickup_drop";
  if (s === "pickup" || s === "pickup_only" || s === "collect") return "pickup";
  return "drop";
}

export function isPickupDropOrder(row) {
  if (!row) return false;
  return parseOrderKind(row.kind) === "pickup_drop";
}

export function isPickupOnlyOrder(row) {
  if (!row) return false;
  return parseOrderKind(row.kind) === "pickup";
}

export function finiteCoord(lat, lon) {
  const a = Number(lat);
  const b = Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  if (a === 0 && b === 0) return null;
  return { lat: a, lon: b };
}

/** Drop (customer) point — existing lat/lon columns. */
export function dropCoord(row) {
  return finiteCoord(row.lat, row.lon);
}

/** Pickup point from pickup_* columns. */
export function pickupCoord(row) {
  return finiteCoord(row.pickup_lat ?? row.pickupLat, row.pickup_lon ?? row.pickupLon);
}

/**
 * Expand pending orders into planner tasks (one or two matrix nodes).
 * Drop-only stays a single preloaded drop. Pairs become pickup then drop.
 */
export function expandOrdersToPlanTasks(orders) {
  const tasks = [];
  for (const o of orders) {
    const label = o.label || o.customerName || o.id;
    const vol = Math.max(0, Number(o.volumeM3) || 0);
    const wt = Math.max(0, Number(o.weightKg) || 0);
    if (isPickupOnlyOrder(o)) {
      const p = dropCoord(o) || pickupCoord(o);
      if (!p) continue;
      tasks.push({
        id: o.id,
        sourceOrderId: o.id,
        role: "pickup",
        pairKey: null,
        preloaded: false,
        lat: p.lat,
        lon: p.lon,
        volumeM3: vol,
        weightKg: wt,
        windowStart: o.windowStart || o.window_start || o.pickupWindowStart || o.pickup_window_start || "",
        windowEnd: o.windowEnd || o.window_end || o.pickupWindowEnd || o.pickup_window_end || "",
        serviceMinutes: o.serviceMinutes ?? o.service_minutes ?? null,
        zone: o.zone || o.pickupZone || o.pickup_zone || "",
        label: `${label} · P`,
      });
      continue;
    }
    if (isPickupDropOrder(o)) {
      const p = pickupCoord(o);
      const d = dropCoord(o);
      if (!p || !d) continue;
      tasks.push({
        id: `${o.id}:pickup`,
        sourceOrderId: o.id,
        role: "pickup",
        pairKey: o.id,
        preloaded: false,
        lat: p.lat,
        lon: p.lon,
        volumeM3: vol,
        weightKg: wt,
        windowStart: o.pickupWindowStart || o.pickup_window_start || "",
        windowEnd: o.pickupWindowEnd || o.pickup_window_end || "",
        serviceMinutes: o.pickupServiceMinutes ?? o.pickup_service_minutes ?? o.serviceMinutes ?? null,
        zone: o.pickupZone || o.pickup_zone || o.zone || "",
        label: `${label} · P`,
      });
      tasks.push({
        id: `${o.id}:drop`,
        sourceOrderId: o.id,
        role: "drop",
        pairKey: o.id,
        preloaded: false,
        lat: d.lat,
        lon: d.lon,
        volumeM3: vol,
        weightKg: wt,
        windowStart: o.windowStart || o.window_start || "",
        windowEnd: o.windowEnd || o.window_end || "",
        serviceMinutes: o.serviceMinutes ?? o.service_minutes ?? null,
        zone: o.zone || "",
        label: `${label} · D`,
      });
    } else {
      const d = dropCoord(o);
      if (!d) continue;
      tasks.push({
        id: o.id,
        sourceOrderId: o.id,
        role: "drop",
        pairKey: null,
        preloaded: true,
        lat: d.lat,
        lon: d.lon,
        volumeM3: vol,
        weightKg: wt,
        windowStart: o.windowStart || o.window_start || "",
        windowEnd: o.windowEnd || o.window_end || "",
        serviceMinutes: o.serviceMinutes ?? o.service_minutes ?? null,
        zone: o.zone || "",
        label,
      });
    }
  }
  return tasks;
}

/**
 * Nearest depot id for a point, or "".
 */
export function nearestDepotId(lat, lon, depots) {
  if (!depots?.length) return "";
  let bestId = String(depots[0].id);
  let bestD = Infinity;
  for (const d of depots) {
    const km = haversineKm(lat, lon, d.lat, d.lon);
    if (km < bestD) {
      bestD = km;
      bestId = String(d.id);
    }
  }
  return bestId;
}

/**
 * True when a pair's pickup and drop prefer different depots (v1: reject).
 */
export function pairCrossesDepots(order, depots, opts) {
  if (!isPickupDropOrder(order) || !depots?.length) return false;
  const p = pickupCoord(order);
  const d = dropCoord(order);
  if (!p || !d) return false;
  const clustered = partitionOrdersToDepots(
    [
      { lat: p.lat, lon: p.lon, zone: order.pickupZone || order.pickup_zone || order.zone },
      { lat: d.lat, lon: d.lon, zone: order.zone },
    ],
    depots,
    opts || {},
    haversineKm,
  );
  let pDepot = "";
  let dDepot = "";
  for (const [depotId, idxs] of clustered) {
    if (idxs.includes(0)) pDepot = String(depotId);
    if (idxs.includes(1)) dDepot = String(depotId);
  }
  return Boolean(pDepot && dDepot && pDepot !== dDepot);
}

/** Running load never exceeds capacity; pair pickup before drop already in sequence. */
export function routeLoadFeasible(taskIndexes, tasks, capVol, capWt) {
  let startVol = 0;
  let startWt = 0;
  for (const i of taskIndexes) {
    const t = tasks[i];
    if (!t) continue;
    if (t.preloaded || (!t.pairKey && t.role !== "pickup")) {
      startVol += Math.max(0, Number(t.volumeM3) || 0);
      startWt += Math.max(0, Number(t.weightKg) || 0);
    }
  }
  if (startVol > capVol + 1e-9 || startWt > capWt + 1e-9) return false;
  let vol = startVol;
  let wt = startWt;
  for (const i of taskIndexes) {
    const t = tasks[i];
    if (!t) continue;
    const dv = Math.max(0, Number(t.volumeM3) || 0);
    const dw = Math.max(0, Number(t.weightKg) || 0);
    if (t.role === "pickup" && !t.pairKey) {
      vol += dv;
      wt += dw;
    } else if (t.pairKey && t.role === "pickup") {
      vol += dv;
      wt += dw;
    } else if (t.pairKey && t.role === "drop") {
      vol -= dv;
      wt -= dw;
    } else {
      continue;
    }
    if (vol > capVol + 1e-9 || wt > capWt + 1e-9) return false;
    if (vol < -1e-6 || wt < -1e-6) return false;
  }
  return true;
}

export function pairMateIndex(tasks, index) {
  const t = tasks[index];
  if (!t?.pairKey) return -1;
  const want = t.role === "pickup" ? "drop" : "pickup";
  return tasks.findIndex((x, i) => i !== index && x.pairKey === t.pairKey && x.role === want);
}

function isPreloadedTask(t) {
  if (!t) return false;
  if (t.preloaded === true) return true;
  if (t.preloaded === false) return false;
  return !t.pairKey && t.role !== "pickup";
}

/** Peak running load along a task sequence (preloaded at start, +P −D). */
export function routePeakLoad(taskIndexes, tasks) {
  let startVol = 0;
  let startWt = 0;
  for (const i of taskIndexes) {
    const t = tasks[i];
    if (!isPreloadedTask(t)) continue;
    startVol += Math.max(0, Number(t.volumeM3) || 0);
    startWt += Math.max(0, Number(t.weightKg) || 0);
  }
  let vol = startVol;
  let wt = startWt;
  let peakVol = startVol;
  let peakWt = startWt;
  for (const i of taskIndexes) {
    const t = tasks[i];
    if (!t) continue;
    const dv = Math.max(0, Number(t.volumeM3) || 0);
    const dw = Math.max(0, Number(t.weightKg) || 0);
    if (t.role === "pickup" && !t.pairKey) {
      vol += dv;
      wt += dw;
    } else if (t.pairKey && t.role === "pickup") {
      vol += dv;
      wt += dw;
    } else if (t.pairKey && t.role === "drop") {
      vol -= dv;
      wt -= dw;
    } else {
      continue;
    }
    if (vol > peakVol) peakVol = vol;
    if (wt > peakWt) peakWt = wt;
  }
  return { vol: peakVol, wt: peakWt, endVol: vol, endWt: wt };
}

/**
 * If any pair drop appears before its pickup, swap them in place.
 * Works on task indexes or stop-like rows (`order_id` + `role`).
 */
export function restorePairPrecedence(items, resolve) {
  const arr = items.slice();
  const pairOf = (item, i) => {
    if (resolve) return resolve(item, i);
    if (item == null) return null;
    if (typeof item === "object") {
      const key = item.pairKey || item.order_id || item.orderId || null;
      const role = item.role === "pickup" ? "pickup" : item.role === "drop" ? "drop" : "";
      return key && role ? { key: String(key), role } : null;
    }
    return null;
  };
  let changed = true;
  let guard = 0;
  while (changed && guard++ < arr.length * 4) {
    changed = false;
    for (let i = 0; i < arr.length; i++) {
      const a = pairOf(arr[i], i);
      if (!a || a.role !== "drop") continue;
      let p = -1;
      for (let j = 0; j < arr.length; j++) {
        const b = pairOf(arr[j], j);
        if (b && b.key === a.key && b.role === "pickup") {
          p = j;
          break;
        }
      }
      if (p > i) {
        const tmp = arr[i];
        arr[i] = arr[p];
        arr[p] = tmp;
        changed = true;
      }
    }
  }
  return arr;
}
