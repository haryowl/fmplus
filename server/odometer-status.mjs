/**
 * Parse odometer km from an Armada /usersstatus row.
 * Matches Last Status: odometerAcc is meters → divide by 1000.
 * @param {unknown} item
 * @returns {{ userId: number, odometerKm: number|null } | null}
 */
export function odometerFromStatusItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const row = /** @type {Record<string, unknown>} */ (item);
  const userId = Number(row.userId ?? row.id);
  if (!Number.isInteger(userId) || userId < 1) return null;

  let vars = row.variables;
  /** @type {Record<string, unknown>} */
  const map = {};
  if (Array.isArray(vars)) {
    for (const v of vars) {
      if (!v || typeof v !== "object") continue;
      const name = String(/** @type {Record<string, unknown>} */ (v).name || "");
      if (name) map[name] = /** @type {Record<string, unknown>} */ (v).value;
    }
  } else if (vars && typeof vars === "object") {
    Object.assign(map, vars);
  }

  const raw = map.odometerAcc ?? map.odometer ?? map.OdometerAcc ?? map.Odometer;
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim().replace(",", "."));
  if (!Number.isFinite(n) || n < 0) {
    return { userId, odometerKm: null };
  }
  return { userId, odometerKm: n / 1000 };
}

/**
 * @param {unknown} raw usersstatus payload
 * @param {number} userId
 * @returns {number|null}
 */
export function findOdometerKmInStatus(raw, userId) {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray(/** @type {any} */ (raw).items)
      ? /** @type {any} */ (raw).items
      : [];
  for (const item of list) {
    const parsed = odometerFromStatusItem(item);
    if (parsed && parsed.userId === userId) return parsed.odometerKm;
  }
  return null;
}

/**
 * @param {{ currentOdoKm: number|null, baselineKm: number|null, intervalKm: number|null }} input
 */
export function evaluateKmInterval(input) {
  const intervalKm = input.intervalKm;
  const baselineKm = input.baselineKm;
  const currentOdoKm = input.currentOdoKm;
  if (intervalKm == null || !(intervalKm > 0)) {
    return {
      kmAccrued: null,
      intervalKm: null,
      baselineKm: baselineKm ?? null,
      currentOdoKm: currentOdoKm ?? null,
      nextDueOdoKm: null,
      due: false,
      reason: "no_interval",
    };
  }
  if (baselineKm == null || !Number.isFinite(baselineKm)) {
    return {
      kmAccrued: null,
      intervalKm,
      baselineKm: null,
      currentOdoKm: currentOdoKm ?? null,
      nextDueOdoKm: null,
      due: false,
      reason: "no_baseline",
    };
  }
  if (currentOdoKm == null || !Number.isFinite(currentOdoKm)) {
    return {
      kmAccrued: null,
      intervalKm,
      baselineKm,
      currentOdoKm: null,
      nextDueOdoKm: baselineKm + intervalKm,
      due: false,
      reason: "no_status_odo",
    };
  }
  const kmAccrued = Math.max(0, currentOdoKm - baselineKm);
  const nextDueOdoKm = baselineKm + intervalKm;
  return {
    kmAccrued: Math.round(kmAccrued * 10) / 10,
    intervalKm,
    baselineKm,
    currentOdoKm: Math.round(currentOdoKm * 10) / 10,
    nextDueOdoKm: Math.round(nextDueOdoKm * 10) / 10,
    due: currentOdoKm >= nextDueOdoKm,
    reason: null,
  };
}
