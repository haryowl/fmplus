import { describe, expect, it } from "vitest";
import { chunkArray, mapPool } from "./pool";

describe("chunkArray", () => {
  it("splits into groups of the given size", () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe("mapPool", () => {
  it("preserves order with a concurrency cap", async () => {
    const seen: number[] = [];
    let inFlight = 0;
    let maxFlight = 0;

    const out = await mapPool([10, 20, 30, 40], 2, async (n) => {
      inFlight += 1;
      maxFlight = Math.max(maxFlight, inFlight);
      seen.push(n);
      await new Promise((resolve) => setTimeout(resolve, 15));
      inFlight -= 1;
      return n * 2;
    });

    expect(out).toEqual([20, 40, 60, 80]);
    expect(maxFlight).toBeLessThanOrEqual(2);
    expect(seen).toHaveLength(4);
  });
});
