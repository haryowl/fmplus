import { describe, expect, it } from "vitest";
import {
  applyDeliveredQtyOverrides,
  parseStockSettings,
  checkDepotStockForLines,
  publicTruckStock,
  STOCK_MOVE_KINDS,
} from "../../server/dispatch-stock.mjs";
import {
  buildDeliveredLinesPayload,
  groupTruckStockByJob,
  initDeliveredQtyByItem,
  type DispatchTruckStock,
} from "./dispatch";

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

describe("stock move kinds", () => {
  it("includes pickup delivery return write_off", () => {
    expect(STOCK_MOVE_KINDS).toEqual(
      expect.arrayContaining(["pickup", "delivery", "return", "write_off", "adjust", "receive"]),
    );
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

describe("publicTruckStock", () => {
  it("includes catalog labels from the goods join", () => {
    expect(
      publicTruckStock({
        id: "t1",
        job_id: "j1",
        catalog_item_id: "c1",
        job_title: "JOB-1",
        item_name: "Water",
        item_sku: "W-1",
        item_unit: "crate",
        qty: 3,
        updated_at: null,
      }),
    ).toMatchObject({
      jobId: "j1",
      itemName: "Water",
      itemSku: "W-1",
      unit: "crate",
      qty: 3,
    });
  });
});

describe("applyDeliveredQtyOverrides", () => {
  it("keeps planned qty when no overrides", () => {
    expect(
      applyDeliveredQtyOverrides(
        [
          { catalogItemId: "a", qty: 5, name: "A" },
          { catalogItemId: "b", qty: 2, name: "B" },
        ],
        null,
      ),
    ).toEqual([
      expect.objectContaining({ catalogItemId: "a", qty: 5 }),
      expect.objectContaining({ catalogItemId: "b", qty: 2 }),
    ]);
  });

  it("uses partial delivered qty and drops zeros", () => {
    expect(
      applyDeliveredQtyOverrides(
        [
          { catalogItemId: "a", qty: 5, name: "A" },
          { catalogItemId: "b", qty: 2, name: "B" },
        ],
        [
          { catalogItemId: "a", qty: 3 },
          { catalogItemId: "b", qty: 0 },
        ],
      ),
    ).toEqual([expect.objectContaining({ catalogItemId: "a", qty: 3 })]);
  });
});

describe("buildDeliveredLinesPayload", () => {
  it("clamps to planned qty and defaults missing inputs", () => {
    expect(
      buildDeliveredLinesPayload(
        [
          { name: "A", qty: 5, unit: "pcs", catalogItemId: "a" },
          { name: "Loose", qty: 1, unit: "pcs" },
        ],
        { a: "9" },
      ),
    ).toEqual([{ catalogItemId: "a", qty: 5 }]);
    expect(initDeliveredQtyByItem([{ name: "A", qty: 4, unit: "pcs", catalogItemId: "a" }])).toEqual({
      a: "4",
    });
  });
});

describe("groupTruckStockByJob", () => {
  it("groups positive qty lines and skips empty", () => {
    const rows: DispatchTruckStock[] = [
      {
        id: "1",
        jobId: "j-b",
        catalogItemId: "c1",
        jobTitle: "Beta",
        qty: 2,
        itemName: "A",
        unit: "pcs",
      },
      {
        id: "2",
        jobId: "j-a",
        catalogItemId: "c2",
        jobTitle: "Alpha",
        qty: 1,
        itemName: "B",
        unit: "pcs",
      },
      {
        id: "3",
        jobId: "j-b",
        catalogItemId: "c3",
        jobTitle: "Beta",
        qty: 0,
      },
    ];
    const groups = groupTruckStockByJob(rows);
    expect(groups.map((g) => g.jobTitle)).toEqual(["Alpha", "Beta"]);
    expect(groups[1].totalQty).toBe(2);
    expect(groups[1].lines).toHaveLength(1);
  });
});
