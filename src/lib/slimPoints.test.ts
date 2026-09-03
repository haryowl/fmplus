import { describe, expect, it } from "vitest";
import { slimPointsJson } from "../../server/slim-points.mjs";

describe("slimPointsJson", () => {
  it("keeps utc, position, and metric variables only", () => {
    const raw = JSON.stringify([
      {
        uTC: "2026-09-01T00:00:00Z",
        trackInfoId: 9,
        position: { latitude: -1, longitude: 120, altitude: 12 },
        extra: "drop-me",
        variables: {
          speed: 2.5,
          ignition: true,
          odometerAcc: 1000,
          caN300_FuelConsumed: 4,
          unusedCan: 99,
        },
      },
    ]);
    expect(JSON.parse(slimPointsJson(raw))).toEqual([
      {
        utc: "2026-09-01T00:00:00Z",
        trackInfoId: 9,
        position: { latitude: -1, longitude: 120, altitude: 12 },
        variables: {
          speed: 2.5,
          ignition: true,
          odometerAcc: 1000,
          caN300_FuelConsumed: 4,
        },
      },
    ]);
  });

  it("unwraps { items } and array-shaped variables", () => {
    const raw = JSON.stringify({
      items: [
        {
          utc: "2026-09-01T00:00:00Z",
          variables: [
            { name: "speed", value: 1 },
            { name: "noise", value: 8 },
          ],
        },
      ],
    });
    expect(JSON.parse(slimPointsJson(raw))).toEqual([
      {
        utc: "2026-09-01T00:00:00Z",
        variables: { speed: 1 },
      },
    ]);
  });

  it("treats empty and junk as no points", () => {
    expect(slimPointsJson("")).toBe("[]");
    expect(slimPointsJson("not-json")).toBe("[]");
  });
});
