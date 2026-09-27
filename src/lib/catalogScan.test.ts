import { describe, expect, it } from "vitest";
import { applyGoodsScan, applyMaintPartScan } from "./catalogScan";
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
});
