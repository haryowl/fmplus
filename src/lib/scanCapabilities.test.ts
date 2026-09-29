import { describe, expect, it } from "vitest";
import { defaultEntitlements, mergeEntitlements } from "./entitlements";
import {
  defaultScanEntitlements,
  fieldScanAllowsContext,
  fieldScanCanCargo,
  fieldScanCanLocation,
  fieldScanCanPart,
  fieldScanCanVehicle,
  fieldScanHasInput,
  mergeScanEntitlements,
  resolveFieldScan,
} from "./scanCapabilities";

describe("scan capabilities", () => {
  it("keeps Phase 1 add actions on for every role by default", () => {
    const scan = defaultScanEntitlements();
    expect(scan.inputs.camera).toBe(true);
    expect(scan.inputs.typed).toBe(true);
    expect(scan.inputs.nfc).toBe(false);
    for (const role of [
      "operator",
      "driver",
      "dispatcher",
      "manager",
      "worker1",
      "worker2",
      "field1",
      "field2",
    ] as const) {
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
    expect(merged.roles.worker1.cargoAdd).toBe(true);
    expect(merged.roles.field2.partAdd).toBe(true);
    expect("extra" in merged.roles.driver).toBe(false);
    expect("ghost" in merged.roles).toBe(false);
  });

  it("resolves Field capabilities for the signed-in role", () => {
    const scan = mergeScanEntitlements({
      roles: {
        driver: { partAdd: false },
        operator: { cargoAdd: false },
        worker1: { cargoConfirm: true },
        field1: { vehicleOpen: true },
      },
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

    const worker1 = resolveFieldScan(scan, "worker1");
    expect(worker1.cargoConfirm).toBe(true);
    expect(worker1.cargoAdd).toBe(true);

    const field1 = resolveFieldScan(scan, "field1");
    expect(field1.vehicleOpen).toBe(true);
  });

  it("treats a missing /me scan payload as Phase 1 still allowed", () => {
    expect(fieldScanCanCargo(null)).toBe(true);
    expect(fieldScanCanPart(undefined)).toBe(true);
  });

  it("counts NFC as a Field input when camera and type are off", () => {
    const caps = resolveFieldScan(
      mergeScanEntitlements({
        inputs: { camera: false, typed: false, nfc: true },
      }),
      "driver",
    );
    expect(fieldScanHasInput(caps)).toBe(true);
    expect(fieldScanCanCargo(caps)).toBe(true);
  });

  it("lets confirm-only cargo scan and gates vehicle / location", () => {
    const confirmOnly = resolveFieldScan(
      mergeScanEntitlements({
        roles: { driver: { cargoAdd: false, cargoConfirm: true, vehicleOpen: true, locationSet: true } },
      }),
      "driver",
    );
    expect(fieldScanCanCargo(confirmOnly)).toBe(true);
    expect(fieldScanAllowsContext(confirmOnly, "dispatch_cargo")).toBe(true);
    expect(fieldScanCanVehicle(confirmOnly)).toBe(true);
    expect(fieldScanCanLocation(confirmOnly)).toBe(true);
    expect(fieldScanAllowsContext(confirmOnly, "vehicle")).toBe(true);
    expect(fieldScanCanVehicle(null)).toBe(false);
    expect(fieldScanCanLocation(undefined)).toBe(false);
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
