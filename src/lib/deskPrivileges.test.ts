import { describe, expect, it } from "vitest";
import { deskCanWrite, emptyDeskPrivileges, mergeDeskPrivileges } from "./deskPrivileges";

describe("mergeDeskPrivileges", () => {
  it("defaults all flags to false", () => {
    expect(emptyDeskPrivileges()).toEqual({
      editDispatchGoods: false,
      deleteDispatchGoods: false,
      editDispatchCustomers: false,
      deleteDispatchCustomers: false,
      planDispatch: false,
      editDispatchJobs: false,
      editDispatchOrders: false,
      editDispatchLive: false,
      manageDispatchSettings: false,
    });
    expect(mergeDeskPrivileges(null)).toEqual(emptyDeskPrivileges());
    expect(mergeDeskPrivileges({ editDispatchGoods: "yes" })).toEqual(emptyDeskPrivileges());
  });

  it("only accepts strict true booleans", () => {
    expect(
      mergeDeskPrivileges({
        editDispatchGoods: true,
        deleteDispatchGoods: false,
        editDispatchCustomers: true,
        deleteDispatchCustomers: 1,
        planDispatch: true,
        editDispatchJobs: true,
        editDispatchOrders: false,
        editDispatchLive: true,
        manageDispatchSettings: "true",
      }),
    ).toEqual({
      editDispatchGoods: true,
      deleteDispatchGoods: false,
      editDispatchCustomers: true,
      deleteDispatchCustomers: false,
      planDispatch: true,
      editDispatchJobs: true,
      editDispatchOrders: false,
      editDispatchLive: true,
      manageDispatchSettings: false,
    });
  });

  it("deskCanWrite allows unsigned embed, requires privilege when signed in", () => {
    const priv = mergeDeskPrivileges({ editDispatchJobs: true });
    expect(deskCanWrite(null, priv, "editDispatchJobs")).toBe(true);
    expect(deskCanWrite({ id: "u1" }, priv, "editDispatchJobs")).toBe(true);
    expect(deskCanWrite({ id: "u1" }, priv, "planDispatch")).toBe(false);
  });
});
