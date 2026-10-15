import { describe, expect, it } from "vitest";
import { emptyDeskPrivileges, mergeDeskPrivileges } from "./deskPrivileges";

describe("mergeDeskPrivileges", () => {
  it("defaults all flags to false", () => {
    expect(emptyDeskPrivileges()).toEqual({
      editDispatchGoods: false,
      deleteDispatchGoods: false,
      editDispatchCustomers: false,
      deleteDispatchCustomers: false,
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
      }),
    ).toEqual({
      editDispatchGoods: true,
      deleteDispatchGoods: false,
      editDispatchCustomers: true,
      deleteDispatchCustomers: false,
    });
  });
});
