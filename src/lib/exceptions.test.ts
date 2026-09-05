import { describe, expect, it } from "vitest";
import { derivedStaleExceptions } from "./exceptions";
import type { LastStatusRow } from "./lastStatus";
import { STALE_MS } from "./liveOps";

function row(partial: Partial<LastStatusRow> & Pick<LastStatusRow, "id">): LastStatusRow {
  return {
    name: `V${partial.id}`,
    username: `u${partial.id}`,
    utc: "",
    deviceActivity: "",
    lastMs: null,
    lat: -6,
    lon: 106,
    altitude: null,
    heading: null,
    speedKmh: 0,
    ignition: false,
    fuelLevel: null,
    odometerKm: null,
    ...partial,
  };
}

describe("derivedStaleExceptions", () => {
  const now = Date.parse("2026-09-06T06:00:00Z");

  it("returns only vehicles older than STALE_MS", () => {
    const rows = [
      row({ id: 1, lastMs: now - STALE_MS - 1 }),
      row({ id: 2, lastMs: now - 60_000 }),
      row({ id: 3, lastMs: null }),
    ];
    const out = derivedStaleExceptions(rows, now);
    expect(out).toHaveLength(1);
    expect(out[0].userId).toBe(1);
    expect(out[0].source).toBe("derived");
    expect(out[0].ruleName).toMatch(/Stale/i);
  });
});
