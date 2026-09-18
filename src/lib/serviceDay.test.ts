import { describe, expect, it } from "vitest";
import {
  dayDiff,
  formatClockAt,
  formatServiceDateLabel,
  minutesSinceServiceMidnight,
  parseServiceDate,
  serviceDateAt,
  shiftServiceDate,
  todayServiceDate,
} from "./serviceDay";
import {
  addDays as serverAddDays,
  dayDiff as serverDayDiff,
  formatServiceDate as serverFormatServiceDate,
  minutesSinceServiceMidnight as serverMinutesSince,
  todayServiceDate as serverToday,
} from "../../server/service-day.mjs";

describe("todayServiceDate (Asia/Jakarta)", () => {
  it("keeps the WIB day just before midnight", () => {
    // 16:30Z is 23:30 WIB on the 17th.
    expect(todayServiceDate(new Date("2026-09-17T16:30:00Z"))).toBe("2026-09-17");
  });

  it("rolls to the next WIB day after 17:00Z", () => {
    // 17:30Z is 00:30 WIB on the 18th.
    expect(todayServiceDate(new Date("2026-09-17T17:30:00Z"))).toBe("2026-09-18");
  });

  it("matches the server helper exactly", () => {
    const probe = new Date("2026-09-17T17:30:00Z");
    expect(todayServiceDate(probe)).toBe(serverToday(probe));
  });
});

describe("shiftServiceDate", () => {
  it("rolls over months", () => {
    expect(shiftServiceDate("2026-09-30", 1)).toBe("2026-10-01");
  });

  it("rolls over years backwards", () => {
    expect(shiftServiceDate("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("handles leap day", () => {
    expect(shiftServiceDate("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftServiceDate("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("agrees with the server addDays", () => {
    expect(shiftServiceDate("2026-12-31", 3)).toBe(serverAddDays("2026-12-31", 3));
  });
});

describe("dayDiff", () => {
  it("counts whole days in both directions", () => {
    expect(dayDiff("2026-09-17", "2026-09-20")).toBe(3);
    expect(dayDiff("2026-09-20", "2026-09-17")).toBe(-3);
    expect(dayDiff("2026-09-17", "2026-09-17")).toBe(0);
  });

  it("spans a year boundary", () => {
    expect(dayDiff("2025-12-30", "2026-01-02")).toBe(3);
    expect(serverDayDiff("2025-12-30", "2026-01-02")).toBe(3);
  });

  it("returns null for garbage", () => {
    expect(dayDiff("nope", "2026-09-17")).toBeNull();
  });
});

describe("parseServiceDate", () => {
  it("accepts a plain date and trims a timestamp", () => {
    expect(parseServiceDate("2026-09-17")).toBe("2026-09-17");
    expect(parseServiceDate("2026-09-17T08:00:00Z")).toBe("2026-09-17");
  });

  it("rejects impossible calendar dates", () => {
    expect(parseServiceDate("2026-02-30")).toBeNull();
    expect(parseServiceDate("2026-13-01")).toBeNull();
    expect(parseServiceDate("")).toBeNull();
  });
});

describe("clock helpers", () => {
  it("formats WIB wall clock", () => {
    expect(formatClockAt("2026-09-17T04:00:00Z")).toBe("11:00");
  });

  it("resolves the WIB calendar day of a timestamp", () => {
    expect(serviceDateAt("2026-09-17T17:30:00Z")).toBe("2026-09-18");
  });
});

describe("minutesSinceServiceMidnight", () => {
  it("returns clock minutes within the anchor day", () => {
    expect(minutesSinceServiceMidnight("2026-09-17T04:00:00Z", "2026-09-17")).toBe(660);
  });

  it("keeps overnight work past 1440 instead of wrapping", () => {
    // 00:20 WIB on the 18th, still belonging to the 17th service day.
    expect(minutesSinceServiceMidnight("2026-09-17T17:20:00Z", "2026-09-17")).toBe(1460);
  });

  it("treats 00:20 WIB as belonging to the anchor day it falls in", () => {
    // 2026-09-16T17:20Z is 00:20 WIB on the 17th, so it is minute 20 of the 17th.
    expect(minutesSinceServiceMidnight("2026-09-16T17:20:00Z", "2026-09-17")).toBe(20);
  });

  it("goes negative for work a day before the anchor", () => {
    // 00:20 WIB on the 16th, one day before the anchor.
    expect(minutesSinceServiceMidnight("2026-09-15T17:20:00Z", "2026-09-17")).toBe(-1420);
  });

  it("falls back to plain clock minutes without an anchor", () => {
    expect(minutesSinceServiceMidnight("2026-09-17T17:20:00Z", null)).toBe(20);
  });

  it("matches the server helper", () => {
    expect(minutesSinceServiceMidnight("2026-09-17T17:20:00Z", "2026-09-17")).toBe(
      serverMinutesSince("2026-09-17T17:20:00Z", "2026-09-17"),
    );
  });
});

describe("formatServiceDateLabel", () => {
  it("labels the calendar date itself, not a local moment", () => {
    expect(formatServiceDateLabel("2026-09-17")).toContain("Thu");
  });

  it("passes through unparseable input", () => {
    expect(formatServiceDateLabel("not-a-date")).toBe("not-a-date");
  });
});

describe("server formatServiceDate", () => {
  it("reverses a node-pg local-midnight DATE without shifting", () => {
    expect(serverFormatServiceDate(new Date(2026, 8, 17))).toBe("2026-09-17");
  });

  it("takes the date part of a string", () => {
    expect(serverFormatServiceDate("2026-09-17T00:00:00.000Z")).toBe("2026-09-17");
    expect(serverFormatServiceDate("")).toBe("");
  });
});
