import { describe, expect, it } from "vitest";
import {
  isImpossibleGpsStep,
  isNullIsland,
  keepGpsTrack,
  splitTrailByJump,
} from "./gpsJump";

describe("gpsJump", () => {
  it("treats 0,0 as null island", () => {
    expect(isNullIsland(0, 0)).toBe(true);
    expect(isNullIsland(-3.99, 122.51)).toBe(false);
  });

  it("drops a 200 km hop in a few seconds", () => {
    const a = { lat: -3.99, lon: 122.51, ms: 1_000 };
    const b = { lat: -5.47, lon: 122.63, ms: 6_000 };
    expect(isImpossibleGpsStep(a, b)).toBe(true);
  });

  it("keeps a 40 km hop over 30 minutes", () => {
    const a = { lat: -6.2, lon: 106.8, ms: 0 };
    const b = { lat: -6.55, lon: 106.8, ms: 30 * 60_000 };
    expect(isImpossibleGpsStep(a, b)).toBe(false);
  });

  it("skips the island glitch and keeps the real track", () => {
    const t0 = Date.parse("2026-10-21T08:00:00.000Z");
    const pts = keepGpsTrack([
      { lat: -3.99, lon: 122.51, ms: t0, id: "a" },
      { lat: -5.47, lon: 122.63, ms: t0 + 5_000, id: "jump" },
      { lat: -3.995, lon: 122.52, ms: t0 + 40_000, id: "b" },
    ]);
    expect(pts.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("splits a polyline at an 80 km+ teleport", () => {
    const segs = splitTrailByJump([
      [-3.99, 122.51],
      [-4.0, 122.52],
      [-5.5, 123.5],
      [-5.51, 123.51],
    ]);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toHaveLength(2);
    expect(segs[1]).toHaveLength(2);
  });
});
