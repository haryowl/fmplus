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
});
