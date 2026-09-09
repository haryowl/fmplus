import { describe, expect, it } from "vitest";
import {
  buildDistanceMatrix,
  nearestNeighborOrder,
  optimizeOpenTour,
  pathCost,
  twoOptImprove,
} from "../../server/route-optimize.mjs";

describe("route-optimize", () => {
  it("orders a simple open tour starting at index 0", () => {
    // Start Jakarta, then points that should go east then south-ish
    const points = [
      { lat: -6.2, lon: 106.8 }, // 0 start
      { lat: -6.2, lon: 107.0 }, // 1 east
      { lat: -6.3, lon: 107.0 }, // 2 south-east
      { lat: -6.3, lon: 106.8 }, // 3 south
    ];
    const { order, distance } = optimizeOpenTour(points);
    expect(order[0]).toBe(0);
    expect(new Set(order).size).toBe(4);
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThan(100);
  });

  it("2-opt does not worsen NN path cost", () => {
    const points = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
      { lat: 1, lon: 1 },
      { lat: 1, lon: 0 },
      { lat: 0.5, lon: 0.5 },
    ];
    const m = buildDistanceMatrix(points);
    const nn = nearestNeighborOrder(m);
    const improved = twoOptImprove(nn, m);
    expect(pathCost(improved, m)).toBeLessThanOrEqual(pathCost(nn, m) + 1e-9);
  });
});
