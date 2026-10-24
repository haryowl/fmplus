/**
 * Default embed entitlements + helpers.
 * Admin can override per tenant in tenants.entitlements JSONB.
 */
import { defaultScanEntitlements, mergeScanEntitlements } from "./scan-capabilities.mjs";

export const MODULE_KEYS = [
  "full",
  "compact",
  "fleet",
  "fleetCompact",
  "status",
  "trips",
  "live",
  "fleetLive",
  "exceptions",
  "places",
  "maintenance",
  "dispatch",
  "routePlan",
];

export const FEATURE_KEYS = [
  "excel",
  "pdf",
  "ai",
  "reverseGeocode",
  "deleteMaintenance",
  /** When true, insufficient depot stock hard-blocks assign/plan stock checks */
  "dispatchStockHardBlock",
  /** When true, cargo scan is required before stock moves (Finish alone is not enough) */
  "dispatchStockRequireScan",
  /** Dispatch profiles — cargo default on; passenger/sales opt-in */
  "dispatchCargo",
  "dispatchPassenger",
  "dispatchSales",
  /** Show goods sell / fare amounts on Field / POD / WhatsApp */
  "dispatchShowMoneyOnField",
  /** Fleet Live section features (module.fleetLive must be on) */
  "fleetLiveFull",
  "fleetLiveFleet",
  "fleetLiveDashboard",
  "fleetLiveRanking",
  "fleetLiveTrips",
  "fleetLiveHistory",
  "fleetLiveMedia",
  "fleetLiveAlerts",
  "fleetLiveRules",
];

export const ACTION_KEYS = [
  "ackException",
  "openMaintenance",
  "closeMaintenance",
  "createDispatch",
  "uploadPom",
];

/** Max Fleet Live Dashboard/Live mapper pin ids per tenant. */
export const FLEET_LIVE_DISPLAY_PINS_MAX = 24;

const FLEET_LIVE_PIN_ID_RE = /^[a-zA-Z0-9_.:/-]{1,64}$/;

/**
 * Normalize Admin-configured mapper pin ids.
 * `null` = use built-in defaults; array (incl. empty) = explicit override.
 * @param {unknown} raw
 * @returns {string[] | null}
 */
export function normalizeFleetLiveDisplayPins(raw) {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return null;
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const id = String(item || "").trim();
    if (!FLEET_LIVE_PIN_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= FLEET_LIVE_DISPLAY_PINS_MAX) break;
  }
  return out;
}

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
      fleetLive: false,
      exceptions: false,
      places: false,
      maintenance: false,
      dispatch: false,
      routePlan: false,
    },
    features: {
      excel: true,
      pdf: true,
      ai: true,
      reverseGeocode: true,
      deleteMaintenance: false,
      dispatchStockHardBlock: false,
      dispatchStockRequireScan: false,
      dispatchCargo: true,
      dispatchPassenger: false,
      dispatchSales: false,
      dispatchShowMoneyOnField: false,
      fleetLiveFull: true,
      fleetLiveFleet: true,
      fleetLiveDashboard: true,
      fleetLiveRanking: true,
      fleetLiveTrips: true,
      fleetLiveHistory: true,
      fleetLiveMedia: true,
      fleetLiveAlerts: true,
      fleetLiveRules: true,
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
      managerMaintenance: false,
      dispatch: false,
    },
    scan: defaultScanEntitlements(),
    /** null = built-in Fleet Live pin defaults; string[] = tenant override */
    fleetLiveDisplayPins: /** @type {string[] | null} */ (null),
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
  base.scan = mergeScanEntitlements(src.scan);
  if ("fleetLiveDisplayPins" in src) {
    base.fleetLiveDisplayPins = normalizeFleetLiveDisplayPins(src.fleetLiveDisplayPins);
  }
  // Back-compat: tenants that only had Armada `live` keep Fleet Live until they set fleetLive.
  const mods = src.modules;
  if (
    mods &&
    typeof mods === "object" &&
    !Array.isArray(mods) &&
    /** @type {Record<string, unknown>} */ (mods).fleetLive === undefined &&
    /** @type {Record<string, unknown>} */ (mods).live === true
  ) {
    base.modules.fleetLive = true;
  }
  return base;
}

export function moduleEnabled(entitlements, moduleKey) {
  const e = mergeEntitlements(entitlements);
  return e.modules[moduleKey] === true;
}
