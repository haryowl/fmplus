/**
 * Default embed entitlements + helpers.
 * Admin can override per tenant in tenants.entitlements JSONB.
 */

export const MODULE_KEYS = [
  "full",
  "compact",
  "fleet",
  "fleetCompact",
  "status",
  "trips",
  "live",
  "exceptions",
  "maintenance",
  "dispatch",
  "routePlan",
];

export const FEATURE_KEYS = ["excel", "pdf", "ai", "reverseGeocode"];

export const ACTION_KEYS = [
  "ackException",
  "openMaintenance",
  "closeMaintenance",
  "createDispatch",
  "uploadPom",
];

export function defaultEntitlements() {
  return {
    modules: {
      full: true,
      compact: true,
      fleet: true,
      fleetCompact: true,
      status: true,
      trips: true,
      live: false,
      exceptions: false,
      maintenance: false,
      dispatch: false,
      routePlan: false,
    },
    features: {
      excel: true,
      pdf: true,
      ai: true,
      reverseGeocode: true,
    },
    actions: {
      ackException: false,
      openMaintenance: false,
      closeMaintenance: false,
      createDispatch: false,
      uploadPom: false,
    },
    mobile: {
      maintenance: false,
      dispatch: false,
    },
  };
}

/** Deep-merge stored entitlements over defaults (booleans only for known keys). */
export function mergeEntitlements(raw) {
  const base = defaultEntitlements();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const src = /** @type {Record<string, unknown>} */ (raw);

  for (const section of ["modules", "features", "actions", "mobile"]) {
    const incoming = src[section];
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) continue;
    const target = /** @type {Record<string, boolean>} */ (base[section]);
    for (const [key, value] of Object.entries(incoming)) {
      if (key in target && typeof value === "boolean") target[key] = value;
    }
  }
  return base;
}

export function moduleEnabled(entitlements, moduleKey) {
  const e = mergeEntitlements(entitlements);
  return e.modules[moduleKey] === true;
}
