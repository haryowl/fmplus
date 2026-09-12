import { describe, expect, it } from "vitest";
import { defaultEntitlements, mergeEntitlements, moduleKeyForView } from "./entitlements";

describe("entitlements", () => {
  it("merges overrides onto defaults", () => {
    const merged = mergeEntitlements({
      modules: { trips: false, maintenance: true },
      features: { ai: false },
    });
    expect(merged.modules.full).toBe(true);
    expect(merged.modules.trips).toBe(false);
    expect(merged.modules.maintenance).toBe(true);
    expect(merged.features.ai).toBe(false);
    expect(merged.features.excel).toBe(true);
    expect(merged.features.deleteMaintenance).toBe(false);
    expect(merged.mobile.managerMaintenance).toBe(false);
  });

  it("can enable managerMaintenance mobile flag", () => {
    expect(
      mergeEntitlements({ mobile: { managerMaintenance: true } }).mobile.managerMaintenance,
    ).toBe(true);
  });

  it("can enable deleteMaintenance", () => {
    expect(mergeEntitlements({ features: { deleteMaintenance: true } }).features.deleteMaintenance).toBe(
      true,
    );
  });

  it("ignores unknown junk", () => {
    expect(mergeEntitlements(null)).toEqual(defaultEntitlements());
    expect(mergeEntitlements({ modules: { nope: true } }).modules.full).toBe(true);
  });

  it("maps views to module keys", () => {
    expect(moduleKeyForView("fleetCompact")).toBe("fleetCompact");
    expect(moduleKeyForView("trips")).toBe("trips");
    expect(moduleKeyForView("dispatchDesk")).toBe("dispatch");
    expect(moduleKeyForView("dispatchLive")).toBe("dispatch");
  });
});
