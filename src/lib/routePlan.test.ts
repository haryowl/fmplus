import { describe, expect, it } from "vitest";
import { buildStopRouteMeta } from "./routePlan";

describe("buildStopRouteMeta", () => {
  it("treats stop 1 as start when there is no depot", () => {
    const meta = buildStopRouteMeta(
      [{ windowStart: "08:00", serviceMinutes: 8 }, { serviceMinutes: 8 }],
      [{ distanceKm: 1.5, durationSec: 180 }],
      8,
    );
    expect(meta.depotDepart).toBeNull();
    expect(meta.returnLeg).toBeNull();
    expect(meta.stops[0]).toEqual({
      legDistanceKm: null,
      legDurationSec: null,
      eta: "08:00",
      dayIndex: 0,
      dayOffset: 0,
      spillDays: 0,
    });
    expect(meta.stops[1]?.eta).toBe("08:11"); // 8 min service + 3 min travel
    expect(meta.stops[1]?.legDistanceKm).toBe(1.5);
  });

  it("counts depot→first and last→return legs", () => {
    const meta = buildStopRouteMeta(
      [
        { windowStart: "08:00", serviceMinutes: 8 },
        { serviceMinutes: 8 },
        { serviceMinutes: 8 },
      ],
      [
        { distanceKm: 10, durationSec: 1200 }, // D→1 = 20 min
        { distanceKm: 1.5, durationSec: 180 }, // 1→2 = 3 min
        { distanceKm: 2, durationSec: 240 }, // 2→3 = 4 min
        { distanceKm: 12, durationSec: 1500 }, // 3→R = 25 min
      ],
      8,
      { hasRouteStart: true, hasRouteEnd: true },
    );
    expect(meta.depotDepart).toBe("08:00");
    expect(meta.stops[0]?.legDistanceKm).toBe(10);
    expect(meta.stops[0]?.eta).toBe("08:20");
    expect(meta.stops[1]?.legDistanceKm).toBe(1.5);
    expect(meta.stops[1]?.eta).toBe("08:31"); // 08:20 + 8 svc + 3
    expect(meta.stops[2]?.eta).toBe("08:43"); // 08:31 + 8 + 4
    expect(meta.returnLeg?.legDistanceKm).toBe(12);
    expect(meta.returnLeg?.eta).toBe("09:16"); // 08:43 + 8 + 25
  });

  it("restarts the chain on each day of a multi-day tour", () => {
    const meta = buildStopRouteMeta(
      [
        { windowStart: "08:00", serviceMinutes: 10, dayIndex: 0 },
        { serviceMinutes: 10, dayIndex: 0 },
        { windowStart: "07:00", serviceMinutes: 10, dayIndex: 1 },
        { serviceMinutes: 10, dayIndex: 1 },
      ],
      [
        { distanceKm: 10, durationSec: 1800 }, // 1→2 = 30 min
        { distanceKm: 300, durationSec: 6 * 3600 }, // overnight repositioning
        { distanceKm: 12, durationSec: 1800 }, // 3→4 = 30 min
      ],
      0,
    );
    expect(meta.stops.map((s) => s.eta)).toEqual(["08:00", "08:40", "07:00", "07:40"]);
    // The leg spanning the overnight rest is rest, not reported travel.
    expect(meta.stops[2]?.legDurationSec).toBeNull();
    expect(meta.stops.map((s) => s.dayIndex)).toEqual([0, 0, 1, 1]);
  });

  it("flags arrivals after midnight with a dayOffset on a continuous drive", () => {
    const meta = buildStopRouteMeta(
      [
        { windowStart: "08:00", serviceMinutes: 0 },
        { serviceMinutes: 0 },
        { serviceMinutes: 0 },
      ],
      [
        { distanceKm: 100, durationSec: 10 * 3600 }, // → 18:00
        { distanceKm: 100, durationSec: 10 * 3600 }, // → 04:00 next day
      ],
      0,
      { continuousAcrossDays: true },
    );
    expect(meta.stops.map((s) => s.eta)).toEqual(["08:00", "18:00", "04:00"]);
    expect(meta.stops.map((s) => s.dayOffset)).toEqual([0, 0, 1]);
    expect(meta.stops.map((s) => s.spillDays)).toEqual([0, 0, 1]);
  });

  it("only spills past a stop's own assigned day, not tour day 0", () => {
    const meta = buildStopRouteMeta(
      [
        { windowStart: "08:00", serviceMinutes: 0, dayIndex: 0 },
        { serviceMinutes: 0, dayIndex: 1 },
        { serviceMinutes: 0, dayIndex: 1 },
      ],
      [
        { distanceKm: 100, durationSec: 10 * 3600 }, // → 18:00 day 0
        { distanceKm: 100, durationSec: 10 * 3600 }, // → 04:00 day 1 calendar
      ],
      0,
      { continuousAcrossDays: true },
    );
    // Second stop is already on Day 2 (dayIndex 1) and arrives still on day 0 clock.
    expect(meta.stops[1]?.dayOffset).toBe(0);
    expect(meta.stops[1]?.spillDays).toBe(0);
    // Third stop lands on calendar day 1 while assigned to dayIndex 1 — no label.
    expect(meta.stops[2]?.dayOffset).toBe(1);
    expect(meta.stops[2]?.spillDays).toBe(0);
  });

  it("counts depot→first without return", () => {
    const meta = buildStopRouteMeta(
      [{ windowStart: "09:00", serviceMinutes: 0 }],
      [{ distanceKm: 5, durationSec: 600 }],
      0,
      { hasRouteStart: true, hasRouteEnd: false },
    );
    expect(meta.depotDepart).toBe("09:00");
    expect(meta.stops[0]?.eta).toBe("09:10");
    expect(meta.returnLeg).toBeNull();
  });
});
