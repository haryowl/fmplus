/**
 * Per-field-user desk privileges for Goods & Customers master writes.
 * Missing keys default to false (view-only until Admin grants).
 */

export const DESK_PRIVILEGE_KEYS = [
  "editDispatchGoods",
  "deleteDispatchGoods",
  "editDispatchCustomers",
  "deleteDispatchCustomers",
];

/**
 * @param {unknown} raw
 * @returns {{
 *   editDispatchGoods: boolean,
 *   deleteDispatchGoods: boolean,
 *   editDispatchCustomers: boolean,
 *   deleteDispatchCustomers: boolean,
 * }}
 */
export function mergeDeskPrivileges(raw) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    editDispatchGoods: src.editDispatchGoods === true,
    deleteDispatchGoods: src.deleteDispatchGoods === true,
    editDispatchCustomers: src.editDispatchCustomers === true,
    deleteDispatchCustomers: src.deleteDispatchCustomers === true,
  };
}

/**
 * Normalize a privileges payload from Admin API (only known keys, boolean).
 * @param {unknown} raw
 */
export function normalizeDeskPrivilegesInput(raw) {
  const merged = mergeDeskPrivileges(raw);
  return { ...merged };
}
