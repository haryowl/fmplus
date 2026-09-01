import { describe, expect, it } from "vitest";
import {
  buildTrackMap,
  colorSegments,
  downsamplePath,
  elevationColor,
  MAP_COLOR,
  roadColor,
} from "./trackMap";
import type { Trip } from "./types";

describe("downsamplePath", () => {
  it("keeps endpoints when thinning a long path", () => {
    const points = Array.from({ length: 11 }, (_, i) => ({
      ms: i * 1000,
      lat: -6.2,
      lon: 106.8 + i * 0.0001,
      alt: 10 + i,
      vibrationMg: null,
    }));
    const thin = downsamplePath(points, 3);
    expect(thin[0]).toEqual(points[0]);
    expect(thin.at(-1)).toEqual(points.at(-1));
    expect(thin.length).toBe(3);
  });
});

describe("elevationColor / roadColor", () => {
  it("splits the altitude range into thirds", () => {
    expect(elevationColor(0, 0, 90)).toBe(MAP_COLOR.low);
    expect(elevationColor(40, 0, 90)).toBe(MAP_COLOR.mid);
    expect(elevationColor(80, 0, 90)).toBe(MAP_COLOR.high);
  });

  it("uses the same vibration buckets as the road panel", () => {
    expect(roadColor(40)).toBe(MAP_COLOR.low);
    expect(roadColor(200)).toBe(MAP_COLOR.mid);
    expect(roadColor(400)).toBe(MAP_COLOR.high);
  });
});

describe("buildTrackMap", () => {
  const point = (
    utc: string,
    lat: number,
    lon: number,
    extra: { alt?: number; axis?: number } = {},
  ) => ({
    utc,
    position: { latitude: lat, longitude: lon, altitude: extra.alt },
    variables: extra.axis !== undefined ? { axisX: extra.axis, axisY: 0, axisZ: 0 } : {},
  });

  it("splits a GPS jump into separate paths and drops the teleport edge", () => {
    const trips: Trip[] = [
      {
        trackInfoId: 1,
        userId: 9,
        created: null,
        tracks: [
          point("2025-04-01T01:00:00Z", -6.2, 106.8, { alt: 10 }),
          point("2025-04-01T01:01:00Z", -6.201, 106.801, { alt: 12 }),
          point("2025-04-01T01:02:00Z", -8.7, 115.2, { alt: 20 }),
          point("2025-04-01T01:03:00Z", -8.701, 115.201, { alt: 22 }),
        ],
      },
    ];
    const data = buildTrackMap(trips, {
      dateFrom: "2025-04-01",
      dateTo: "2025-04-01",
      timezone: "+00:00",
    });
    expect(data.paths).toHaveLength(2);
    expect(data.hasAltitude).toBe(true);
    const segs = colorSegments(data.paths, "path", data.altMin, data.altMax);
    const all = segs.flatMap((s) => s.points);
    expect(all.some((p) => Math.abs(p[0] + 6.2) < 0.01 && Math.abs(p[1] - 115.2) < 0.01)).toBe(false);
  });

  it("colors consecutive road edges and merges the same bucket", () => {
    const trips: Trip[] = [
      {
        trackInfoId: 1,
        userId: 9,
        created: null,
        tracks: [
          point("2025-04-01T01:00:00Z", -6.2, 106.8, { axis: 40 }),
          point("2025-04-01T01:01:00Z", -6.201, 106.801, { axis: 50 }),
          point("2025-04-01T01:02:00Z", -6.202, 106.802, { axis: 45 }),
        ],
      },
    ];
    const data = buildTrackMap(trips, {
      dateFrom: "2025-04-01",
      dateTo: "2025-04-01",
      timezone: "+00:00",
    });
    expect(data.hasRoad).toBe(true);
    const segs = colorSegments(data.paths, "road", null, null);
    expect(segs).toHaveLength(1);
    expect(segs[0].color).toBe(MAP_COLOR.low);
    expect(segs[0].points).toHaveLength(3);
  });
});
