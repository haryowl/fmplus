import { describe, expect, it } from "vitest";
import {
  liveDriverCurrentStatus,
  shouldAutoCompleteJob,
  tourHasOpenStops,
} from "../../server/dispatch-job-complete.mjs";

describe("tourHasOpenStops", () => {
  it("is false when every stop is done or skipped", () => {
    expect(
      tourHasOpenStops([
        { status: "done" },
        { status: "skipped" },
        { status: "delivered" },
      ]),
    ).toBe(false);
  });

  it("is true when any stop is still open", () => {
    expect(tourHasOpenStops([{ status: "done" }, { status: "pending" }])).toBe(true);
    expect(tourHasOpenStops([{ status: "arrived" }])).toBe(true);
  });
});

describe("shouldAutoCompleteJob", () => {
  it("completes an in-progress job with no open stops", () => {
    expect(shouldAutoCompleteJob("en_route", [{ status: "done" }, { status: "done" }])).toBe(
      true,
    );
  });

  it("does not complete empty jobs or already-closed jobs", () => {
    expect(shouldAutoCompleteJob("en_route", [])).toBe(false);
    expect(shouldAutoCompleteJob("done", [{ status: "done" }])).toBe(false);
    expect(shouldAutoCompleteJob("assigned", [{ status: "pending" }])).toBe(false);
  });

  it("ignores missing volume or weight on the stops", () => {
    expect(
      shouldAutoCompleteJob("en_route", [
        { status: "done", volume_m3: null, weight_kg: null },
      ]),
    ).toBe(true);
  });
});

describe("liveDriverCurrentStatus", () => {
  it("stays with the current stop while one is open", () => {
    expect(liveDriverCurrentStatus("en_route", "in_transit", 1)).toBe("in_transit");
  });

  it("shows delivered when every stop is finished even if the job is still en_route", () => {
    expect(liveDriverCurrentStatus("en_route", null, 0)).toBe("delivered");
    expect(liveDriverCurrentStatus("done", undefined, 0)).toBe("delivered");
  });

  it("shows pending only when the route has not started and work remains", () => {
    expect(liveDriverCurrentStatus("assigned", null, 2)).toBe("pending");
  });
});
