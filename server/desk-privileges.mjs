/**
 * Per-field-user desk privileges.
 * Missing keys default to false (denied until Admin grants).
 *
 * Goods/Customers writes always require desk sign-in + privilege.
 * Jobs / orders / plan / live / settings: when a desk session is present,
 * privilege is required; with no desk session, tenant-key embed auth still applies.
 */

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
];

/**
 * @param {unknown} raw
 * @returns {Record<string, boolean>}
 */
export function mergeDeskPrivileges(raw) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  /** @type {Record<string, boolean>} */
  const out = {};
  for (const key of DESK_PRIVILEGE_KEYS) {
    out[key] = src[key] === true;
  }
  return out;
}

/**
 * Normalize a privileges payload from Admin API (only known keys, boolean).
 * @param {unknown} raw
 */
export function normalizeDeskPrivilegesInput(raw) {
  return { ...mergeDeskPrivileges(raw) };
}
