import { describe, expect, it } from "vitest";
import { planCvrp } from "../../server/cvrp-plan.mjs";

/** Tiny haversine-ish matrix for tests (symmetric, km). */
function gridMatrix(n: number, stepKm = 5): number[][] {
  const m = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      m[i]![j] = Math.abs(i - j) * stepKm;
    }
  }
  return m;
}

describe("planCvrp multi-trip", () => {
  const depot = { lat: -6.2, lon: 106.8 };
  const mkOrder = (id: string, i: number, vol = 6) => ({
    id,
    label: id,
    lat: depot.lat + 0.01 * (i + 1),
    lon: depot.lon,
    volumeM3: vol,
    weightKg: 100,
  });

  it("stays single-trip when multiTripMode is off", () => {
    const orders = [mkOrder("a", 0, 10), mkOrder("b", 1, 10)];
    const vehicles = [
      {
        key: "v1",
        label: "V1",
        volumeCapacityM3: 12,
        weightCapacityKg: 1500,
        meta: { fullVolumeCapacityM3: 12, fullWeightCapacityKg: 1500 },
      },
    ];
    // points: depot + 2 orders
    const points = [depot, ...orders.map((o) => ({ lat: o.lat, lon: o.lon }))];
    const plan = planCvrp({
      orders,
      vehicles,
      matrixKm: gridMatrix(3),
      points,
      depotIndex: 0,
      roundtrip: true,
      multiTripMode: "off",
      dayStartMin: 8 * 60,
      dayEndMin: 18 * 60,
    });
    expect(plan.multiTripMode).toBe("off");
    expect(plan.routes.every((r) => (r.meta?.tripIndex || 1) === 1)).toBe(true);
    // One vehicle, 12 m³ — only one 10 m³ order fits trip 1; other unassigned without multi-trip
    expect(plan.routes.reduce((n, r) => n + r.orderIds.length, 0)).toBe(1);
    expect(plan.unassigned.length).toBe(1);
  });

  it("plans a second trip when max2 and capacity resets after return", () => {
    const orders = [mkOrder("a", 0, 10), mkOrder("b", 1, 10)];
    const vehicles = [
      {
        key: "v1",
        label: "V1",
        volumeCapacityM3: 12,
        weightCapacityKg: 1500,
        meta: { fullVolumeCapacityM3: 12, fullWeightCapacityKg: 1500 },
      },
    ];
    const points = [depot, ...orders.map((o) => ({ lat: o.lat, lon: o.lon }))];
    const plan = planCvrp({
      orders,
      vehicles,
      matrixKm: gridMatrix(3, 2),
      points,
      depotIndex: 0,
      roundtrip: true,
      multiTripMode: "max2",
      dayStartMin: 8 * 60,
      dayEndMin: 18 * 60,
      reloadMinutes: 10,
      serviceMinutes: 5,
      twMode: "off",
    });
    expect(plan.multiTripMode).toBe("max2");
    expect(plan.routes.length).toBeGreaterThanOrEqual(2);
    const trips = plan.routes.map((r) => r.meta?.tripIndex);
    expect(trips).toContain(1);
    expect(trips).toContain(2);
    expect(plan.unassigned.length).toBe(0);
  });

  it("ignores multi-trip without a depot", () => {
    const orders = [mkOrder("a", 0, 10), mkOrder("b", 1, 10)];
    const vehicles = [
      {
        key: "v1",
        label: "V1",
        volumeCapacityM3: 12,
        weightCapacityKg: 1500,
        meta: { fullVolumeCapacityM3: 12, fullWeightCapacityKg: 1500 },
      },
    ];
    const points = orders.map((o) => ({ lat: o.lat, lon: o.lon }));
    const plan = planCvrp({
      orders,
      vehicles,
      matrixKm: gridMatrix(2),
      points,
      depotIndex: null,
      multiTripMode: "unlimited",
      twMode: "off",
    });
    expect(plan.multiTripMode).toBe("off");
    expect(plan.maxTrips).toBe(1);
  });
});
