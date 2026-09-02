import { describe, expect, it } from "vitest";
import { describeLoadProgress, groupRowsIntoTrips, normalizeTrackPoint } from "./dayTracks";
import { eachDateInclusive } from "./time";

describe("eachDateInclusive", () => {
  it("lists every calendar day in the range", () => {
    expect(eachDateInclusive("2026-08-01", "2026-08-03")).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
    ]);
  });

  it("is empty when the range is inverted", () => {
    expect(eachDateInclusive("2026-08-03", "2026-08-01")).toEqual([]);
  });
});

describe("normalizeTrackPoint", () => {
  it("maps GpsGate uTC onto the utc field metrics already read", () => {
    const row = normalizeTrackPoint({
      uTC: "2026-08-19T01:02:03Z",
      trackInfoId: 44,
      position: { latitude: -6.2, longitude: 106.8, altitude: 12 },
      variables: { speed: 2.5, ignition: true },
    });
    expect(row?.trackInfoId).toBe(44);
    expect(row?.point).toEqual({
      utc: "2026-08-19T01:02:03Z",
      position: { latitude: -6.2, longitude: 106.8, altitude: 12 },
      variables: { speed: 2.5, ignition: true },
    });
  });

  it("drops points with no timestamp", () => {
    expect(normalizeTrackPoint({ trackInfoId: 1, variables: { speed: 1 } })).toBeNull();
  });
});

describe("groupRowsIntoTrips", () => {
  it("keeps one Trip per GpsGate trackInfoId so the rest of the dashboard is unchanged", () => {
    const trips = groupRowsIntoTrips(99, [
      { trackInfoId: 2, point: { utc: "2026-08-19T02:00:00Z" } },
      { trackInfoId: 1, point: { utc: "2026-08-19T01:00:00Z" } },
      { trackInfoId: 2, point: { utc: "2026-08-19T02:01:00Z" } },
    ]);
    expect(trips.map((t) => t.trackInfoId)).toEqual([1, 2]);
    expect(trips[1].tracks).toHaveLength(2);
    expect(trips[0].userId).toBe(99);
  });
});

describe("describeLoadProgress", () => {
  it("names vehicle-days instead of trip downloads", () => {
    expect(describeLoadProgress({ phase: "days", loaded: 12, total: 33 })).toBe(
      "Loading 12 of 33 vehicle-days",
    );
  });
});
