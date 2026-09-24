import { describe, expect, it } from "vitest";
import { planCvrp } from "../../server/cvrp-plan.mjs";
import { expandOrdersToPlanTasks } from "../../server/dispatch-pickup-drop.mjs";

function gridMatrix(n: number, stepKm = 5): number[][] {
  const m = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      m[i]![j] = Math.abs(i - j) * stepKm;
    }
  }
  return m;
}

describe("planCvrp pickup/drop pairs", () => {
  it("keeps pickup and drop on the same vehicle with pickup first", () => {
    const depot = { lat: -6.2, lon: 106.8 };
    const orders = [
      {
        id: "pd1",
        kind: "pickup_drop",
        label: "Pair",
        lat: -6.22,
        lon: 106.8,
        pickupLat: -6.21,
        pickupLon: 106.8,
        volumeM3: 6,
        weightKg: 100,
      },
      {
        id: "d1",
        kind: "drop",
        label: "Drop",
        lat: -6.23,
        lon: 106.8,
        volumeM3: 2,
        weightKg: 40,
      },
    ];
    const tasks = expandOrdersToPlanTasks(orders);
    const points = [depot, ...tasks.map((t) => ({ lat: t.lat, lon: t.lon }))];
    const plan = planCvrp({
      orders: tasks,
      vehicles: [
        {
          key: "v1",
          label: "V1",
          volumeCapacityM3: 12,
          weightCapacityKg: 1500,
          meta: { fullVolumeCapacityM3: 12, fullWeightCapacityKg: 1500 },
        },
      ],
      matrixKm: gridMatrix(points.length, 3),
      points,
      depotIndex: 0,
      roundtrip: true,
      twMode: "off",
    });
    expect(plan.routes).toHaveLength(1);
    const route = plan.routes[0]!;
    expect(route.orderIds.filter((id: string) => id === "pd1")).toHaveLength(2);
    expect(route.stopRoles).toEqual(expect.arrayContaining(["pickup", "drop"]));
    const pAt = route.orderIds.findIndex((id: string, i: number) => id === "pd1" && route.stopRoles[i] === "pickup");
    const dAt = route.orderIds.findIndex((id: string, i: number) => id === "pd1" && route.stopRoles[i] === "drop");
    expect(pAt).toBeGreaterThanOrEqual(0);
    expect(dAt).toBeGreaterThan(pAt);
  });

  it("assigns a pickup-only collect as one stop and keeps load on the vehicle", () => {
    const depot = { lat: -6.2, lon: 106.8 };
    const orders = [
      {
        id: "p1",
        kind: "pickup",
        label: "Collect",
        lat: -6.21,
        lon: 106.8,
        volumeM3: 4,
        weightKg: 80,
      },
      {
        id: "d1",
        kind: "drop",
        label: "Drop",
        lat: -6.23,
        lon: 106.8,
        volumeM3: 2,
        weightKg: 20,
      },
    ];
    const tasks = expandOrdersToPlanTasks(orders);
    const points = [depot, ...tasks.map((t) => ({ lat: t.lat, lon: t.lon }))];
    const plan = planCvrp({
      orders: tasks,
      vehicles: [
        {
          key: "v1",
          label: "V1",
          volumeCapacityM3: 10,
          weightCapacityKg: 1500,
          meta: { fullVolumeCapacityM3: 10, fullWeightCapacityKg: 1500 },
        },
      ],
      matrixKm: gridMatrix(points.length, 3),
      points,
      depotIndex: 0,
      roundtrip: true,
      twMode: "off",
    });
    expect(plan.routes).toHaveLength(1);
    const route = plan.routes[0]!;
    expect(route.orderIds).toEqual(expect.arrayContaining(["p1", "d1"]));
    expect(route.orderIds.filter((id: string) => id === "p1")).toHaveLength(1);
    const pAt = route.orderIds.findIndex((id: string) => id === "p1");
    expect(route.stopRoles[pAt]).toBe("pickup");
  });

  it("rejects a pair that exceeds running load even if drop-only sum would fit", () => {
    const depot = { lat: -6.2, lon: 106.8 };
    const orders = [
      {
        id: "pd1",
        kind: "pickup_drop",
        label: "Big pair",
        lat: -6.22,
        lon: 106.8,
        pickupLat: -6.21,
        pickupLon: 106.8,
        volumeM3: 10,
        weightKg: 100,
      },
      {
        id: "d1",
        kind: "drop",
        label: "Preload",
        lat: -6.23,
        lon: 106.8,
        volumeM3: 5,
        weightKg: 40,
      },
    ];
    const tasks = expandOrdersToPlanTasks(orders);
    const points = [depot, ...tasks.map((t) => ({ lat: t.lat, lon: t.lon }))];
    const plan = planCvrp({
      orders: tasks,
      vehicles: [
        {
          key: "v1",
          label: "V1",
          volumeCapacityM3: 12,
          weightCapacityKg: 1500,
          meta: { fullVolumeCapacityM3: 12, fullWeightCapacityKg: 1500 },
        },
      ],
      matrixKm: gridMatrix(points.length, 2),
      points,
      depotIndex: 0,
      roundtrip: true,
      twMode: "off",
    });
    const assigned = plan.routes.flatMap((r) => r.orderIds);
    const pairAssigned = assigned.includes("pd1");
    const dropAssigned = assigned.includes("d1");
    // 5 preload + 10 pair = 15 > 12, so they cannot share a trip.
    expect(pairAssigned && dropAssigned).toBe(false);
  });
});
