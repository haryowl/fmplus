import { describe, expect, it } from "vitest";
import {
  fencesContaining,
  haversineM,
  pointInCircle,
  pointInRing,
} from "../../server/tenant-geofences.mjs";

describe("tenant geofences", () => {
  it("measures ~111 km per degree of latitude", () => {
    const m = haversineM(-6, 106.8, -7, 106.8);
    expect(m).toBeGreaterThan(110_000);
    expect(m).toBeLessThan(112_000);
  });

  it("detects a point inside a 200 m circle", () => {
    const fence = { kind: "circle", lat: -6.2, lon: 106.8, radiusM: 200, enabled: true };
    expect(pointInCircle(-6.2, 106.8, fence)).toBe(true);
    expect(pointInCircle(-6.21, 106.8, fence)).toBe(false);
  });

  it("ray-casts a square ring", () => {
    const ring: Array<[number, number]> = [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ];
    expect(pointInRing(0.5, 0.5, ring)).toBe(true);
    expect(pointInRing(1.5, 0.5, ring)).toBe(false);
  });

  it("lists containing fences by name", () => {
    const hits = fencesContaining(-6.2, 106.8, [
      { name: "Depot", kind: "circle", lat: -6.2, lon: 106.8, radiusM: 50, enabled: true },
      { name: "Off", kind: "circle", lat: 0, lon: 0, radiusM: 50, enabled: true },
    ]);
    expect(hits.map((f) => f.name)).toEqual(["Depot"]);
  });

  it("detects a point inside a polygon ring", () => {
    const yard = {
      name: "Yard",
      kind: "polygon",
      ring: [
        [-6.201, 106.799],
        [-6.201, 106.801],
        [-6.199, 106.801],
        [-6.199, 106.799],
      ] as Array<[number, number]>,
      enabled: true,
    };
    expect(fencesContaining(-6.2, 106.8, [yard]).map((f) => f.name)).toEqual(["Yard"]);
    expect(fencesContaining(-6.21, 106.8, [yard])).toEqual([]);
  });
});
