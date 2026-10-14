import { describe, expect, it } from "vitest";
import { parseStockSettings, checkDepotStockForLines } from "../../server/dispatch-stock.mjs";

describe("parseStockSettings", () => {
  it("defaults to warn + Finish-enough", () => {
    expect(parseStockSettings(null)).toEqual({
      stockHardBlock: false,
      stockRequireScan: false,
    });
  });

  it("reads entitlement feature flags", () => {
    expect(
      parseStockSettings({
        features: { dispatchStockHardBlock: true, dispatchStockRequireScan: true },
      }),
    ).toEqual({ stockHardBlock: true, stockRequireScan: true });
  });
});

describe("checkDepotStockForLines", () => {
  it("skips free-text lines without catalog id", async () => {
    const out = await checkDepotStockForLines(
      "00000000-0000-0000-0000-000000000000",
      null,
      [{ name: "Loose", qty: 2 }],
      { hardBlock: false },
    );
    expect(out.ok).toBe(true);
    expect(out.errors).toEqual([]);
  });
});
