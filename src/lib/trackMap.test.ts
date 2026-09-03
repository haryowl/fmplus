import { describe, expect, it } from "vitest";
import {
  buildTrackMap,
  colorSegments,
  downsamplePath,
  elevationColor,
  MAP_COLOR,
  pathsForMapView,
  roadColor,
} from "./trackMap";
import type { Trip } from "./types";

describe("pathsForMapView", () => {
  const mk = (lat: number, lon: number) => ({
    ms: 1,
    lat,
    lon,
    alt: null,
    vibrationMg: null,
  });

  it("drops vertices well outside the current view", () => {
    const paths = [
      [mk(-6.2, 106.8), mk(-6.21, 106.81)],
      [mk(1, 110), mk(1.01, 110.01)],
    ];
    const view = pathsForMapView(paths, { south: -6.3, west: 106.7, north: -6.1, east: 106.9 }, 8000);
    expect(view).toHaveLength(1);
    expect(view[0]).toHaveLength(2);
    expect(view[0][0].lat).toBeCloseTo(-6.2);
  });
});

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

  it("keeps every in-range GPS point instead of thinning at build time", () => {
    const tracks = Array.from({ length: 40 }, (_, i) =>
      point(
        `2025-04-01T01:${String(i).padStart(2, "0")}:00Z`,
        -6.2,
        106.8 + i * 0.0001,
      ),
    );
    const data = buildTrackMap(
      [{ trackInfoId: 1, userId: 9, created: null, tracks }],
      { dateFrom: "2025-04-01", dateTo: "2025-04-01", timezone: "+00:00" },
    );
    expect(data.pointCount).toBe(40);
    expect(data.rawCount).toBe(40);
    expect(data.start?.lon).toBeCloseTo(106.8);
    expect(data.end?.lon).toBeCloseTo(106.8 + 39 * 0.0001);
  });

  it("keeps a long time gap on one line when the vehicle only moved a few km", () => {
    const trips: Trip[] = [
      {
        trackInfoId: 1,
        userId: 9,
        created: null,
        tracks: [
          point("2025-04-01T01:00:00Z", -6.2, 106.8),
          point("2025-04-01T01:20:00Z", -6.21, 106.82),
        ],
      },
    ];
    const data = buildTrackMap(trips, {
      dateFrom: "2025-04-01",
      dateTo: "2025-04-01",
      timezone: "+00:00",
    });
    expect(data.paths).toHaveLength(1);
    expect(data.paths[0]).toHaveLength(2);
  });

  it("breaks the line on a GPS teleport but keeps both local clusters", () => {
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
    expect(data.paths[0]).toHaveLength(2);
    expect(data.paths[1]).toHaveLength(2);
    expect(data.pointCount).toBe(4);
    expect(data.hasAltitude).toBe(true);
  });

  it("drops a 0,0 no-fix so the map does not stretch across the ocean", () => {
    const trips: Trip[] = [
      {
        trackInfoId: 1,
        userId: 9,
        created: null,
        tracks: [
          point("2025-04-01T01:00:00Z", 0, 0),
          point("2025-04-01T01:01:00Z", -6.2, 106.8),
          point("2025-04-01T01:02:00Z", -6.201, 106.801),
          point("2025-04-01T01:03:00Z", -6.202, 106.802),
        ],
      },
    ];
    const data = buildTrackMap(trips, {
      dateFrom: "2025-04-01",
      dateTo: "2025-04-01",
      timezone: "+00:00",
    });
    expect(data.rawCount).toBe(3);
    expect(data.pointCount).toBe(3);
    expect(data.paths).toHaveLength(1);
    expect(data.start?.lat).toBeCloseTo(-6.2);
    expect(data.end?.lon).toBeCloseTo(106.802);
  });

  it("drops a lone far glitch that is not exactly 0,0", () => {
    const trips: Trip[] = [
      {
        trackInfoId: 1,
        userId: 9,
        created: null,
        tracks: [
          point("2025-04-01T01:00:00Z", 1.2, -4.5),
          point("2025-04-01T01:01:00Z", -6.2, 106.8),
          point("2025-04-01T01:02:00Z", -6.201, 106.801),
          point("2025-04-01T01:03:00Z", -6.202, 106.802),
        ],
      },
    ];
    const data = buildTrackMap(trips, {
      dateFrom: "2025-04-01",
      dateTo: "2025-04-01",
      timezone: "+00:00",
    });
    expect(data.pointCount).toBe(3);
    expect(data.paths).toHaveLength(1);
    expect(data.start?.lat).toBeCloseTo(-6.2);
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
