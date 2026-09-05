/** Client-side default entitlements (mirrors server/entitlements.mjs). */

export type Entitlements = {
  modules: Record<string, boolean>;
  features: Record<string, boolean>;
  actions: Record<string, boolean>;
  mobile: Record<string, boolean>;
};

export const MODULE_LABELS: Record<string, string> = {
  full: "Full dashboard",
  compact: "Compact",
  fleet: "Fleet",
  fleetCompact: "Ranking",
  status: "Last Status",
  trips: "Trips",
  live: "Live Ops",
  exceptions: "Exceptions (soon)",
  maintenance: "Maintenance (soon)",
  dispatch: "Dispatch (soon)",
  routePlan: "Route plan (soon)",
};

export const FEATURE_LABELS: Record<string, string> = {
  excel: "Excel export",
  pdf: "PDF export",
  ai: "AI analysis",
  reverseGeocode: "Reverse geocode columns",
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
  return base;
}

/** Map AppView → entitlements.modules key */
export function moduleKeyForView(view: string): string {
  if (view === "fleetCompact") return "fleetCompact";
  return view;
}
