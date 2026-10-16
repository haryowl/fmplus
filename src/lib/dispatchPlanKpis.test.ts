import { describe, expect, it } from "vitest";
import {
  computePlanDayKpis,
  planKpisSuggestImprove,
} from "../../server/dispatch-plan-kpis.mjs";

describe("computePlanDayKpis", () => {
  it("summarizes empty plans", () => {
    expect(
      computePlanDayKpis({
        routes: [],
        unassigned: [],
        orderCount: 0,
        startedAtMs: 1000,
        endedAtMs: 1100,
      }),
    ).toEqual({
      routeCount: 0,
      assignedStops: 0,
      assignedOrders: 0,
      unassignedCount: 0,
      lateStops: 0,
      totalDistanceKm: 0,
      avgUtilizationPct: 0,
      minUtilizationPct: 0,
      maxUtilizationPct: 0,
      utilizationSpreadPct: 0,
      balanceMoves: 0,
      solveMs: 100,
      suggestImprove: false,
    });
  });

  it("computes distance, late stops, and fill spread", () => {
    const kpis = computePlanDayKpis({
      routes: [
        {
          orderIds: ["a", "b"],
          utilizationPct: 80,
          distanceKm: 12.34,
          lateStops: 1,
        },
        {
          orderIds: ["c"],
          utilizationPct: 40,
          distanceKm: 5.6,
          lateStops: 0,
        },
        { orderIds: [], utilizationPct: 0, distanceKm: 0, lateStops: 0 },
      ],
      unassigned: [{ orderId: "d" }],
      orderCount: 4,
      balanceMoves: 2,
      startedAtMs: 0,
      endedAtMs: 250,
    });
    expect(kpis.routeCount).toBe(2);
    expect(kpis.assignedStops).toBe(3);
    expect(kpis.assignedOrders).toBe(3);
    expect(kpis.unassignedCount).toBe(1);
    expect(kpis.lateStops).toBe(1);
    expect(kpis.totalDistanceKm).toBe(17.94);
    expect(kpis.avgUtilizationPct).toBe(60);
    expect(kpis.minUtilizationPct).toBe(40);
    expect(kpis.maxUtilizationPct).toBe(80);
    expect(kpis.utilizationSpreadPct).toBe(40);
    expect(kpis.balanceMoves).toBe(2);
    expect(kpis.solveMs).toBe(250);
    expect(kpis.suggestImprove).toBe(true);
  });
});

describe("planKpisSuggestImprove", () => {
  it("flags unassigned, late stops, or wide fill spread", () => {
    expect(planKpisSuggestImprove({ unassignedCount: 1, lateStops: 0, utilizationSpreadPct: 0 })).toBe(
      true,
    );
    expect(planKpisSuggestImprove({ unassignedCount: 0, lateStops: 2, utilizationSpreadPct: 0 })).toBe(
      true,
    );
    expect(
      planKpisSuggestImprove({ unassignedCount: 0, lateStops: 0, utilizationSpreadPct: 25 }),
    ).toBe(true);
    expect(
      planKpisSuggestImprove({ unassignedCount: 0, lateStops: 0, utilizationSpreadPct: 24 }),
    ).toBe(false);
  });
});
