import { describe, expect, it } from "vitest";
import { classifyVibration, roadFromSamples, vibrationMg } from "./road";

describe("classifyVibration", () => {
  it("matches V8 buckets: smooth ≤150 mG, rough 150–300, bumpy above 300", () => {
    expect(classifyVibration(0)).toBe("smooth");
    expect(classifyVibration(150)).toBe("smooth");
    expect(classifyVibration(151)).toBe("rough");
    expect(classifyVibration(300)).toBe("rough");
    expect(classifyVibration(301)).toBe("bumpy");
  });
});

describe("roadFromSamples", () => {
  it("splits points and averages per-point magnitude", () => {
    const stats = roadFromSamples([
      { x: 50, y: 0, z: 0 },
      { x: 200, y: 0, z: 0 },
      { x: 400, y: 0, z: 0 },
    ]);
    expect(stats.samples).toBe(3);
    expect(stats.smoothCount).toBe(1);
    expect(stats.roughCount).toBe(1);
    expect(stats.bumpyCount).toBe(1);
    expect(stats.avgVibrationMg).toBeCloseTo((50 + 200 + 400) / 3, 5);
    expect(stats.maxVibrationMg).toBe(400);
  });

  it("uses Euclidean magnitude, not the sum of axes", () => {
    expect(vibrationMg({ x: 3, y: 4, z: 0 })).toBe(5);
  });
});
