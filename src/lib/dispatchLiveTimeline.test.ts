import { describe, expect, it } from "vitest";
import {
  buildTimelineAxis,
  buildTimelineRows,
  fillSequenceMinutes,
  hmToMin,
  minToHm,
  minuteToPct,
} from "./dispatchLiveTimeline";

describe("hmToMin / minToHm", () => {
  it("parses and formats clock times", () => {
    expect(hmToMin("07:30")).toBe(450);
    expect(hmToMin("18:00")).toBe(1080);
    expect(hmToMin("bad")).toBeNull();
    expect(minToHm(450)).toBe("07:30");
  });
});

describe("minuteToPct", () => {
  it("maps within the axis", () => {
    expect(minuteToPct(420, 420, 1080)).toBe(0);
    expect(minuteToPct(1080, 420, 1080)).toBe(100);
    expect(minuteToPct(750, 420, 1080)).toBeCloseTo(50, 5);
  });
});

describe("fillSequenceMinutes", () => {
  it("spreads when nothing is known", () => {
    expect(fillSequenceMinutes([{ minute: null }, { minute: null }, { minute: null }], 420, 1080)).toEqual([
      420, 750, 1080,
    ]);
  });

  it("interpolates gaps between known points", () => {
    expect(
      fillSequenceMinutes([{ minute: 480 }, { minute: null }, { minute: 600 }], 420, 1080),
    ).toEqual([480, 540, 600]);
  });
});

describe("buildTimelineAxis", () => {
  it("defaults to 07–18 and expands for outliers", () => {
    const axis = buildTimelineAxis([500, 700]);
    expect(axis.startMin).toBeLessThanOrEqual(420);
    expect(axis.endMin).toBeGreaterThanOrEqual(1080);
    expect(axis.ticks[0]).toBe(axis.startMin);
  });

  it("places now marker", () => {
    const axis = buildTimelineAxis([500], { nowMin: 600 });
    expect(axis.nowPct).not.toBeNull();
    expect(axis.nowPct!).toBeGreaterThan(0);
  });
});

describe("buildTimelineRows", () => {
  it("places actual times ahead of windows and fills sequence", () => {
    const { axis, rows } = buildTimelineRows([
      {
        jobId: "j1",
        driverName: "Ada",
        driverInitials: "AD",
        vehicleLabel: "B 1",
        pctComplete: 50,
        jobStatus: "en_route",
        stops: [
          {
            stopId: "s1",
            jobId: "j1",
            stopNumber: 1,
            name: "A",
            externalRef: "ORD-1",
            status: "delivered",
            completedAt: "2026-09-12T01:00:00.000Z", // 08:00 WIB
            windowStart: "07:00",
            windowEnd: "09:00",
            timeLabel: "08:00",
          },
          {
            stopId: "s2",
            jobId: "j1",
            stopNumber: 2,
            name: "B",
            status: "pending",
            windowStart: "10:00",
            windowEnd: "11:00",
          },
          {
            stopId: "s3",
            jobId: "j1",
            stopNumber: 3,
            name: "C",
            status: "pending",
          },
        ],
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.nodes).toHaveLength(3);
    expect(rows[0]!.nodes[0]!.timeSource).toBe("actual");
    expect(rows[0]!.nodes[0]!.minute).toBe(8 * 60);
    expect(rows[0]!.nodes[1]!.timeSource).toBe("window");
    expect(rows[0]!.nodes[1]!.minute).toBe(10 * 60 + 30);
    expect(rows[0]!.nodes[2]!.timeSource).toBe("sequence");
    expect(rows[0]!.nodes[2]!.minute).toBeGreaterThan(rows[0]!.nodes[1]!.minute);
    expect(axis.ticks.length).toBeGreaterThan(2);
    expect(rows[0]!.nodes[0]!.pct).toBeGreaterThanOrEqual(0);
    expect(rows[0]!.nodes[0]!.pct).toBeLessThanOrEqual(100);
  });

  it("adds depot start and return nodes when anchors exist", () => {
    const { rows } = buildTimelineRows([
      {
        jobId: "j2",
        driverName: "Bea",
        driverInitials: "BE",
        vehicleLabel: "B 2",
        pctComplete: 0,
        jobStatus: "assigned",
        routeAnchorMode: "sequence",
        routeStart: { label: "Depot", lat: -6.2, lon: 106.8 },
        routeEnd: { label: "Return Depot", lat: -6.2, lon: 106.8 },
        startedAt: "2026-09-12T00:00:00.000Z", // 07:00 WIB
        stops: [
          {
            stopId: "s1",
            jobId: "j2",
            stopNumber: 1,
            name: "A",
            status: "pending",
            windowStart: "08:00",
            windowEnd: "09:00",
          },
        ],
      },
    ]);
    const nodes = rows[0]!.nodes;
    expect(nodes).toHaveLength(3);
    expect(nodes[0]!.role).toBe("depot");
    expect(nodes[0]!.minute).toBe(7 * 60);
    expect(nodes[1]!.role).toBe("stop");
    expect(nodes[2]!.role).toBe("return");
    expect(nodes[2]!.minute).toBeGreaterThan(nodes[1]!.minute);
  });

  it("prefers planned ETA over window midpoint when not started", () => {
    const { rows } = buildTimelineRows([
      {
        jobId: "j3",
        driverName: "Cat",
        driverInitials: "CA",
        vehicleLabel: "B 3",
        pctComplete: 0,
        jobStatus: "assigned",
        routeAnchorMode: "sequence",
        routeStart: { label: "Depot" },
        routeEnd: { label: "Return" },
        plannedDepotDepart: "08:00",
        plannedReturnEta: "09:27",
        stops: [
          {
            stopId: "s1",
            jobId: "j3",
            stopNumber: 1,
            name: "A",
            status: "pending",
            windowStart: "08:00",
            windowEnd: "17:00",
            plannedEta: "08:03",
          },
          {
            stopId: "s2",
            jobId: "j3",
            stopNumber: 2,
            name: "B",
            status: "pending",
            windowStart: "08:00",
            windowEnd: "17:00",
            plannedEta: "08:14",
          },
        ],
      },
    ]);
    const nodes = rows[0]!.nodes;
    expect(nodes.map((n) => n.role)).toEqual(["depot", "stop", "stop", "return"]);
    expect(nodes[0]!.timeSource).toBe("planned");
    expect(nodes[0]!.minute).toBe(8 * 60);
    expect(nodes[1]!.timeSource).toBe("planned");
    expect(nodes[1]!.minute).toBe(8 * 60 + 3);
    expect(nodes[2]!.minute).toBe(8 * 60 + 14);
    expect(nodes[3]!.minute).toBe(9 * 60 + 27);
  });
});
