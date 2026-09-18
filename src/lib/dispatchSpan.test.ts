import { describe, expect, it } from "vitest";
import {
  clampDayIndex,
  dateForDayIndex,
  dayIndexForDate,
  MAX_DAY_INDEX,
  spanDayCount,
} from "../../server/dispatch-span.mjs";

describe("spanDayCount", () => {
  it("treats a null end date as single-day", () => {
    expect(spanDayCount("2026-09-17", null)).toBe(1);
    expect(spanDayCount("2026-09-17", "")).toBe(1);
  });

  it("counts both endpoints", () => {
    expect(spanDayCount("2026-09-17", "2026-09-17")).toBe(1);
    expect(spanDayCount("2026-09-17", "2026-09-19")).toBe(3);
  });

  it("spans a month boundary", () => {
    expect(spanDayCount("2026-09-30", "2026-10-02")).toBe(3);
  });

  it("never goes below 1, even with a bad end date", () => {
    expect(spanDayCount("2026-09-17", "2026-09-15")).toBe(1);
  });
});

describe("dayIndexForDate", () => {
  it("maps each day of a 3-day tour", () => {
    expect(dayIndexForDate("2026-09-17", "2026-09-19", "2026-09-17")).toBe(0);
    expect(dayIndexForDate("2026-09-17", "2026-09-19", "2026-09-18")).toBe(1);
    expect(dayIndexForDate("2026-09-17", "2026-09-19", "2026-09-19")).toBe(2);
  });

  it("rejects dates outside the span", () => {
    expect(dayIndexForDate("2026-09-17", "2026-09-19", "2026-09-16")).toBeNull();
    expect(dayIndexForDate("2026-09-17", "2026-09-19", "2026-09-20")).toBeNull();
  });

  it("only accepts the exact date for a single-day job", () => {
    expect(dayIndexForDate("2026-09-17", null, "2026-09-17")).toBe(0);
    expect(dayIndexForDate("2026-09-17", null, "2026-09-18")).toBeNull();
  });

  it("handles a node-pg Date for the job columns", () => {
    expect(dayIndexForDate(new Date(2026, 8, 17), new Date(2026, 8, 19), "2026-09-18")).toBe(1);
  });
});

describe("dateForDayIndex", () => {
  it("resolves a stop's calendar date", () => {
    expect(dateForDayIndex("2026-09-17", 0)).toBe("2026-09-17");
    expect(dateForDayIndex("2026-09-17", 2)).toBe("2026-09-19");
  });

  it("crosses a year boundary", () => {
    expect(dateForDayIndex("2026-12-30", 3)).toBe("2027-01-02");
  });
});

describe("clampDayIndex", () => {
  it("defaults anything unusable to day 0", () => {
    expect(clampDayIndex(undefined)).toBe(0);
    expect(clampDayIndex(null)).toBe(0);
    expect(clampDayIndex("nope")).toBe(0);
    expect(clampDayIndex(-4)).toBe(0);
  });

  it("caps at the schema limit and truncates fractions", () => {
    expect(clampDayIndex(99)).toBe(MAX_DAY_INDEX);
    expect(clampDayIndex(2.7)).toBe(2);
    expect(clampDayIndex("3")).toBe(3);
  });
});
