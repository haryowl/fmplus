/** Client-side default entitlements (mirrors server/entitlements.mjs). */

import {
  defaultScanEntitlements,
  mergeScanEntitlements,
  type ScanEntitlements,
} from "./scanCapabilities";

export type Entitlements = {
  modules: Record<string, boolean>;
  features: Record<string, boolean>;
  actions: Record<string, boolean>;
  mobile: Record<string, boolean>;
  scan: ScanEntitlements;
};

export const MODULE_LABELS: Record<string, string> = {
  full: "Full dashboard",
  compact: "Compact",
  fleet: "Fleet",
  fleetCompact: "Ranking",
  status: "Last Status",
  trips: "Trips",
  live: "Live Ops (Armada)",
  fleetLive: "Fleet Live (devices)",
  exceptions: "Exceptions",
  places: "Places",
  routePlan: "Route plan",
  maintenance: "Maintenance",
  dispatch: "Dispatch",
};

export const FEATURE_LABELS: Record<string, string> = {
  excel: "Excel export",
  pdf: "PDF export",
  ai: "AI analysis",
  reverseGeocode: "Reverse geocode columns",
  deleteMaintenance: "Delete maintenance jobs (manager)",
  dispatchStockHardBlock: "Dispatch: hard-block when depot stock is short",
  dispatchStockRequireScan: "Dispatch: require cargo scan to move stock",
  dispatchCargo: "Dispatch: cargo / goods profile",
  dispatchPassenger: "Dispatch: passenger profile",
  dispatchSales: "Dispatch: sales visit profile",
  dispatchShowMoneyOnField: "Dispatch: show money on Field / POD / WhatsApp",
  fleetLiveDashboard: "Fleet Live: Dashboard section",
  fleetLiveRanking: "Fleet Live: Ranking section",
  fleetLiveTrips: "Fleet Live: Trips section",
  fleetLiveHistory: "Fleet Live: History section",
  fleetLiveMedia: "Fleet Live: Media (video/picture)",
  fleetLiveAlerts: "Fleet Live: Alerts events",
  fleetLiveRules: "Fleet Live: Alert rules editor",
};

export function defaultEntitlements(): Entitlements {
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
  };
}

export function mergeEntitlements(raw: unknown): Entitlements {
  const base = defaultEntitlements();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const src = raw as Record<string, unknown>;
  for (const section of ["modules", "features", "actions", "mobile"] as const) {
    const incoming = src[section];
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) continue;
    const target = base[section];
    for (const [key, value] of Object.entries(incoming as Record<string, unknown>)) {
      if (key in target && typeof value === "boolean") target[key] = value;
    }
  }
  base.scan = mergeScanEntitlements(src.scan);
  // Back-compat: tenants that only had Armada `live` keep Fleet Live until they set fleetLive.
  const mods = src.modules;
  if (
    mods &&
    typeof mods === "object" &&
    !Array.isArray(mods) &&
    (mods as Record<string, unknown>).fleetLive === undefined &&
    (mods as Record<string, unknown>).live === true
  ) {
    base.modules.fleetLive = true;
  }
  return base;
}

/** Map AppView → entitlements.modules key */
export function moduleKeyForView(view: string): string {
  if (view === "fleetCompact") return "fleetCompact";
  if (view === "fleetLive") return "fleetLive";
  if (
    view === "dispatchDesk" ||
    view === "dispatchLive" ||
    view === "dispatchGoods" ||
    view === "dispatchCustomers"
  ) {
    return "dispatch";
  }
  return view;
}

export type DispatchProfiles = {
  cargo: boolean;
  passenger: boolean;
  sales: boolean;
};

/** Cargo default on; passenger/sales opt-in. */
export function dispatchProfiles(ent: Entitlements): DispatchProfiles {
  return {
    cargo: ent.features.dispatchCargo !== false,
    passenger: ent.features.dispatchPassenger === true,
    sales: ent.features.dispatchSales === true,
  };
}

export type DispatchDeskMode = "cargo" | "passenger" | "sales";

export function resolveDispatchDeskMode(
  profiles: DispatchProfiles,
  requested?: string | null,
): DispatchDeskMode {
  const req = String(requested || "").toLowerCase();
  if (req === "sales" && profiles.sales) return "sales";
  if (req === "passenger" && profiles.passenger) return "passenger";
  if (req === "cargo" && profiles.cargo) return "cargo";
  if (profiles.sales && !profiles.cargo && !profiles.passenger) return "sales";
  if (profiles.passenger && !profiles.cargo) return "passenger";
  if (profiles.cargo) return "cargo";
  if (profiles.passenger) return "passenger";
  if (profiles.sales) return "sales";
  return "cargo";
}

export function enabledDeskModes(profiles: DispatchProfiles): DispatchDeskMode[] {
  const modes: DispatchDeskMode[] = [];
  if (profiles.cargo) modes.push("cargo");
  if (profiles.passenger) modes.push("passenger");
  if (profiles.sales) modes.push("sales");
  return modes;
}
