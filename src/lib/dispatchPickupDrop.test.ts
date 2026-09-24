import { describe, expect, it } from "vitest";
import {
  expandOrdersToPlanTasks,
  parseOrderKind,
  restorePairPrecedence,
  routeLoadFeasible,
  routePeakLoad,
} from "../../server/dispatch-pickup-drop.mjs";
import { dropLockedUntilPickup } from "./dispatch";

describe("pickup/drop helpers", () => {
  it("parses kind and expands a pair into two tasks", () => {
    expect(parseOrderKind("pickup_drop")).toBe("pickup_drop");
    expect(parseOrderKind("drop")).toBe("drop");
    expect(parseOrderKind("pickup")).toBe("pickup");
    expect(parseOrderKind("pickup only")).toBe("pickup");
    const tasks = expandOrdersToPlanTasks([
      {
        id: "ord-1",
        kind: "pickup_drop",
        customerName: "Toko",
        lat: -6.2,
        lon: 106.85,
        pickupLat: -6.21,
        pickupLon: 106.82,
        volumeM3: 4,
        weightKg: 200,
      },
      {
        id: "ord-2",
        kind: "drop",
        customerName: "Drop only",
        lat: -6.22,
        lon: 106.86,
        volumeM3: 2,
        weightKg: 50,
      },
    ]);
    expect(tasks).toHaveLength(3);
    expect(tasks[0]).toMatchObject({ sourceOrderId: "ord-1", role: "pickup", pairKey: "ord-1", preloaded: false });
    expect(tasks[1]).toMatchObject({ sourceOrderId: "ord-1", role: "drop", pairKey: "ord-1" });
    expect(tasks[2]).toMatchObject({ sourceOrderId: "ord-2", role: "drop", preloaded: true });
  });

  it("expands pickup-only into one collect task", () => {
    const tasks = expandOrdersToPlanTasks([
      {
        id: "p1",
        kind: "pickup",
        customerName: "Collect",
        lat: -6.2,
        lon: 106.8,
        volumeM3: 3,
        weightKg: 40,
      },
    ]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      sourceOrderId: "p1",
      role: "pickup",
      pairKey: null,
      preloaded: false,
      volumeM3: 3,
    });
  });

  it("pickup-only adds running load without a drop mate", () => {
    const tasks = [
      { pairKey: null, role: "pickup", volumeM3: 4, weightKg: 50, preloaded: false },
      { pairKey: null, role: "drop", volumeM3: 2, weightKg: 20, preloaded: true },
    ];
    expect(routeLoadFeasible([1, 0], tasks, 7, 80)).toBe(true);
    expect(routeLoadFeasible([1, 0], tasks, 5, 80)).toBe(false);
    expect(routePeakLoad([1, 0], tasks)).toMatchObject({ vol: 6, wt: 70, endVol: 6, endWt: 70 });
  });

  it("running load rises at pickup and falls at drop", () => {
    const tasks = [
      { pairKey: "a", role: "pickup", volumeM3: 5, weightKg: 100, preloaded: false },
      { pairKey: null, role: "drop", volumeM3: 3, weightKg: 40, preloaded: true },
      { pairKey: "a", role: "drop", volumeM3: 5, weightKg: 100, preloaded: false },
    ];
    expect(routeLoadFeasible([0, 1, 2], tasks, 8, 200)).toBe(true);
    expect(routeLoadFeasible([0, 1, 2], tasks, 7, 200)).toBe(false);
    expect(routePeakLoad([0, 1, 2], tasks)).toMatchObject({ vol: 8, wt: 140 });
  });

  it("restores pickup before drop after a reversed sequence", () => {
    const indexes = [2, 0, 1];
    const orders = [
      { pairKey: "a", role: "pickup" },
      { id: "solo" },
      { pairKey: "a", role: "drop" },
    ];
    const fixed = restorePairPrecedence(indexes, (oi) => {
      const o = orders[oi];
      if (!o?.pairKey) return null;
      return { key: String(o.pairKey), role: o.role };
    });
    expect(fixed.indexOf(0)).toBeLessThan(fixed.indexOf(2));
  });

  it("locks a drop until its pickup is done", () => {
    const stops = [
      { id: "p", orderId: "o1", role: "pickup" as const, status: "pending" as const },
      { id: "d", orderId: "o1", role: "drop" as const, status: "pending" as const },
    ];
    expect(dropLockedUntilPickup(stops[1] as never, stops as never)).toBe(true);
    expect(
      dropLockedUntilPickup(stops[1] as never, [{ ...stops[0], status: "done" }, stops[1]] as never),
    ).toBe(false);
  });
});
