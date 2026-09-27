import { describe, expect, it } from "vitest";
import { calendarDayDotTones } from "./dispatch";

describe("calendarDayDotTones", () => {
  it("returns no dots for an empty day", () => {
    expect(calendarDayDotTones({ pending: 0, inProgress: 0, completed: 0 })).toEqual([]);
  });

  it("uses one tone when a day is all the same status", () => {
    expect(calendarDayDotTones({ pending: 2, inProgress: 0, completed: 0 })).toEqual(["pending"]);
    expect(calendarDayDotTones({ pending: 0, inProgress: 1, completed: 0 })).toEqual(["progress"]);
    expect(calendarDayDotTones({ pending: 0, inProgress: 0, completed: 3 })).toEqual(["done"]);
  });

  it("shows every status present on a mixed day", () => {
    expect(calendarDayDotTones({ pending: 1, inProgress: 2, completed: 1 })).toEqual([
      "pending",
      "progress",
      "done",
    ]);
  });
});
