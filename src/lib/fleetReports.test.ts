import { describe, expect, it } from "vitest";
import {
  normalizeReportSpec,
  reportToCsv,
  resolveReportRange,
} from "../../server/fleet-reports.mjs";

describe("normalizeReportSpec", () => {
  it("defaults Device Source fixes columns", () => {
    const spec = normalizeReportSpec({});
    expect(spec.grain).toBe("fixes");
    expect(spec.rangeKind).toBe("today");
    expect(spec.columns).toEqual(["device", "recorded_at", "lat", "lon", "speed", "ignition"]);
  });

  it("drops unknown columns and mapped keys without prefix", () => {
    const spec = normalizeReportSpec({
      grain: "fixes",
      columns: ["device", "dropme", "mapped.fuel_level", "mapped."],
    });
    expect(spec.columns).toEqual(["device", "mapped.fuel_level"]);
  });
});

describe("resolveReportRange", () => {
  it("resolves today and last7 in the given offset", () => {
    const now = Date.parse("2026-10-24T12:00:00Z");
    const today = resolveReportRange({ rangeKind: "today", timezone: "+00:00" }, now);
    expect(today).toEqual({ from: "2026-10-24", to: "2026-10-24", timezone: "+00:00" });
    const week = resolveReportRange({ rangeKind: "last7", timezone: "+00:00" }, now);
    expect(week.from).toBe("2026-10-18");
    expect(week.to).toBe("2026-10-24");
  });
});

describe("reportToCsv", () => {
  it("quotes commas", () => {
    expect(reportToCsv(["A"], [["x,y"]])).toBe('A\n"x,y"\n');
  });
});
