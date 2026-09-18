import { describe, expect, it } from "vitest";
import { formatAge, metresBetween, shouldRecordFix } from "./driverLocation";

const T0 = Date.parse("2026-09-17T10:00:00Z");

describe("metresBetween", () => {
  it("measures a short Jakarta hop", () => {
    // ~0.001 degree of latitude is about 111 m.
    expect(metresBetween(-6.2, 106.8, -6.201, 106.8)).toBeGreaterThan(100);
    expect(metresBetween(-6.2, 106.8, -6.201, 106.8)).toBeLessThan(120);
  });

  it("is zero for the same point", () => {
    expect(metresBetween(-6.2, 106.8, -6.2, 106.8)).toBe(0);
  });
});

describe("shouldRecordFix", () => {
  const last = { lat: -6.2, lon: 106.8, at: T0 };

  it("always keeps the first fix", () => {
    expect(shouldRecordFix({ lat: -6.2, lon: 106.8, accuracyM: 10, at: T0 }, null)).toBe(true);
  });

  it("drops a uselessly coarse fix", () => {
    expect(shouldRecordFix({ lat: -6.2, lon: 106.8, accuracyM: 3000, at: T0 }, null)).toBe(false);
  });

  it("throttles chatter inside the minimum interval even when moving", () => {
    expect(
      shouldRecordFix({ lat: -6.21, lon: 106.8, accuracyM: 10, at: T0 + 5_000 }, last),
    ).toBe(false);
  });

  it("keeps a fix once the driver has moved past the distance gate", () => {
    // ~111 m north, well past the 25 m gate, after the interval has elapsed.
    expect(
      shouldRecordFix({ lat: -6.201, lon: 106.8, accuracyM: 10, at: T0 + 16_000 }, last),
    ).toBe(true);
  });

  it("skips a stationary driver between heartbeats", () => {
    expect(
      shouldRecordFix({ lat: -6.2, lon: 106.8, accuracyM: 10, at: T0 + 20_000 }, last),
    ).toBe(false);
  });

  it("emits a heartbeat for a parked driver after the quiet window", () => {
    expect(
      shouldRecordFix({ lat: -6.2, lon: 106.8, accuracyM: 10, at: T0 + 61_000 }, last),
    ).toBe(true);
  });

  it("lets a heartbeat through even when the fix is barely moving", () => {
    expect(
      shouldRecordFix({ lat: -6.20001, lon: 106.8, accuracyM: 10, at: T0 + 120_000 }, last),
    ).toBe(true);
  });
});

describe("formatAge", () => {
  it("renders seconds, minutes, and hours", () => {
    expect(formatAge(new Date(T0 - 12_000).toISOString(), T0)).toBe("12s ago");
    expect(formatAge(new Date(T0 - 4 * 60_000).toISOString(), T0)).toBe("4m ago");
    expect(formatAge(new Date(T0 - 95 * 60_000).toISOString(), T0)).toBe("1h 35m ago");
  });

  it("handles missing and unparseable values", () => {
    expect(formatAge(null, T0)).toBe("never");
    expect(formatAge("nonsense", T0)).toBe("never");
  });

  it("never reports a negative age from handset clock skew", () => {
    expect(formatAge(new Date(T0 + 5_000).toISOString(), T0)).toBe("0s ago");
  });
});
