import { currentTenantKey } from "./tenant";

export type AppView =
  | "full"
  | "compact"
  | "fleet"
  | "fleetCompact"
  | "fleetLive"
  | "status"
  | "trips"
  | "live"
  | "exceptions"
  | "places"
  | "routePlan"
  | "dispatchDesk"
  | "dispatchLive"
  | "dispatchGoods"
  | "dispatchCustomers"
  | "maintenance"
  | "admin"
  | "field"
  | "manager";

export function viewFromPath(pathname: string): AppView {
  const parts = (pathname.replace(/\/+$/, "") || "/").split("/").filter(Boolean);
  const leaf = parts[0] ?? "";
  const next = parts[1] ?? "";
  if (!leaf || leaf === "admin") return "admin";
  if (leaf === "full" || leaf === "full.html" || leaf === "index.html") return "full";
  if (leaf === "mm") return "manager";
  if (leaf === "m" || leaf === "dispatch") return "field";
  if (leaf === "live" || leaf === "live.html") return "live";
  if (
    leaf === "fleet-live" ||
    leaf === "fleet-live.html" ||
    leaf === "fleetlive" ||
    (leaf === "fleet" && (next === "live" || next === "live.html"))
  ) {
    return "fleetLive";
  }
  if (leaf === "exceptions" || leaf === "exceptions.html") return "exceptions";
  if (leaf === "places" || leaf === "places.html") return "places";
  if (leaf === "route" || leaf === "route.html" || leaf === "routes") return "routePlan";
  if (
    leaf === "dispatch-live" ||
    leaf === "dispatch-live.html" ||
    leaf === "dispatchlive" ||
    (leaf === "jobs" && (next === "live" || next === "live.html"))
  ) {
    return "dispatchLive";
  }
  if (
    leaf === "goods" ||
    leaf === "goods.html" ||
    (leaf === "jobs" && (next === "goods" || next === "goods.html"))
  ) {
    return "dispatchGoods";
  }
  if (
    leaf === "customers" ||
    leaf === "customers.html" ||
    (leaf === "jobs" && (next === "customers" || next === "customers.html"))
  ) {
    return "dispatchCustomers";
  }
  if (leaf === "jobs" || leaf === "jobs.html") return "dispatchDesk";
  if (leaf === "maintenance" || leaf === "maintenance.html") return "maintenance";
  if (leaf === "fleet" && (next === "compact" || next === "compact.html")) return "fleetCompact";
  if (leaf === "fleet" || leaf === "fleet.html") return "fleet";
  if (leaf === "compact" || leaf === "compact.html") return "compact";
  if (leaf === "status" || leaf === "status.html") return "status";
  if (leaf === "trips" || leaf === "trips.html") return "trips";
  return "admin";
}

/** True for the single-vehicle compact page only (`/fleet/compact` is not this). */
export function isCompactPath(pathname: string): boolean {
  return viewFromPath(pathname) === "compact";
}

export function withSearch(path: string, search = ""): string {
  return `${path}${search}`;
}

export function compactHref(search: string): string {
  return withSearch("/compact", search);
}

export function fullHref(search: string): string {
  return withSearch("/full", search);
}

export function adminHref(search = ""): string {
  return withSearch("/", search);
}

export function fleetHref(search: string): string {
  return withSearch("/fleet", search);
}

export function fleetCompactHref(search: string): string {
  return withSearch("/fleet/compact", search);
}

export function statusHref(search: string): string {
  return withSearch("/status", search);
}

export function tripsHref(search: string): string {
  return withSearch("/trips", search);
}

export function liveHref(search: string): string {
  return withSearch("/live", search);
}

export function fleetLiveHref(search: string): string {
  return withSearch("/fleet-live", search);
}

/**
 * History deep link for a status-row vehicle.
 * Armada-linked (rowId > 0) → /trips or /full unless telematics is devices-only
 * (then Fleet Live with deviceId). GPS-only synthetic rows always use Fleet Live.
 */
export function vehicleTrackHref(opts: {
  rowId: number;
  deviceId?: string | null;
  /** trips → Trips panel; history/full → Full / Fleet History */
  kind?: "trips" | "full" | "history";
  /** When "devices", prefer Fleet Live even if rowId > 0 (linked Armada id). */
  telematicsSource?: "armada" | "devices" | "both" | null;
  /** Stamp `k=` when the current URL (or configured tenant) does not have it. */
  tenantKey?: string | null;
}): string {
  const params = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : "",
  );
  const tenantKey = String(opts.tenantKey || params.get("k") || currentTenantKey() || "").trim();
  if (tenantKey) params.set("k", tenantKey);
  const deviceId = String(opts.deviceId || "").trim();
  const kind = opts.kind || "full";
  const preferFleetLive =
    Boolean(deviceId) && (opts.rowId <= 0 || opts.telematicsSource === "devices");
  if (preferFleetLive) {
    params.set("deviceId", deviceId);
    params.delete("userId");
    params.delete("userIds");
    params.set("section", kind === "trips" ? "trips" : "history");
    const q = params.toString();
    return fleetLiveHref(q ? `?${q}` : "");
  }
  if (opts.rowId > 0) {
    params.set("userId", String(opts.rowId));
    params.delete("userIds");
    params.delete("deviceId");
    const q = params.toString();
    return kind === "trips" ? tripsHref(q ? `?${q}` : "") : fullHref(q ? `?${q}` : "");
  }
  return fleetLiveHref(params.toString() ? `?${params}` : "");
}

/**
 * When an Armada trip/full view is opened with a GPS device (or synthetic row id),
 * send the browser to Fleet Live instead of an empty Armada embed.
 */
export function armadaTripViewRedirectHref(
  search = typeof window !== "undefined" ? window.location.search : "",
): string | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const deviceId = String(params.get("deviceId") || "").trim();
  const uid = Number(params.get("userId"));
  if (/^[0-9a-f-]{36}$/i.test(deviceId)) {
    return vehicleTrackHref({
      rowId: Number.isInteger(uid) ? uid : 0,
      deviceId,
      kind: "trips",
      telematicsSource: "devices",
    });
  }
  if (Number.isInteger(uid) && uid < 0) {
    return vehicleTrackHref({ rowId: uid, deviceId: null, kind: "trips" });
  }
  return null;
}

/** Devices-only tenants: send Armada trip/full/fleet views to Fleet Live. */
export function devicesOnlyViewHref(
  telematicsSource: "armada" | "devices" | "both" | null | undefined,
  search = typeof window !== "undefined" ? window.location.search : "",
): string | null {
  if (telematicsSource !== "devices") return null;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.set("section", "live");
  const q = params.toString();
  return fleetLiveHref(q ? `?${q}` : "");
}

export function exceptionsHref(search: string): string {
  return withSearch("/exceptions", search);
}

export function placesHref(search: string): string {
  return withSearch("/places", search);
}

export function routePlanHref(search: string): string {
  return withSearch("/route", search);
}

export function jobsHref(search: string): string {
  return withSearch("/jobs", search);
}

export function goodsHref(search: string): string {
  return withSearch("/goods", search);
}

export function customersHref(search: string): string {
  return withSearch("/customers", search);
}

export function dispatchLiveHref(search: string): string {
  return withSearch("/dispatch-live", search);
}

export function maintenanceHref(search: string): string {
  return withSearch("/maintenance", search);
}

export function managerHref(search = ""): string {
  return withSearch("/mm", search);
}

export function fieldHref(search = ""): string {
  return withSearch("/m", search);
}

export const VIEW_CHANGE = "fms-embed:view";

/** Same-document tab switch so GPS day cache survives. */
export function navigateView(href: string) {
  const url = new URL(href, window.location.href);
  const next = `${url.pathname}${url.search}`;
  const current = `${window.location.pathname}${window.location.search}`;
  if (next === current) return;
  window.history.pushState(null, "", next);
  window.dispatchEvent(new Event(VIEW_CHANGE));
}

export function writeLocationSearch(patch: Record<string, string | null | undefined>) {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(patch)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const next = `${window.location.pathname}?${params.toString()}`;
  const current = `${window.location.pathname}${window.location.search}`;
  if (next !== current) window.history.replaceState(null, "", next);
}
