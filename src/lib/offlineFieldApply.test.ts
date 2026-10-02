import { describe, expect, it } from "vitest";
import {
  applyOfflineWrite,
  emptyOfflineSnap,
  offlineCatalogScan,
  readOfflineGet,
  rememberOfflineGet,
} from "./offlineFieldApply";

describe("offline field snapshot", () => {
  it("serves a saved dispatch day when the network is gone", () => {
    const saved = rememberOfflineGet(
      emptyOfflineSnap(),
      "/api/field/dispatch/jobs?date=2026-10-02",
      {
        jobs: [{ id: "job-1", status: "assigned", stops: [{ id: "stop-1", status: "pending" }] }],
        serviceDate: "2026-10-02",
      },
      "2026-10-02T01:00:00.000Z",
    );
    expect(readOfflineGet(saved, "/api/field/dispatch/jobs?date=2026-10-02")?.json).toMatchObject({
      serviceDate: "2026-10-02",
    });
    expect(readOfflineGet(saved, "/api/field/dispatch/jobs?date=2026-10-03")).toBeNull();
  });

  it("applies start and finish on the saved job immediately", () => {
    const saved = rememberOfflineGet(
      emptyOfflineSnap(),
      "/api/field/dispatch/jobs?date=2026-10-02",
      {
        jobs: [
          {
            id: "job-1",
            status: "assigned",
            stops: [{ id: "stop-1", status: "pending", orderId: "order-1" }],
          },
        ],
        serviceDate: "2026-10-02",
      },
      "2026-10-02T01:00:00.000Z",
    );
    const started = applyOfflineWrite(
      saved,
      "PATCH",
      "/api/field/dispatch/jobs/job-1",
      { status: "en_route" },
      "2026-10-02T02:00:00.000Z",
    );
    expect("error" in started).toBe(false);
    if ("error" in started) return;
    const finished = applyOfflineWrite(
      started.snap,
      "PATCH",
      "/api/field/dispatch/jobs/job-1/stops/stop-1",
      { status: "done" },
      "2026-10-02T03:00:00.000Z",
    );
    expect("error" in finished).toBe(false);
    if ("error" in finished) return;
    const again = readOfflineGet(finished.snap, "/api/field/dispatch/jobs?date=2026-10-02");
    const jobs = (again?.json as { jobs: Array<{ status: string; stops: Array<{ status: string }> }> }).jobs;
    expect(jobs[0]?.status).toBe("done");
    expect(jobs[0]?.stops[0]?.status).toBe("done");
  });

  it("keeps a maintenance status change on the saved event", () => {
    const saved = rememberOfflineGet(
      emptyOfflineSnap(),
      "/api/field/maintenance/events",
      { events: [{ id: "ev-1", status: "due", notes: "" }] },
      "2026-10-02T01:00:00.000Z",
    );
    const patched = applyOfflineWrite(
      saved,
      "PATCH",
      "/api/field/maintenance/events/ev-1",
      { status: "in_progress", notes: "Started on site" },
      "2026-10-02T02:00:00.000Z",
    );
    expect("error" in patched).toBe(false);
    if ("error" in patched) return;
    const detail = readOfflineGet(patched.snap, "/api/field/maintenance/events/ev-1");
    expect(detail?.json).toMatchObject({
      event: { status: "in_progress", notes: "Started on site" },
    });
  });

  it("matches a saved goods SKU without calling the server", () => {
    const saved = rememberOfflineGet(
      emptyOfflineSnap(),
      "/api/field/dispatch/goods",
      { items: [{ id: "g1", name: "Oil", sku: "OIL-01", enabled: true }] },
      "2026-10-02T01:00:00.000Z",
    );
    const hit = offlineCatalogScan(saved, "am1:v1:goods:OIL-01", "dispatch_cargo");
    expect(hit.json).toMatchObject({ match: "goods", item: { sku: "OIL-01" } });
  });
});
