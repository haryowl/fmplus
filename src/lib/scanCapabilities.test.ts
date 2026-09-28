import { describe, expect, it } from "vitest";
import { defaultEntitlements, mergeEntitlements } from "./entitlements";
import {
  defaultScanEntitlements,
  fieldScanAllowsContext,
  fieldScanCanCargo,
  fieldScanCanPart,
  mergeScanEntitlements,
  resolveFieldScan,
} from "./scanCapabilities";

describe("scan capabilities", () => {
  it("keeps Phase 1 add actions on for every role by default", () => {
    const scan = defaultScanEntitlements();
    expect(scan.inputs.camera).toBe(true);
    expect(scan.inputs.typed).toBe(true);
    expect(scan.inputs.nfc).toBe(false);
    for (const role of ["operator", "driver", "dispatcher", "manager"] as const) {
      expect(scan.roles[role].cargoAdd).toBe(true);
      expect(scan.roles[role].partAdd).toBe(true);
      expect(scan.roles[role].cargoConfirm).toBe(false);
      expect(scan.roles[role].stopRequireScan).toBe(false);
    }
  });

  it("merges a per-role override and ignores unknown keys", () => {
    const merged = mergeScanEntitlements({
      inputs: { nfc: true, nope: true },
      roles: {
        driver: { partAdd: false, extra: true },
        ghost: { cargoAdd: false },
      },
    });
    expect(merged.inputs.nfc).toBe(true);
    expect(merged.inputs.camera).toBe(true);
    expect(merged.roles.driver.partAdd).toBe(false);
    expect(merged.roles.driver.cargoAdd).toBe(true);
    expect(merged.roles.operator.partAdd).toBe(true);
    expect("extra" in merged.roles.driver).toBe(false);
    expect("ghost" in merged.roles).toBe(false);
  });

  it("resolves Field capabilities for the signed-in role", () => {
    const scan = mergeScanEntitlements({
      roles: { driver: { partAdd: false }, operator: { cargoAdd: false } },
    });
    const driver = resolveFieldScan(scan, "driver");
    expect(driver.cargoAdd).toBe(true);
    expect(driver.partAdd).toBe(false);
    expect(fieldScanAllowsContext(driver, "dispatch_cargo")).toBe(true);
    expect(fieldScanAllowsContext(driver, "maint_part")).toBe(false);
    expect(fieldScanCanCargo(driver)).toBe(true);
    expect(fieldScanCanPart(driver)).toBe(false);

    const operator = resolveFieldScan(scan, "operator");
    expect(fieldScanCanCargo(operator)).toBe(false);
    expect(fieldScanCanPart(operator)).toBe(true);
  });

  it("treats a missing /me scan payload as Phase 1 still allowed", () => {
    expect(fieldScanCanCargo(null)).toBe(true);
    expect(fieldScanCanPart(undefined)).toBe(true);
  });

  it("hangs scan on tenant entitlements merge", () => {
    const merged = mergeEntitlements({
      scan: { roles: { driver: { cargoAdd: false } } },
    });
    expect(merged.scan.roles.driver.cargoAdd).toBe(false);
    expect(merged.scan.roles.operator.cargoAdd).toBe(true);
    expect(defaultEntitlements().scan.roles.driver.cargoAdd).toBe(true);
  });
});
