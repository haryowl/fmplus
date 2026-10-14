import { describe, expect, it } from "vitest";
import {
  formatCargoSummary,
  formatPackHint,
  goodsSkuFromCsvRow,
  parseGoodsUnit,
  parseOrderGoodsCell,
  parseUnitsPerPack,
  qtyFromBasePcs,
  qtyToBasePcs,
  sumCargoTotals,
} from "../../server/dispatch-goods.mjs";
import { DISPATCH_GOODS_CSV_HEADERS, dispatchGoodsCsvFromItems, dispatchGoodsCsvTemplate } from "./csvImport";
import { formatGoodsPackHint, qtyToBasePcs as clientQtyToBasePcs } from "./dispatch";

describe("dispatch goods helpers", () => {
  it("parses known units and falls back to pcs", () => {
    expect(parseGoodsUnit("box")).toBe("box");
    expect(parseGoodsUnit("carton")).toBe("carton");
    expect(parseGoodsUnit("pack")).toBe("pack");
    expect(parseGoodsUnit("L")).toBe("L");
    expect(parseGoodsUnit("widget")).toBe("pcs");
  });

  it("stores pack size only for packable units", () => {
    expect(parseUnitsPerPack(12, "box")).toBe(12);
    expect(parseUnitsPerPack(12, "pcs")).toBe(null);
    expect(parseUnitsPerPack("", "carton")).toBe(null);
    expect(formatPackHint("box", 12)).toBe("1 box = 12 pcs");
    expect(formatGoodsPackHint("box", 12)).toBe("1 box = 12 pcs");
  });

  it("converts pack qty to base pcs and back", () => {
    expect(qtyToBasePcs(2, 12)).toBe(24);
    expect(qtyFromBasePcs(24, 12)).toBe(2);
    expect(qtyToBasePcs(3, null)).toBe(3);
    expect(clientQtyToBasePcs(2, 12)).toBe(24);
  });

  it("sums qty × each and ignores missing dimensions", () => {
    expect(
      sumCargoTotals([
        { qty: 2, volumeM3Each: 0.5, weightKgEach: 10 },
        { qty: 1, volumeM3Each: null, weightKgEach: 3 },
      ]),
    ).toEqual({ volumeM3: 1, weightKg: 23 });
    expect(sumCargoTotals([])).toEqual({ volumeM3: null, weightKg: null });
  });

  it("formats a compact cargo summary", () => {
    expect(
      formatCargoSummary([
        { qty: 3, unit: "pcs", name: "Oil" },
        { qty: 2, unit: "box", name: "Filter" },
        { qty: 1, unit: "bag", name: "Rice" },
        { qty: 4, unit: "pcs", name: "Cups" },
      ]),
    ).toBe("3 pcs Oil · 2 box Filter · 1 bag Rice +1");
    expect(formatCargoSummary([])).toBe("");
  });

  it("parses optional order-CSV goods cells", () => {
    expect(parseOrderGoodsCell("Oil:2; Filter:1 box")).toEqual([
      { key: "Oil", qty: 2, unit: "" },
      { key: "Filter", qty: 1, unit: "box" },
    ]);
    expect(parseOrderGoodsCell("Oil x 2 pcs | SKU-9:3")).toEqual([
      { key: "Oil", qty: 2, unit: "pcs" },
      { key: "SKU-9", qty: 3, unit: "" },
    ]);
    expect(parseOrderGoodsCell("")).toEqual([]);
  });

  it("reads SKU from goods CSV aliases", () => {
    expect(goodsSkuFromCsvRow({ sku: "OIL-01" })).toBe("OIL-01");
    expect(goodsSkuFromCsvRow({ item_sku: "FIL-02" })).toBe("FIL-02");
    expect(goodsSkuFromCsvRow({ item_code: "BOX-1" })).toBe("BOX-1");
    expect(goodsSkuFromCsvRow({ name: "Oil" })).toBe("");
  });
});

describe("goods CSV template", () => {
  it("includes sku and units_per_pack columns", () => {
    expect(DISPATCH_GOODS_CSV_HEADERS).toContain("sku");
    expect(DISPATCH_GOODS_CSV_HEADERS).toContain("units_per_pack");
    expect(DISPATCH_GOODS_CSV_HEADERS).toContain("on_hand");
    expect(dispatchGoodsCsvTemplate()).toMatch(/^name,sku,unit,units_per_pack/);
    expect(
      dispatchGoodsCsvFromItems([
        { name: "Oil", sku: "OIL-01", unit: "L", onHand: 12 },
        { name: "Filter", sku: "FIL-02", unit: "box", unitsPerPack: 12, onHand: 8 },
      ]),
    ).toContain("12");
  });
});
