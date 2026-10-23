import { describe, expect, it } from "vitest";
import {
  deskHomePath,
  deskNavAllowed,
  hasAnyDeskPrivilege,
  isDeskUserRole,
  postLoginHref,
} from "./deskHome";
import { emptyDeskPrivileges, mergeDeskPrivileges } from "./deskPrivileges";

describe("desk user role", () => {
  it("recognizes the desk User role", () => {
    expect(isDeskUserRole("user")).toBe(true);
    expect(isDeskUserRole("User")).toBe(true);
    expect(isDeskUserRole("driver")).toBe(false);
  });

  it("sends User to Fleet Live when they have a fleet privilege", () => {
    const priv = mergeDeskPrivileges({ viewFleetLive: true });
    expect(deskHomePath(priv)).toBe("/fleet-live");
    expect(postLoginHref("user", priv, "tenant01")).toBe("/fleet-live?k=tenant01");
  });

  it("sends User to Jobs when they only have dispatch privileges", () => {
    const priv = mergeDeskPrivileges({ editDispatchJobs: true });
    expect(deskHomePath(priv)).toBe("/jobs");
    expect(postLoginHref("user", priv, "tenant01")).toBe("/jobs?k=tenant01");
  });

  it("keeps Field and Manager on their own apps", () => {
    const priv = mergeDeskPrivileges({ viewFleetLive: true });
    expect(postLoginHref("driver", priv, "tenant01")).toBe("/m?k=tenant01");
    expect(postLoginHref("manager", priv, "tenant01")).toBe("/mm?k=tenant01");
  });

  it("hides privileged nav items when the signed-in user lacks them", () => {
    const priv = mergeDeskPrivileges({ viewFleetLive: true });
    expect(deskNavAllowed({ id: "u1" }, priv, "fleetLive")).toBe(true);
    expect(deskNavAllowed({ id: "u1" }, priv, "dispatchDesk")).toBe(false);
    expect(deskNavAllowed({ id: "u1" }, priv, "full")).toBe(true);
    expect(deskNavAllowed(null, emptyDeskPrivileges(), "dispatchDesk")).toBe(true);
  });

  it("treats empty privilege maps as no desk access flags", () => {
    expect(hasAnyDeskPrivilege(emptyDeskPrivileges())).toBe(false);
    expect(hasAnyDeskPrivilege(mergeDeskPrivileges({ planDispatch: true }))).toBe(true);
  });
});
