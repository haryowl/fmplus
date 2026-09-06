import { describe, expect, it } from "vitest";
import { sumIgnitionOnHours } from "./ignitionHours";
import { MAX_GAP_MS } from "./config";

function pt(iso: string, ignition: boolean) {
  return { utc: iso, variables: { ignition } };
}

describe("sumIgnitionOnHours", () => {
  it("sums ignition-on gaps", () => {
    const hours = sumIgnitionOnHours([
      pt("2026-01-01T10:00:00.000Z", true),
      pt("2026-01-01T10:02:00.000Z", true),
      pt("2026-01-01T10:04:00.000Z", false),
    ]);
    // 2 min + 2 min while prev ign on = 4 min
    expect(hours).toBeCloseTo(4 / 60, 5);
  });

  it("ignores gaps larger than MAX_GAP_MS", () => {
    const t0 = Date.parse("2026-01-01T10:00:00.000Z");
    const hours = sumIgnitionOnHours([
      pt(new Date(t0).toISOString(), true),
      pt(new Date(t0 + MAX_GAP_MS + 1000).toISOString(), true),
    ]);
    expect(hours).toBe(0);
  });

  it("does not count ignition-off gaps", () => {
    const hours = sumIgnitionOnHours([
      pt("2026-01-01T10:00:00.000Z", false),
      pt("2026-01-01T10:03:00.000Z", true),
    ]);
    expect(hours).toBe(0);
  });

  it("respects sinceMs window", () => {
    const hours = sumIgnitionOnHours(
      [
        pt("2026-01-01T10:00:00.000Z", true),
        pt("2026-01-01T10:04:00.000Z", true),
      ],
      { sinceMs: Date.parse("2026-01-01T10:02:00.000Z") },
    );
    expect(hours).toBeCloseTo(2 / 60, 5);
  });
});
