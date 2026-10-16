import { describe, expect, it } from "vitest";
import {
  FIELD_ASSIGNED_CARGO_ERROR,
  fieldCargoPreservesAssigned,
  formatCargoSummary,
  formatPackHint,
  goodsSkuFromCsvRow,
  lineAmountFrom,
  moneyOrNullGoods,
  parseGoodsUnit,
  parseOrderGoodsCell,
  parseUnitsPerPack,
  qtyFromBasePcs,
  qtyToBasePcs,
  sumCargoTotals,
  sumMoneyTotals,
} from "../../server/dispatch-goods.mjs";
import { DISPATCH_GOODS_CSV_HEADERS, dispatchGoodsCsvFromItems, dispatchGoodsCsvTemplate } from "./csvImport";
import {
  formatGoodsPackHint,
  qtyToBasePcs as clientQtyToBasePcs,
  sumOrderMoneyTotals,
} from "./dispatch";

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

  it("rounds money and line amounts in IDR", () => {
    expect(moneyOrNullGoods(25000.4)).toBe(25000);
    expect(moneyOrNullGoods(-1)).toBe(null);
    expect(lineAmountFrom(3, 25000)).toBe(75000);
    expect(
      sumMoneyTotals([
        { qty: 2, unitPrice: 10000, costPrice: 6000 },
        { qty: 1, unitPrice: 5000, costPrice: 4000 },
      ]),
    ).toEqual({ goodsSubtotal: 25000, goodsCostSubtotal: 16000 });
    expect(
      sumOrderMoneyTotals([
        { name: "A", qty: 2, unit: "pcs", unitPrice: 10000, costPrice: 6000, lineAmount: 20000 },
        { name: "B", qty: 1, unit: "pcs", unitPrice: 5000, costPrice: 4000, lineAmount: 5000 },
      ]),
    ).toEqual({ goodsSubtotal: 25000, goodsCostSubtotal: 16000, margin: 9000 });
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

  it("locks Field from removing or changing assigned cargo", () => {
    const assigned = [
      { id: "l1", catalogItemId: "g1", name: "blokA", qty: 1, unit: "pcs" },
      { id: "l2", catalogItemId: "g2", name: "Oil", qty: 2, unit: "L" },
    ];
    expect(fieldCargoPreservesAssigned(assigned, assigned)).toEqual({ ok: true });
    expect(
      fieldCargoPreservesAssigned(assigned, [
        ...assigned,
        { catalogItemId: "g3", name: "Extra", qty: 1, unit: "pcs" },
      ]),
    ).toEqual({ ok: true });
    expect(fieldCargoPreservesAssigned(assigned, [assigned[0]])).toEqual({
      ok: false,
      error: FIELD_ASSIGNED_CARGO_ERROR,
    });
    expect(
      fieldCargoPreservesAssigned(assigned, [
        { id: "l1", catalogItemId: "g1", name: "blokA", qty: 1, unit: "pcs" },
        { id: "l2", catalogItemId: "g2", name: "Oil", qty: 1, unit: "L" },
      ]),
    ).toEqual({ ok: false, error: FIELD_ASSIGNED_CARGO_ERROR });
    expect(
      fieldCargoPreservesAssigned(assigned, [
        { id: "l1", catalogItemId: "g1", name: "blokA", qty: 1, unit: "pcs", scannedAt: "2026-10-16T01:00:00Z" },
        { id: "l2", catalogItemId: "g2", name: "Oil", qty: 2, unit: "L" },
      ]),
    ).toEqual({ ok: true });
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
  it("includes sku, pack, and price columns", () => {
    expect(DISPATCH_GOODS_CSV_HEADERS).toContain("sku");
    expect(DISPATCH_GOODS_CSV_HEADERS).toContain("units_per_pack");
    expect(DISPATCH_GOODS_CSV_HEADERS).toContain("sell_price");
    expect(DISPATCH_GOODS_CSV_HEADERS).toContain("cost_price");
    expect(DISPATCH_GOODS_CSV_HEADERS).toContain("on_hand");
    expect(dispatchGoodsCsvTemplate()).toMatch(/^name,sku,unit,units_per_pack,sell_price,cost_price/);
    expect(
      dispatchGoodsCsvFromItems([
        { name: "Oil", sku: "OIL-01", unit: "L", sellPrice: 25000, costPrice: 18000, onHand: 12 },
        { name: "Filter", sku: "FIL-02", unit: "box", unitsPerPack: 12, onHand: 8 },
      ]),
    ).toContain("25000");
  });
});
