import { describe, expect, it } from "vitest";
import {
  balanceRelocate,
  normalizeBalanceGoals,
  planCvrp,
} from "../../server/cvrp-plan.mjs";

function gridMatrix(n: number, stepKm = 5): number[][] {
  const m = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      m[i]![j] = Math.abs(i - j) * stepKm;
    }
  }
  return m;
}

describe("normalizeBalanceGoals", () => {
  it("defaults omitted / invalid to fill", () => {
    expect(normalizeBalanceGoals(undefined)).toEqual(["fill"]);
    expect(normalizeBalanceGoals(null)).toEqual(["fill"]);
    expect(normalizeBalanceGoals("fill")).toEqual(["fill"]);
  });

  it("keeps empty array (skip balance)", () => {
    expect(normalizeBalanceGoals([])).toEqual([]);
  });

  it("dedupes and filters known goals", () => {
    expect(normalizeBalanceGoals(["stops", "fill", "stops", "nope", "distance"])).toEqual([
      "stops",
      "fill",
      "distance",
    ]);
  });
});

describe("planCvrp balanceGoals", () => {
  const depot = { lat: -6.2, lon: 106.8 };
  const mkOrder = (id: string, i: number, vol = 2) => ({
    id,
    label: id,
    lat: depot.lat + 0.01 * (i + 1),
    lon: depot.lon,
    volumeM3: vol,
    weightKg: 50,
  });
  const vehicles = [
    {
      key: "v1",
      label: "V1",
      volumeCapacityM3: 40,
      weightCapacityKg: 2000,
      meta: { fullVolumeCapacityM3: 40, fullWeightCapacityKg: 2000 },
    },
    {
      key: "v2",
      label: "V2",
      volumeCapacityM3: 40,
      weightCapacityKg: 2000,
      meta: { fullVolumeCapacityM3: 40, fullWeightCapacityKg: 2000 },
    },
  ];

  it("omitted goals echo fill and may relocate", () => {
    const orders = [0, 1, 2, 3, 4, 5].map((i) => mkOrder(`o${i}`, i, 8));
    const points = [depot, ...orders.map((o) => ({ lat: o.lat, lon: o.lon }))];
    const plan = planCvrp({
      orders,
      vehicles,
      matrixKm: gridMatrix(points.length, 3),
      points,
      depotIndex: 0,
      roundtrip: true,
      dayStartMin: 8 * 60,
      dayEndMin: 18 * 60,
      twMode: "off",
    });
    expect(plan.balanceGoals).toEqual(["fill"]);
    expect(typeof plan.balanceMoves).toBe("number");
  });

  it("empty goals skip balance relocate", () => {
    const orders = [0, 1, 2, 3, 4, 5].map((i) => mkOrder(`o${i}`, i, 8));
    const points = [depot, ...orders.map((o) => ({ lat: o.lat, lon: o.lon }))];
    const plan = planCvrp({
      orders,
      vehicles,
      matrixKm: gridMatrix(points.length, 3),
      points,
      depotIndex: 0,
      roundtrip: true,
      dayStartMin: 8 * 60,
      dayEndMin: 18 * 60,
      twMode: "off",
      balanceGoals: [],
    });
    expect(plan.balanceGoals).toEqual([]);
    expect(plan.balanceMoves).toBe(0);
  });
});

describe("balanceRelocate stops-only", () => {
  it("moves stops from a many-stop vehicle to an empty capable one", () => {
    const orders = [0, 1, 2, 3].map((i) => ({
      id: `o${i}`,
      label: `o${i}`,
      volumeM3: 1,
      weightKg: 10,
      lat: -6.2 + 0.01 * (i + 1),
      lon: 106.8,
    }));
    // Open tour (no depot): starting a second route does not add depot legs,
    // so the 8% distance guard allows stop balancing onto an empty vehicle.
    const matrix = gridMatrix(4, 2);
    const orderMatrixIndex = (oi: number) => oi;
    const dayStart = 8 * 60;
    const vehicleStates = [
      {
        key: "busy",
        label: "Busy",
        volumeCapacityM3: 20,
        weightCapacityKg: 500,
        residualVol: 16,
        residualWt: 460,
        orderIndexes: [0, 1, 2, 3],
        route: [0, 1, 2, 3],
        dayStartMin: dayStart,
        meta: {},
      },
      {
        key: "idle",
        label: "Idle",
        volumeCapacityM3: 20,
        weightCapacityKg: 500,
        residualVol: 20,
        residualWt: 500,
        orderIndexes: [] as number[],
        route: [] as number[],
        dayStartMin: dayStart,
        meta: {},
      },
    ];

    const moves = balanceRelocate(
      vehicleStates,
      orders,
      matrix,
      null,
      false,
      orderMatrixIndex,
      {
        twMode: "off",
        dayStartMin: dayStart,
        serviceMinutes: 5,
        balanceGoals: ["stops"],
      },
    );

    expect(moves).toBeGreaterThan(0);
    expect(vehicleStates[0]!.orderIndexes.length).toBeLessThan(4);
    expect(vehicleStates[1]!.orderIndexes.length).toBeGreaterThan(0);
    expect(
      vehicleStates[0]!.orderIndexes.length + vehicleStates[1]!.orderIndexes.length,
    ).toBe(4);
  });
});
