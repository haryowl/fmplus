import { describe, expect, it } from "vitest";
import { scanPayloadFor } from "./catalogCodes";
import { deskNfcWriteBlockedReason } from "./nfcWrite";

describe("desk NFC write", () => {
  it("writes the same payload Field will tap", () => {
    expect(scanPayloadFor("goods", "OIL-01")).toBe("am1:v1:goods:OIL-01");
    expect(scanPayloadFor("maint_part", "PAD")).toBe("am1:v1:part:PAD");
  });

  it("blocks Field and missing SKU, and requires Web NFC", () => {
    expect(deskNfcWriteBlockedReason({ nativeField: true, hasNdef: true, sku: "OIL" })).toBe(
      "Field does not write NFC tags",
    );
    expect(deskNfcWriteBlockedReason({ nativeField: false, hasNdef: true, sku: "" })).toBe(
      "Add a SKU to write a tag",
    );
    expect(deskNfcWriteBlockedReason({ nativeField: false, hasNdef: false, sku: "OIL" })).toBe(
      "NFC write needs Chrome on Android",
    );
    expect(deskNfcWriteBlockedReason({ nativeField: false, hasNdef: true, sku: "OIL" })).toBeNull();
  });
});
