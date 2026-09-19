import { describe, expect, it } from "vitest";
import { pickLivePosition, downsampleLatLon } from "../../server/dispatch-live.mjs";
import { computeDwellMinutes, detectExceptionsFromSnapshot } from "../../server/dispatch-recovery.mjs";

const PHONE = { lat: -6.2, lon: 106.8, ageSec: 12, recordedAt: "2026-09-17T10:00:00Z", accuracyM: 8 };
const VEHICLE = { lat: -6.25, lon: 106.85, label: "B 1234 XY" };

describe("pickLivePosition", () => {
  it("prefers a fresh phone fix over the vehicle", () => {
    const pos = pickLivePosition(PHONE, VEHICLE);
    expect(pos?.source).toBe("phone");
    expect(pos?.ageSec).toBe(12);
  });

  it("falls back to the vehicle once the phone goes quiet", () => {
    const pos = pickLivePosition({ ...PHONE, ageSec: 900 }, VEHICLE);
    expect(pos?.source).toBe("armada");
    expect(pos?.lat).toBeCloseTo(VEHICLE.lat);
  });

  it("uses a stale phone fix when there is no vehicle at all", () => {
    const pos = pickLivePosition({ ...PHONE, ageSec: 3600 }, null);
    expect(pos?.source).toBe("phone");
    expect(pos?.ageSec).toBe(3600);
  });

  it("tracks a job with no Armada link entirely from the phone", () => {
    const pos = pickLivePosition(PHONE, undefined);
    expect(pos?.source).toBe("phone");
  });

  it("reports how far apart phone and vehicle are", () => {
    const pos = pickLivePosition(PHONE, VEHICLE);
    // Roughly 7 km diagonally across Jakarta.
    expect(pos?.phoneSeparationKm).toBeGreaterThan(5);
    expect(pos?.phoneSeparationKm).toBeLessThan(10);
  });

  it("omits separation when only one source reports", () => {
    expect(pickLivePosition(PHONE, null)?.phoneSeparationKm).toBeNull();
    expect(pickLivePosition(null, VEHICLE)?.phoneSeparationKm).toBeNull();
  });

  it("returns null when nothing is reporting", () => {
    expect(pickLivePosition(null, null)).toBeNull();
  });
});

describe("downsampleLatLon", () => {
  it("keeps short polylines intact", () => {
    const pts = [
      [0, 0],
      [1, 1],
      [2, 2],
    ];
    expect(downsampleLatLon(pts, 400)).toEqual(pts);
  });

  it("thins long polylines to the cap", () => {
    const pts = Array.from({ length: 1000 }, (_, i) => [i, i]);
    expect(downsampleLatLon(pts, 100)).toHaveLength(100);
  });
});

describe("computeDwellMinutes", () => {
  function trail(points: Array<[number, number, number]>) {
    return points.map(([lat, lon, minAgo]) => ({
      lat,
      lon,
      recordedAt: new Date(Date.parse("2026-09-17T10:00:00Z") - minAgo * 60_000).toISOString(),
    }));
  }

  it("measures a continuous stay in one spot", () => {
    const t = trail([
      [-6.2, 106.8, 50],
      [-6.2001, 106.8, 30],
      [-6.2, 106.8001, 10],
      [-6.2, 106.8, 0],
    ]);
    expect(computeDwellMinutes(t)).toBe(50);
  });

  it("only counts the current stay, not an earlier one", () => {
    const t = trail([
      [-6.2, 106.8, 90], // earlier stay, far away
      [-6.3, 106.9, 40], // drove off
      [-6.3, 106.9001, 20],
      [-6.3, 106.9, 0],
    ]);
    expect(computeDwellMinutes(t)).toBe(40);
  });

  it("is near zero for a moving driver", () => {
    const t = trail([
      [-6.2, 106.8, 30],
      [-6.25, 106.82, 20],
      [-6.3, 106.85, 10],
      [-6.35, 106.88, 0],
    ]);
    expect(computeDwellMinutes(t)).toBe(0);
  });

  it("needs at least two fixes", () => {
    expect(computeDwellMinutes([])).toBeNull();
    expect(computeDwellMinutes(trail([[-6.2, 106.8, 0]]))).toBeNull();
  });
});

function snapshotWith(driver: Record<string, unknown>) {
  return {
    serviceDate: "2026-09-17",
    drivers: [
      {
        jobId: "job-1",
        driverName: "Budi",
        jobStatus: "en_route",
        doneCount: 1,
        stops: [{ stopId: "stop-1", stopStatus: "pending" }],
        startedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
        ...driver,
      },
    ],
    summary: {},
  };
}

describe("stuck detection on the ping stream", () => {
  it("flags a phone that has gone quiet", () => {
    const ex = detectExceptionsFromSnapshot(
      snapshotWith({
        livePosition: { lat: -6.2, lon: 106.8, source: "phone", ageSec: 30 * 60 },
      }),
    ).filter((e: { kind: string }) => e.kind === "stuck");
    expect(ex).toHaveLength(1);
    expect(ex[0].payload.reason).toBe("stale_gps");
    expect(ex[0].detail).toContain("30 min ago");
  });

  it("stays quiet for a fresh phone fix on a driver making progress", () => {
    const ex = detectExceptionsFromSnapshot(
      snapshotWith({
        livePosition: { lat: -6.2, lon: 106.8, source: "phone", ageSec: 20 },
      }),
    ).filter((e: { kind: string }) => e.kind === "stuck");
    expect(ex).toHaveLength(0);
  });

  it("flags a long dwell even when the phone is reporting", () => {
    const ex = detectExceptionsFromSnapshot(
      snapshotWith({
        livePosition: { lat: -6.2, lon: 106.8, source: "phone", ageSec: 20 },
        dwellMin: 70,
      }),
    ).filter((e: { kind: string }) => e.kind === "stuck");
    expect(ex).toHaveLength(1);
    expect(ex[0].payload.reason).toBe("dwell");
  });

  it("does not age an Armada fix, which carries no timestamp", () => {
    const ex = detectExceptionsFromSnapshot(
      snapshotWith({
        livePosition: { lat: -6.2, lon: 106.8, source: "armada", ageSec: null },
      }),
    ).filter((e: { kind: string }) => e.kind === "stuck");
    expect(ex).toHaveLength(0);
  });

  it("flags a driver with no position at all", () => {
    const ex = detectExceptionsFromSnapshot(
      snapshotWith({ livePosition: null }),
    ).filter((e: { kind: string }) => e.kind === "stuck");
    expect(ex).toHaveLength(1);
    expect(ex[0].payload.reason).toBe("no_gps");
  });

  it("raises only one stuck exception per driver", () => {
    const ex = detectExceptionsFromSnapshot(
      snapshotWith({
        livePosition: { lat: -6.2, lon: 106.8, source: "phone", ageSec: 40 * 60 },
        dwellMin: 90,
        doneCount: 0,
      }),
    ).filter((e: { kind: string }) => e.kind === "stuck");
    expect(ex).toHaveLength(1);
  });

  it("leaves a not-yet-started job alone", () => {
    const ex = detectExceptionsFromSnapshot(
      snapshotWith({ jobStatus: "assigned", livePosition: null }),
    ).filter((e: { kind: string }) => e.kind === "stuck");
    expect(ex).toHaveLength(0);
  });
});

describe("carryover work on a multi-day tour", () => {
  it("raises an exception for a stop left open on an earlier day", () => {
    const ex = detectExceptionsFromSnapshot(
      snapshotWith({
        livePosition: { lat: -6.2, lon: 106.8, source: "phone", ageSec: 20 },
        dayIndex: 1,
        dayCount: 3,
        carryoverStops: [
          {
            stopId: "stop-0",
            orderId: "order-0",
            name: "Toko Melati",
            externalRef: "SO-1",
            dayIndex: 0,
            serviceDate: "2026-09-16",
            stopStatus: "pending",
          },
        ],
      }),
    ).filter((e: { payload: { reason?: string } }) => e.payload?.reason === "carryover");
    expect(ex).toHaveLength(1);
    expect(ex[0].kind).toBe("window_at_risk");
    expect(ex[0].severity).toBe("critical");
    expect(ex[0].stopId).toBe("stop-0");
    // Fingerprinted on the stop's own day so it does not re-open every day.
    expect(ex[0].fingerprint).toBe("window_at_risk:carryover:stop-0:2026-09-16");
  });

  it("raises nothing for a single-day job", () => {
    const ex = detectExceptionsFromSnapshot(
      snapshotWith({
        livePosition: { lat: -6.2, lon: 106.8, source: "phone", ageSec: 20 },
      }),
    ).filter((e: { payload: { reason?: string } }) => e.payload?.reason === "carryover");
    expect(ex).toHaveLength(0);
  });
});
