import { describe, expect, it } from "vitest";
import { jobIsClosed, nextDispatchTripTitle } from "../../server/dispatch-next-trip.mjs";
import { buildRouteUpdatedMessage } from "../../server/dispatch-notify.mjs";
import { dispatchJobIsClosed } from "./dispatch";

describe("nextDispatchTripTitle", () => {
  it("adds trip 2 to a first-run title", () => {
    expect(nextDispatchTripTitle("West loop")).toBe("West loop · trip 2");
  });

  it("increments an existing trip suffix", () => {
    expect(nextDispatchTripTitle("West loop · trip 2")).toBe("West loop · trip 3");
    expect(nextDispatchTripTitle("West loop · trip 9")).toBe("West loop · trip 10");
  });

  it("falls back when the title is empty", () => {
    expect(nextDispatchTripTitle("")).toBe("Dispatch job · trip 2");
    expect(nextDispatchTripTitle("   ")).toBe("Dispatch job · trip 2");
  });
});

describe("jobIsClosed", () => {
  it("treats done and cancelled as closed", () => {
    expect(jobIsClosed("done")).toBe(true);
    expect(jobIsClosed("cancelled")).toBe(true);
    expect(jobIsClosed("DONE")).toBe(true);
    expect(dispatchJobIsClosed("done")).toBe(true);
  });

  it("keeps open field statuses writable", () => {
    expect(jobIsClosed("draft")).toBe(false);
    expect(jobIsClosed("assigned")).toBe(false);
    expect(jobIsClosed("en_route")).toBe(false);
    expect(jobIsClosed("arrived")).toBe(false);
    expect(dispatchJobIsClosed("assigned")).toBe(false);
  });
});

describe("buildRouteUpdatedMessage", () => {
  it("names the new stops for an open job", () => {
    const text = buildRouteUpdatedMessage(
      { title: "West loop", serviceDate: "2026-09-27" },
      "demo",
      ["Toko A", "Toko B"],
    );
    expect(text).toContain("ARMADA M.1 · Route updated");
    expect(text).toContain("Job: West loop");
    expect(text).toContain("2 new stops added: Toko A, Toko B");
    expect(text).toContain("/m?k=demo");
  });

  it("caps a long add list", () => {
    const text = buildRouteUpdatedMessage({ title: "PM run" }, "t", [
      "A",
      "B",
      "C",
      "D",
      "E",
    ]);
    expect(text).toContain("5 new stops added: A, B, C, D +1 more");
  });
});
