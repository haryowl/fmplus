/**
 * Optional zone helpers for dispatch planning.
 * Blank / unmapped zone always falls through to lat-lon behaviour.
 */

/** Fold free-text zone labels for matching (Dago / dago / " Dago "). */
export function normalizeZoneKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

/**
 * Partition orders to depots. When preferZoneDepot and a zone→depot map hit,
 * that depot wins; otherwise nearest depot (haversine) — same as before.
 *
 * @param {{ lat: number, lon: number, zone?: string }[]} orders
 * @param {{ id: string, lat: number, lon: number }[]} depots
 * @param {{ preferZoneDepot?: boolean, zoneDepotMap?: Record<string, string> }} [opts]
 * @param {(a: number, b: number, c: number, d: number) => number} haversineKm
 */
export function partitionOrdersToDepots(orders, depots, opts, haversineKm) {
  /** @type {Map<string, number[]>} */
  const clusters = new Map();
  for (const d of depots) clusters.set(String(d.id), []);
  if (!depots.length) return clusters;

  const prefer = Boolean(opts?.preferZoneDepot);
  const map =
    opts?.zoneDepotMap && typeof opts.zoneDepotMap === "object" ? opts.zoneDepotMap : {};
  const depotIds = new Set(depots.map((d) => String(d.id)));

  for (let i = 0; i < orders.length; i++) {
    const o = orders[i];
    let bestId = null;
    if (prefer) {
      const key = normalizeZoneKey(o.zone);
      const mapped = key ? map[key] : null;
      if (mapped && depotIds.has(String(mapped))) bestId = String(mapped);
    }
    if (!bestId) {
      bestId = String(depots[0].id);
      let bestKm = Infinity;
      for (const d of depots) {
        const km = haversineKm(o.lat, o.lon, d.lat, d.lon);
        if (km < bestKm) {
          bestKm = km;
          bestId = String(d.id);
        }
      }
    }
    clusters.get(bestId).push(i);
  }
  return clusters;
}

/**
 * Soft penalty (km-equivalent) for mixing zones on one route.
 * Large enough to prefer same-zone packing, small enough to yield to capacity.
 */
export const ZONE_MIX_PENALTY_KM = 25;

/**
 * Dominant normalized zone on a route's assigned order indexes, or "".
 */
export function routeDominantZone(orderIndexes, orders) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const oi of orderIndexes || []) {
    const key = normalizeZoneKey(orders[oi]?.zone);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = "";
  let bestN = 0;
  for (const [k, n] of counts) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

/**
 * Extra insertion score when preferSameZone is on.
 */
export function zoneMixPenalty(preferSameZone, routeOrderIndexes, orders, candidateOi) {
  if (!preferSameZone) return 0;
  const cand = normalizeZoneKey(orders[candidateOi]?.zone);
  if (!cand) return 0;
  const dominant = routeDominantZone(routeOrderIndexes, orders);
  if (!dominant) return 0;
  return dominant === cand ? 0 : ZONE_MIX_PENALTY_KM;
}
