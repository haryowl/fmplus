import { describe, expect, it } from "vitest";
import { elevationFromSamples, flatEquivalentKmPerL, terrainImpactPct } from "./terrain";

function alt(ms: number, value: number, lat = -6.2, lon = 106.8) {
  return { ms, alt: value, lat, lon };
}

describe("elevationFromSamples", () => {
  it("counts a real climb that steps past the 5 m threshold", () => {
    const t0 = Date.parse("2025-04-01T01:00:00Z");
    const stats = elevationFromSamples([
      alt(t0, 10),
      alt(t0 + 20_000, 18),
      alt(t0 + 40_000, 28),
      alt(t0 + 60_000, 40),
    ]);
    expect(stats.gainM).toBe(30);
    expect(stats.lossM).toBe(0);
    expect(stats.minM).toBe(10);
    expect(stats.maxM).toBe(40);
  });

  it("does not treat GPS dither around a level as equal gain and loss", () => {
    const t0 = Date.parse("2025-04-01T01:00:00Z");
    const bounce = [50, 53, 48, 52, 47, 51, 49, 54, 46, 50];
    const stats = elevationFromSamples(bounce.map((value, i) => alt(t0 + i * 10_000, value)));
    expect(stats.gainM).toBeLessThan(15);
    expect(stats.lossM).toBeLessThan(15);
  });

  it("rebases a GPS altitude spike without counting it as climb", () => {
    const t0 = Date.parse("2025-04-01T01:00:00Z");
    const stats = elevationFromSamples([
      alt(t0, 20),
      alt(t0 + 5_000, 220),
      alt(t0 + 10_000, 21),
    ]);
    expect(stats.gainM).toBe(0);
    expect(stats.lossM).toBe(0);
  });
});

describe("flatEquivalentKmPerL", () => {
  it("raises km/l when there is elevation gain (V8 divided and inverted this)", () => {
    const actual = 8.58;
    const impact = terrainImpactPct(54, 6);
    expect(impact).toBeCloseTo(0.9, 5);
    const flat = flatEquivalentKmPerL(actual, impact);
    expect(flat).toBeGreaterThan(actual);
    expect(flat).toBeCloseTo(actual * 1.009, 5);
    const v8Inverted = actual / (1 + impact / 100);
    expect(v8Inverted).toBeLessThan(actual);
  });

  it("stays at actual km/l when there is no gain", () => {
    expect(flatEquivalentKmPerL(8, 0)).toBe(8);
    expect(terrainImpactPct(0, 10)).toBe(0);
  });
});
