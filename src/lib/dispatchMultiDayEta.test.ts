import { describe, expect, it } from "vitest";
import { buildStopRouteMeta } from "../../server/stop-route-meta.mjs";
import { computeSlaFromSnapshot } from "../../server/dispatch-recovery.mjs";
import { buildTimelineRows, isoToJakartaMin, minToHm } from "./dispatchLiveTimeline";

describe("buildStopRouteMeta per day", () => {
  // 30-minute hops all round.
  const sameDayLegs = [
    { distanceKm: 10, durationSec: 1800 },
    { distanceKm: 12, durationSec: 1800 },
    { distanceKm: 8, durationSec: 1800 },
  ];

  // Stops 0-1 on day 1, stops 2-3 on day 2, so the second leg spans the night.
  const legs = [
    { distanceKm: 10, durationSec: 1800 },
    { distanceKm: 300, durationSec: 6 * 3600 }, // overnight repositioning
    { distanceKm: 12, durationSec: 1800 },
    { distanceKm: 8, durationSec: 1800 },
  ];

  it("chains a single-day tour continuously", () => {
    const meta = buildStopRouteMeta(
      [
        { windowStart: "08:00", serviceMinutes: 10 },
        { windowStart: "", serviceMinutes: 10 },
        { windowStart: "", serviceMinutes: 10 },
      ],
      sameDayLegs,
    );
    expect(meta.stops.map((s: { eta: string }) => s.eta)).toEqual(["08:00", "08:40", "09:20"]);
  });

  it("restarts the chain on each day instead of carrying travel over the rest", () => {
    const meta = buildStopRouteMeta(
      [
        { windowStart: "08:00", serviceMinutes: 10, dayIndex: 0 },
        { windowStart: "", serviceMinutes: 10, dayIndex: 0 },
        { windowStart: "07:00", serviceMinutes: 10, dayIndex: 1 },
        { windowStart: "", serviceMinutes: 10, dayIndex: 1 },
      ],
      legs,
    );
    const etas = meta.stops.map((s: { eta: string }) => s.eta);
    expect(etas).toEqual(["08:00", "08:40", "07:00", "07:40"]);
  });

  it("reports no inbound leg for a day's first stop, since that gap is rest", () => {
    const meta = buildStopRouteMeta(
      [
        { windowStart: "08:00", serviceMinutes: 10, dayIndex: 0 },
        { windowStart: "", serviceMinutes: 10, dayIndex: 0 },
        { windowStart: "07:00", serviceMinutes: 10, dayIndex: 1 },
      ],
      legs,
    );
    expect(meta.stops[1].legDurationSec).toBe(1800);
    expect(meta.stops[2].legDurationSec).toBeNull();
    expect(meta.stops[2].legDistanceKm).toBeNull();
  });

  it("falls back to 08:00 for a day with no declared window", () => {
    const meta = buildStopRouteMeta(
      [
        { windowStart: "06:00", serviceMinutes: 10, dayIndex: 0 },
        { windowStart: "", serviceMinutes: 10, dayIndex: 1 },
      ],
      legs,
    );
    expect(meta.stops.map((s: { eta: string }) => s.eta)).toEqual(["06:00", "08:00"]);
  });

  it("tags each meta with its day", () => {
    const meta = buildStopRouteMeta(
      [
        { windowStart: "08:00", serviceMinutes: 10, dayIndex: 0 },
        { windowStart: "07:00", serviceMinutes: 10, dayIndex: 2 },
      ],
      legs,
    );
    expect(meta.stops.map((s: { dayIndex: number }) => s.dayIndex)).toEqual([0, 2]);
  });
});

describe("timeline day anchoring", () => {
  it("puts a post-midnight completion past the end of its own day", () => {
    // 17:20Z is 00:20 WIB on the 18th, which is minute 1460 of the 17th.
    expect(isoToJakartaMin("2026-09-17T17:20:00Z", "2026-09-17")).toBe(1460);
  });

  it("wraps the label for a minute past midnight", () => {
    expect(minToHm(1460)).toBe("00:20");
    expect(minToHm(450)).toBe("07:30");
  });

  it("reads overnight completion as late, not as a day early", () => {
    const { rows } = buildTimelineRows(
      [
        {
          jobId: "job-1",
          driverName: "Budi",
          driverInitials: "B",
          vehicleLabel: "B 1 XY",
          pctComplete: 100,
          jobStatus: "done",
          stops: [
            {
              stopId: "stop-1",
              jobId: "job-1",
              stopNumber: 1,
              name: "Customer A",
              status: "delivered",
              plannedEta: "17:00",
              completedAt: "2026-09-17T17:20:00Z", // 00:20 WIB on the 18th
              serviceDate: "2026-09-17",
            },
          ],
        },
      ],
      { anchorYmd: "2026-09-17" },
    );
    const node = rows[0].nodes[0];
    expect(node.actualMinute).toBe(1460);
    expect(node.plannedMinute).toBe(1020);
    // 7h20m late, not ~1000 minutes early.
    expect(node.deltaMin).toBe(440);
  });

  it("offsets a later day of a tour onto its own stretch of the axis", () => {
    const { rows } = buildTimelineRows(
      [
        {
          jobId: "job-1",
          driverName: "Budi",
          driverInitials: "B",
          vehicleLabel: "B 1 XY",
          pctComplete: 0,
          jobStatus: "assigned",
          stops: [
            {
              stopId: "d2",
              jobId: "job-1",
              stopNumber: 1,
              name: "Day 2 stop",
              status: "pending",
              plannedEta: "09:00",
              serviceDate: "2026-09-18",
            },
          ],
        },
      ],
      { anchorYmd: "2026-09-17" },
    );
    expect(rows[0].nodes[0].plannedMinute).toBe(1440 + 540);
  });

  it("ignores day offsets when no anchor is given", () => {
    const { rows } = buildTimelineRows([
      {
        jobId: "job-1",
        driverName: "Budi",
        driverInitials: "B",
        vehicleLabel: "B 1 XY",
        pctComplete: 0,
        jobStatus: "assigned",
        stops: [
          {
            stopId: "d2",
            jobId: "job-1",
            stopNumber: 1,
            name: "Stop",
            status: "pending",
            plannedEta: "09:00",
            serviceDate: "2026-09-18",
          },
        ],
      },
    ]);
    expect(rows[0].nodes[0].plannedMinute).toBe(540);
  });
});

describe("computeSlaFromSnapshot per day", () => {
  function snapshot(rows: Array<Record<string, unknown>>) {
    return { serviceDate: "2026-09-17", manifest: rows, summary: {}, exceptions: [] };
  }

  it("scores an overnight completion as late", () => {
    const sla = computeSlaFromSnapshot(
      snapshot([
        {
          jobId: "job-1",
          driverName: "Budi",
          status: "delivered",
          stopStatus: "done",
          windowEnd: "17:00",
          plannedEta: "16:30",
          completedAt: "2026-09-17T17:20:00Z", // 00:20 WIB on the 18th
          serviceDate: "2026-09-17",
        },
      ]),
    );
    expect(sla.withWindow).toBe(1);
    expect(sla.late).toBe(1);
    expect(sla.onTime).toBe(0);
    expect(sla.otpPct).toBe(0);
  });

  it("still scores an in-window completion as on time", () => {
    const sla = computeSlaFromSnapshot(
      snapshot([
        {
          jobId: "job-1",
          driverName: "Budi",
          status: "delivered",
          stopStatus: "done",
          windowEnd: "17:00",
          plannedEta: "16:30",
          completedAt: "2026-09-17T09:30:00Z", // 16:30 WIB
          serviceDate: "2026-09-17",
        },
      ]),
    );
    expect(sla.onTime).toBe(1);
    expect(sla.late).toBe(0);
    expect(sla.otpPct).toBe(100);
  });

  it("credits a day-2 stop against its own day", () => {
    const sla = computeSlaFromSnapshot(
      snapshot([
        {
          jobId: "job-1",
          driverName: "Budi",
          status: "delivered",
          stopStatus: "done",
          windowEnd: "17:00",
          plannedEta: "16:30",
          completedAt: "2026-09-18T09:30:00Z", // 16:30 WIB on the 18th
          serviceDate: "2026-09-18",
        },
      ]),
    );
    expect(sla.onTime).toBe(1);
    expect(sla.late).toBe(0);
  });
});
