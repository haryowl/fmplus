import { describe, expect, it } from "vitest";
import { formatDispatchWindow, normalizeClockHm } from "./dispatch";

describe("normalizeClockHm", () => {
  it("pads and keeps HH:MM", () => {
    expect(normalizeClockHm("8:00")).toBe("08:00");
    expect(normalizeClockHm("08:00")).toBe("08:00");
  });

  it("strips seconds from time inputs", () => {
    expect(normalizeClockHm("08:00:00")).toBe("08:00");
    expect(normalizeClockHm("17:30:00")).toBe("17:30");
  });

  it("clears empty and invalid values so Any time can null out the window", () => {
    expect(normalizeClockHm("")).toBe("");
    expect(normalizeClockHm(null)).toBe("");
    expect(normalizeClockHm("nope")).toBe("");
    expect(normalizeClockHm("25:00")).toBe("");
  });

  it("formats a pair for the order list", () => {
    expect(formatDispatchWindow({ windowStart: "8:00", windowEnd: "17:00:00" })).toBe(
      "08:00–17:00",
    );
    expect(formatDispatchWindow({ windowStart: "", windowEnd: "" })).toBe("");
  });
});
