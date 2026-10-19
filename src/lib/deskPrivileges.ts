export type DeskPrivileges = {
  editDispatchGoods: boolean;
  deleteDispatchGoods: boolean;
  editDispatchCustomers: boolean;
  deleteDispatchCustomers: boolean;
  /** Auto-plan day Apply (and Preview when signed in). */
  planDispatch: boolean;
  /** Create/edit jobs, assign stops, optimize, next trip. */
  editDispatchJobs: boolean;
  /** Create/edit/delete orders and templates. */
  editDispatchOrders: boolean;
  /** Live ops writes: exception ack, replan-remaining apply. */
  editDispatchLive: boolean;
  /** Depots, capacities, zone map, cost/fare rates. */
  manageDispatchSettings: boolean;
  viewFleetLive: boolean;
  viewFleetDashboard: boolean;
  viewFleetRanking: boolean;
  viewFleetTrips: boolean;
  viewFleetHistory: boolean;
  viewFleetMedia: boolean;
  ackFleetAlerts: boolean;
  manageFleetRules: boolean;
  manageFleetDevices: boolean;
};

export const DESK_PRIVILEGE_KEYS = [
  "editDispatchGoods",
  "deleteDispatchGoods",
  "editDispatchCustomers",
  "deleteDispatchCustomers",
  "planDispatch",
  "editDispatchJobs",
  "editDispatchOrders",
  "editDispatchLive",
  "manageDispatchSettings",
  "viewFleetLive",
  "viewFleetDashboard",
  "viewFleetRanking",
  "viewFleetTrips",
  "viewFleetHistory",
  "viewFleetMedia",
  "ackFleetAlerts",
  "manageFleetRules",
  "manageFleetDevices",
] as const;

export type DeskPrivilegeKey = (typeof DESK_PRIVILEGE_KEYS)[number];

export const DESK_PRIVILEGE_LABELS: Record<DeskPrivilegeKey, string> = {
  editDispatchGoods: "Edit Goods & Stock",
  deleteDispatchGoods: "Delete Goods & Stock",
  editDispatchCustomers: "Edit Customers",
  deleteDispatchCustomers: "Delete Customers",
  planDispatch: "Auto-plan day",
  editDispatchJobs: "Edit Jobs",
  editDispatchOrders: "Edit Orders",
  editDispatchLive: "Edit Live / replan",
  manageDispatchSettings: "Manage dispatch settings",
  viewFleetLive: "Fleet Live · map",
  viewFleetDashboard: "Fleet Live · dashboard",
  viewFleetRanking: "Fleet Live · ranking",
  viewFleetTrips: "Fleet Live · trips",
  viewFleetHistory: "Fleet Live · history",
  viewFleetMedia: "Fleet Live · media",
  ackFleetAlerts: "Fleet Live · ack alerts",
  manageFleetRules: "Fleet Live · manage rules",
  manageFleetDevices: "Fleet Live · manage devices",
};

export function mergeDeskPrivileges(raw: unknown): DeskPrivileges {
  const src =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    editDispatchGoods: src.editDispatchGoods === true,
    deleteDispatchGoods: src.deleteDispatchGoods === true,
    editDispatchCustomers: src.editDispatchCustomers === true,
    deleteDispatchCustomers: src.deleteDispatchCustomers === true,
    planDispatch: src.planDispatch === true,
    editDispatchJobs: src.editDispatchJobs === true,
    editDispatchOrders: src.editDispatchOrders === true,
    editDispatchLive: src.editDispatchLive === true,
    manageDispatchSettings: src.manageDispatchSettings === true,
    viewFleetLive: src.viewFleetLive === true,
    viewFleetDashboard: src.viewFleetDashboard === true,
    viewFleetRanking: src.viewFleetRanking === true,
    viewFleetTrips: src.viewFleetTrips === true,
    viewFleetHistory: src.viewFleetHistory === true,
    viewFleetMedia: src.viewFleetMedia === true,
    ackFleetAlerts: src.ackFleetAlerts === true,
    manageFleetRules: src.manageFleetRules === true,
    manageFleetDevices: src.manageFleetDevices === true,
  };
}

export function emptyDeskPrivileges(): DeskPrivileges {
  return mergeDeskPrivileges({});
}

/**
 * Soft desk RBAC for Jobs/plan/orders/live/settings:
 * no desk session → allow (tenant embed);
 * signed in → require the named privilege.
 */
export function deskCanWrite(
  user: { id?: string } | null | undefined,
  privileges: DeskPrivileges,
  key: DeskPrivilegeKey,
): boolean {
  if (!user?.id) return true;
  return privileges[key] === true;
}
