import { describe, expect, it } from "vitest";
import { canTransition, serviceDurationMinutes } from "../../server/maintenance-lifecycle.mjs";

describe("maintenance work-order lifecycle", () => {
  it("requires Start before Done", () => {
    expect(canTransition("due", "done")).toBe(false);
    expect(canTransition("due", "in_progress")).toBe(true);
    expect(canTransition("in_progress", "done")).toBe(true);
  });

  it("allows canceling Start before Done", () => {
    expect(canTransition("in_progress", "due")).toBe(true);
  });

  it("allows Skip without Start, and manager Reopen after Done", () => {
    expect(canTransition("due", "skipped")).toBe(true);
    expect(canTransition("in_progress", "skipped")).toBe(true);
    expect(canTransition("done", "due")).toBe(true);
    expect(canTransition("skipped", "due")).toBe(true);
  });

  it("computes service duration in minutes", () => {
    expect(
      serviceDurationMinutes("2026-09-06T10:00:00.000Z", "2026-09-06T11:30:00.000Z"),
    ).toBe(90);
    expect(serviceDurationMinutes(null, "2026-09-06T11:30:00.000Z")).toBe(null);
  });
});
