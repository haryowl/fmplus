import {
  emptyDeskPrivileges,
  type DeskPrivilegeKey,
  type DeskPrivileges,
} from "./deskPrivileges";
import { DEFAULT_APP_ID } from "./config";
import { configureTenant } from "./tenant";

export const DESK_USER_ROLE = "user";

const FLEET_VIEW_PRIVS: DeskPrivilegeKey[] = [
  "viewFleetLive",
  "viewFleetDashboard",
  "viewFleetRanking",
  "viewFleetTrips",
  "viewFleetHistory",
  "viewFleetMedia",
  "ackFleetAlerts",
  "manageFleetRules",
  "manageFleetDevices",
];

const JOBS_VIEW_PRIVS: DeskPrivilegeKey[] = [
  "planDispatch",
  "editDispatchJobs",
  "editDispatchOrders",
  "manageDispatchSettings",
];

/** Views that have desk-privilege checkboxes. Others stay entitlement-only. */
const VIEW_PRIVILEGES: Record<string, DeskPrivilegeKey[]> = {
  fleetLive: FLEET_VIEW_PRIVS,
  fleetCompact: ["viewFleetRanking"],
  dispatchDesk: JOBS_VIEW_PRIVS,
  dispatchGoods: ["editDispatchGoods", "deleteDispatchGoods"],
  dispatchCustomers: ["editDispatchCustomers", "deleteDispatchCustomers"],
  dispatchLive: ["editDispatchLive"],
};

export function isDeskUserRole(role: string | null | undefined): boolean {
  return String(role || "").toLowerCase() === DESK_USER_ROLE;
}

export function hasAnyDeskPrivilege(privileges: DeskPrivileges | null | undefined): boolean {
  const p = privileges || emptyDeskPrivileges();
  return (Object.keys(p) as DeskPrivilegeKey[]).some((key) => p[key] === true);
}

export function deskNavAllowed(
  user: { id?: string } | null | undefined,
  privileges: DeskPrivileges,
  view: string,
): boolean {
  if (!user?.id) return true;
  const keys = VIEW_PRIVILEGES[view];
  if (!keys) return true;
  return keys.some((key) => privileges[key] === true);
}

export function deskHomePath(privileges: DeskPrivileges | null | undefined): string {
  const p = privileges || emptyDeskPrivileges();
  if (FLEET_VIEW_PRIVS.some((key) => p[key])) return "/fleet-live";
  if (JOBS_VIEW_PRIVS.some((key) => p[key])) return "/jobs";
  if (p.editDispatchLive) return "/dispatch-live";
  if (p.editDispatchGoods || p.deleteDispatchGoods) return "/goods";
  if (p.editDispatchCustomers || p.deleteDispatchCustomers) return "/customers";
  return "/fleet-live";
}

export function postLoginHref(
  role: string,
  privileges: DeskPrivileges | null | undefined,
  tenantKey: string,
): string {
  const q = tenantKey ? `?k=${encodeURIComponent(tenantKey)}` : "";
  const r = String(role || "").toLowerCase();
  if (r === "manager") return `/mm${q}`;
  if (isDeskUserRole(r)) return `${deskHomePath(privileges)}${q}`;
  return `/m${q}`;
}

export function applyFieldSessionTenant(tenantKey: string, appId?: number | null): void {
  const key = String(tenantKey || "").trim();
  if (!key) return;
  const id = Number(appId);
  configureTenant(key, Number.isInteger(id) && id > 0 ? id : DEFAULT_APP_ID);
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (params.get("k") === key) return;
  params.set("k", key);
  const next = `${window.location.pathname}?${params.toString()}`;
  const current = `${window.location.pathname}${window.location.search}`;
  if (next !== current) window.history.replaceState(null, "", next);
}
