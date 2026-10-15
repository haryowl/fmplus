export type DeskPrivileges = {
  editDispatchGoods: boolean;
  deleteDispatchGoods: boolean;
  editDispatchCustomers: boolean;
  deleteDispatchCustomers: boolean;
};

export const DESK_PRIVILEGE_KEYS = [
  "editDispatchGoods",
  "deleteDispatchGoods",
  "editDispatchCustomers",
  "deleteDispatchCustomers",
] as const;

export type DeskPrivilegeKey = (typeof DESK_PRIVILEGE_KEYS)[number];

export const DESK_PRIVILEGE_LABELS: Record<DeskPrivilegeKey, string> = {
  editDispatchGoods: "Edit Goods & Stock",
  deleteDispatchGoods: "Delete Goods & Stock",
  editDispatchCustomers: "Edit Customers",
  deleteDispatchCustomers: "Delete Customers",
};

export function mergeDeskPrivileges(raw: unknown): DeskPrivileges {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    editDispatchGoods: src.editDispatchGoods === true,
    deleteDispatchGoods: src.deleteDispatchGoods === true,
    editDispatchCustomers: src.editDispatchCustomers === true,
    deleteDispatchCustomers: src.deleteDispatchCustomers === true,
  };
}

export function emptyDeskPrivileges(): DeskPrivileges {
  return mergeDeskPrivileges({});
}
