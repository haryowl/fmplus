import { describe, expect, it } from "vitest";
import type { LastStatusRow } from "./lastStatus";
import {
  classifyLiveRow,
  countLiveByClass,
  defaultLiveFilters,
  filterLiveRows,
  MOVING_SPEED_KMH,
  STALE_MS,
} from "./liveOps";

function row(partial: Partial<LastStatusRow> & Pick<LastStatusRow, "id">): LastStatusRow {
  return {
    name: partial.name ?? `Vehicle ${partial.id}`,
    username: partial.username ?? `u${partial.id}`,
    utc: partial.utc ?? "",
    deviceActivity: partial.deviceActivity ?? "",
    lastMs: partial.lastMs ?? null,
    lat: partial.lat ?? null,
    lon: partial.lon ?? null,
    altitude: partial.altitude ?? null,
    heading: partial.heading ?? null,
    speedKmh: partial.speedKmh ?? null,
    ignition: partial.ignition ?? null,
    fuelLevel: partial.fuelLevel ?? null,
    odometerKm: partial.odometerKm ?? null,
    ...partial,
  };
}

describe("classifyLiveRow", () => {
  const now = Date.parse("2026-09-06T05:00:00Z");

  it("classifies no fix when coordinates missing", () => {
    expect(classifyLiveRow(row({ id: 1, lastMs: now, speedKmh: 40, ignition: true }), now)).toBe(
      "noFix",
    );
  });

  it("classifies stale before moving when last update is old", () => {
    expect(
      classifyLiveRow(
        row({
          id: 2,
          lat: -6.2,
          lon: 106.8,
          lastMs: now - STALE_MS - 1,
          speedKmh: 50,
          ignition: true,
        }),
        now,
      ),
    ).toBe("stale");
  });

  it("classifies stale when lastMs is null", () => {
    expect(
      classifyLiveRow(row({ id: 3, lat: -6.2, lon: 106.8, lastMs: null, speedKmh: 10 }), now),
    ).toBe("stale");
  });

  it("classifies moving when speed is at threshold", () => {
    expect(
      classifyLiveRow(
        row({
          id: 4,
          lat: -6.2,
          lon: 106.8,
          lastMs: now,
          speedKmh: MOVING_SPEED_KMH,
          ignition: true,
        }),
        now,
      ),
    ).toBe("moving");
  });

  it("classifies idle when ignition on/unknown and not moving", () => {
    expect(
      classifyLiveRow(
        row({ id: 5, lat: -6.2, lon: 106.8, lastMs: now, speedKmh: 2, ignition: true }),
        now,
      ),
    ).toBe("idle");
    expect(
      classifyLiveRow(
        row({ id: 6, lat: -6.2, lon: 106.8, lastMs: now, speedKmh: 0, ignition: null }),
        now,
      ),
    ).toBe("idle");
  });

  it("classifies off when ignition is false and not moving", () => {
    expect(
      classifyLiveRow(
        row({ id: 7, lat: -6.2, lon: 106.8, lastMs: now, speedKmh: 1, ignition: false }),
        now,
      ),
    ).toBe("off");
  });
});

describe("filterLiveRows / countLiveByClass", () => {
  const now = Date.parse("2026-09-06T05:00:00Z");
  const rows = [
    row({ id: 1, lat: null, lon: null, lastMs: now }),
    row({ id: 2, lat: -6, lon: 106, lastMs: now - STALE_MS - 1000 }),
    row({ id: 3, lat: -6, lon: 106, lastMs: now, speedKmh: 20, ignition: true }),
    row({ id: 4, lat: -6, lon: 106, lastMs: now, speedKmh: 0, ignition: true }),
    row({ id: 5, lat: -6, lon: 106, lastMs: now, speedKmh: 0, ignition: false }),
  ];

  it("counts each class", () => {
    expect(countLiveByClass(rows, now)).toEqual({
      noFix: 1,
      stale: 1,
      moving: 1,
      idle: 1,
      off: 1,
    });
  });

  it("filters by enabled classes", () => {
    const enabled = { ...defaultLiveFilters(), moving: false, idle: false, off: false };
    const filtered = filterLiveRows(rows, enabled, now);
    expect(filtered.map((r) => r.id)).toEqual([1, 2]);
  });
});
