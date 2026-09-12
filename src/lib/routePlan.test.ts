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
