import { describe, expect, it } from "vitest";
import {
  computeSlaFromSnapshot,
  detectExceptionsFromSnapshot,
  isFrozenStopStatus,
  isRemainingStopStatus,
} from "../../server/dispatch-recovery.mjs";

describe("dispatch-recovery freeze helpers", () => {
  it("freezes done and skipped", () => {
    expect(isFrozenStopStatus("done")).toBe(true);
    expect(isFrozenStopStatus("skipped")).toBe(true);
    expect(isFrozenStopStatus("pending")).toBe(false);
    expect(isRemainingStopStatus("arrived")).toBe(true);
  });
});

describe("detectExceptionsFromSnapshot", () => {
  it("flags skipped stops as failed_skip", () => {
    const detected = detectExceptionsFromSnapshot({
      serviceDate: "2099-01-01",
      drivers: [
        {
          jobId: "11111111-1111-1111-1111-111111111111",
          jobStatus: "en_route",
          driverName: "A",
          doneCount: 0,
          startedAt: null,
          liveLat: 1,
          liveLon: 1,
          stops: [
            {
              stopId: "22222222-2222-2222-2222-222222222222",
              stopStatus: "skipped",
              status: "skipped",
              name: "Skip me",
              skipReason: "closed",
              orderId: null,
            },
          ],
        },
      ],
    });
    expect(detected.some((d) => d.kind === "failed_skip")).toBe(true);
  });
});

describe("computeSlaFromSnapshot", () => {
  it("computes OTP from completed stops with windows", () => {
    const sla = computeSlaFromSnapshot({
      serviceDate: "2026-01-01",
      summary: { delayed: 0 },
      exceptions: [],
      manifest: [
        {
          jobId: "j1",
          driverName: "D",
          status: "delivered",
          stopStatus: "done",
          windowEnd: "12:00",
          completedAt: "2026-01-01T04:00:00.000Z", // 11:00 WIB
          arrivedAt: null,
          plannedEta: "11:00",
        },
        {
          jobId: "j1",
          driverName: "D",
          status: "delivered",
          stopStatus: "done",
          windowEnd: "10:00",
          completedAt: "2026-01-01T04:30:00.000Z", // 11:30 WIB late
          arrivedAt: null,
          plannedEta: "10:30",
        },
      ],
    });
    expect(sla.withWindow).toBe(2);
    expect(sla.onTime).toBe(1);
    expect(sla.late).toBe(1);
    expect(sla.otpPct).toBe(50);
  });
});
