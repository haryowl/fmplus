import { describe, expect, it } from "vitest";
import {
  applyGoodsScan,
  applyGoodsScanResult,
  applyMaintPartScan,
  catalogScanNeedsUnitId,
  isCatalogIdentityScan,
  formatOnHand,
  jobRequireScanReason,
  locationScanNotice,
  resolveVehicleJobOpen,
  stopRequireScanBlocks,
  vehicleScanBlocks,
} from "./catalogScan";
import { formatScanPayload, normalizeCatalogCode, parseScanPayload } from "../../server/catalog-codes.mjs";

describe("scan payload", () => {
  it("parses a versioned ARMADA code", () => {
    expect(parseScanPayload("am1:v1:goods:OIL-5W30")).toEqual({
      version: 1,
      targetKind: "goods",
      code: "oil-5w30",
      raw: "am1:v1:goods:OIL-5W30",
    });
    expect(parseScanPayload("am1:v1:part:BRAKE-PAD").targetKind).toBe("maint_part");
  });

  it("treats a bare SKU or EAN as a code", () => {
    expect(parseScanPayload("8991234567890").code).toBe("8991234567890");
    expect(parseScanPayload("  BOX-1  ").code).toBe("box-1");
  });

  it("normalizes NFC-style UIDs", () => {
    expect(normalizeCatalogCode("04:A2:B1:C3:D5:E7:F9")).toBe("04a2b1c3d5e7f9");
  });

  it("prints a payload we can write to QR or NFC later", () => {
    expect(formatScanPayload("goods", "OIL-5W30")).toBe("am1:v1:goods:OIL-5W30");
    expect(formatScanPayload("maint_part", "PAD")).toBe("am1:v1:part:PAD");
    expect(formatScanPayload("vehicle", "42")).toBe("am1:v1:vehicle:42");
    expect(formatScanPayload("location", "depot-1")).toBe("am1:v1:location:depot-1");
    expect(parseScanPayload("am1:v1:vehicle:42").targetKind).toBe("vehicle");
    expect(parseScanPayload("am1:v1:location:depot-1").targetKind).toBe("location");
  });

  it("keeps bare Armada vehicle ids as the code (Code 128 print)", () => {
    expect(parseScanPayload("1855")).toEqual({
      version: null,
      targetKind: null,
      code: "1855",
      raw: "1855",
    });
    expect(parseScanPayload("am1:v1:vehicle:1855")).toEqual({
      version: 1,
      targetKind: "vehicle",
      code: "1855",
      raw: "am1:v1:vehicle:1855",
    });
  });
});

describe("apply scan to lines", () => {
  const good = {
    id: "g1",
    name: "Oil",
    sku: "OIL",
    unit: "L" as const,
    volumeM3Each: 0.01,
    weightKgEach: 1,
    enabled: true,
    sortOrder: 0,
  };

  it("adds a goods line, then increments qty", () => {
    const once = applyGoodsScan([], good, "oil");
    expect(once).toHaveLength(1);
    expect(once[0]?.qty).toBe(1);
    const twice = applyGoodsScan(once, good, "oil");
    expect(twice).toHaveLength(1);
    expect(twice[0]?.qty).toBe(2);
    expect(twice[0]?.scannedCode).toBe("oil");
  });

  it("adds a maintenance part and replaces a blank first line", () => {
    const item = {
      id: "p1",
      groupId: "g",
      groupKey: "part",
      name: "Brake pad",
      unitPrice: 10,
      unitCost: 4,
      enabled: true,
      sortOrder: 0,
    };
    const next = applyMaintPartScan(
      [{ kind: "part", description: "", qty: 1, unitPrice: null, unitCost: null, vendor: "" }],
      item,
      "pad",
    );
    expect(next).toHaveLength(1);
    expect(next[0]?.description).toBe("Brake pad");
    expect(next[0]?.qty).toBe(1);
    const twice = applyMaintPartScan(next, item, "pad");
    expect(twice).toHaveLength(1);
    expect(twice[0]?.qty).toBe(2);
  });

  it("treats SKU, EAN, and versioned QR as identity, not a unit serial", () => {
    expect(isCatalogIdentityScan({ sku: "OIL", kind: "goods", scannedCode: "oil" })).toBe(true);
    expect(isCatalogIdentityScan({ sku: "OIL", kind: "goods", scannedCode: "am1:v1:goods:OIL" })).toBe(true);
    expect(isCatalogIdentityScan({ sku: "OIL", kind: "goods", scannedCode: "oil", codeFormat: "ean" })).toBe(true);
    expect(isCatalogIdentityScan({ sku: "OIL", kind: "goods", scannedCode: "04a2b1c3d5", codeFormat: "nfc" })).toBe(
      false,
    );
    expect(
      catalogScanNeedsUnitId({
        sku: "OIL",
        kind: "goods",
        scannedCode: "oil",
        serialMode: true,
      }),
    ).toBe(true);
  });

  it("adds one goods line per serial and rejects an unknown drop serial", () => {
    const first = applyGoodsScan([], good, "oil", { serialMode: true, serial: "SN-1" });
    expect(first).toHaveLength(1);
    expect(first[0]?.serial).toBe("SN-1");
    expect(first[0]?.qty).toBe(1);
    const second = applyGoodsScan(first, good, "oil", { serialMode: true, serial: "SN-2" });
    expect(second).toHaveLength(2);
    const again = applyGoodsScan(second, good, "oil", { serialMode: true, serial: "SN-1" });
    expect(again).toHaveLength(2);
    const drop = applyGoodsScanResult(second, good, "oil", {
      serialMode: true,
      serial: "SN-99",
      onlyKnownSerial: true,
    });
    expect(drop.error).toBe("This serial is not on the order");
    expect(drop.lines).toHaveLength(2);
  });

  it("confirms an expected goods line and rejects extras", () => {
    const expected = [
      {
        catalogItemId: "g1",
        name: "Oil",
        qty: 2,
        unit: "L" as const,
        volumeM3Each: 0.01,
        weightKgEach: 1,
      },
    ];
    const hit = applyGoodsScanResult(expected, good, "oil", { confirmMode: true });
    expect(hit.error).toBeUndefined();
    expect(hit.lines).toHaveLength(1);
    expect(hit.lines[0]?.qty).toBe(2);
    expect(hit.lines[0]?.scannedAt).toBeTruthy();
    const extra = applyGoodsScanResult(
      expected,
      { ...good, id: "g2", name: "Filter", sku: "FIL" },
      "fil",
      { confirmMode: true },
    );
    expect(extra.error).toBe("Not expected on this stop");
    expect(extra.lines).toHaveLength(1);
    expect(stopRequireScanBlocks(expected)).toBe(true);
    expect(stopRequireScanBlocks(hit.lines)).toBe(false);
  });

  it("confirms a serial already on the stop", () => {
    const lines = applyGoodsScan([], good, "oil", { serialMode: true, serial: "SN-1" });
    const unmarked = lines.map((l) => ({ ...l, scannedAt: null }));
    const miss = applyGoodsScanResult(unmarked, good, "oil", {
      confirmMode: true,
      serialMode: true,
      serial: "SN-99",
    });
    expect(miss.error).toBe("Not expected on this stop");
    const hit = applyGoodsScanResult(unmarked, good, "oil", {
      confirmMode: true,
      serialMode: true,
      serial: "SN-1",
    });
    expect(hit.error).toBeUndefined();
    expect(hit.lines[0]?.scannedAt).toBeTruthy();
  });
});

describe("vehicle and location scan helpers", () => {
  it("opens the matching open job or rejects the wrong plate", () => {
    const jobs = [
      { id: "a", armadaUserId: 11, status: "en_route" },
      { id: "b", armadaUserId: 22, status: "assigned" },
      { id: "c", armadaUserId: 11, status: "done" },
    ];
    expect(resolveVehicleJobOpen(jobs, 11, "a")).toEqual({ jobId: "a", notice: "Vehicle confirmed" });
    expect(resolveVehicleJobOpen(jobs, 22, "a")).toEqual({
      jobId: "b",
      notice: "Opened job for this vehicle",
    });
    expect(resolveVehicleJobOpen(jobs, 99, "a")).toEqual({ error: "Wrong vehicle" });
    expect(resolveVehicleJobOpen(jobs, 99, null)).toEqual({ error: "No open job for this vehicle" });
  });

  it("blocks Start / orders / Complete until the vehicle tag is confirmed", () => {
    expect(
      vehicleScanBlocks({
        vehicleOpen: true,
        armadaUserId: 1855,
        vehicleConfirmed: false,
        action: "start",
      }),
    ).toMatch(/before starting/);
    expect(
      vehicleScanBlocks({
        vehicleOpen: true,
        armadaUserId: 1855,
        vehicleConfirmed: false,
        action: "stop",
      }),
    ).toMatch(/before opening/);
    expect(
      vehicleScanBlocks({
        vehicleOpen: true,
        armadaUserId: 1855,
        vehicleConfirmed: true,
        action: "complete",
      }),
    ).toBeNull();
    expect(
      vehicleScanBlocks({
        vehicleOpen: false,
        armadaUserId: 1855,
        vehicleConfirmed: false,
        action: "complete",
      }),
    ).toBeNull();
  });

  it("blocks complete when catalog parts or the vehicle are still pending", () => {
    const pending = [
      {
        kind: "part" as const,
        catalogItemId: "p1",
        description: "Pad",
        qty: 1,
        unitPrice: 10,
        unitCost: 4,
        vendor: "",
      },
    ];
    expect(jobRequireScanReason({ lines: pending })).toMatch(/catalog part/);
    expect(
      jobRequireScanReason({
        lines: [{ ...pending[0]!, scannedAt: "2026-01-01T00:00:00.000Z" }],
      }),
    ).toBeNull();
    expect(jobRequireScanReason({ requireVehicle: true, vehicleConfirmed: false })).toBe(
      "Scan the vehicle before completing this job",
    );
    expect(jobRequireScanReason({ requireVehicle: true, vehicleConfirmed: true })).toBeNull();
    expect(
      jobRequireScanReason({
        cargoLines: [{ catalogItemId: "g1", name: "Oil", qty: 1, unit: "L" }],
      }),
    ).toMatch(/expected item/);
  });

  it("formats catalog on-hand without inventing stock", () => {
    expect(formatOnHand(undefined)).toBe("");
    expect(formatOnHand({ onHand: null })).toBe("");
    expect(formatOnHand({ onHand: 12 })).toBe("12 on hand");
    expect(formatOnHand({ onHand: 12, reservedQty: 2 })).toBe("10 available · 12 on hand");
  });

  it("confirms a depot tag against the stop zone", () => {
    expect(locationScanNotice({ name: "Dago", zone: "Dago" })).toBe("Location confirmed · Dago");
    expect(locationScanNotice({ name: "Dago", zone: "Ciumbuleuit" })).toBe(
      "Location: Dago (stop zone is Ciumbuleuit)",
    );
    expect(locationScanNotice({ name: "Dago" })).toBe("Location: Dago");
  });
});
