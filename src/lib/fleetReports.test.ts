import { describe, expect, it } from "vitest";
import {
  categorizeReportColumn,
  formatReportBytes,
  parseReportEmails,
} from "./fleetReports";
import {
  normalizeReportSpec,
  reportToCsv,
  resolveReportRange,
} from "../../server/fleet-reports.mjs";

describe("categorizeReportColumn", () => {
  it("groups cooked and mapped keys", () => {
    expect(categorizeReportColumn("device")).toBe("essential");
    expect(categorizeReportColumn("heading")).toBe("location");
    expect(categorizeReportColumn("mapped.speed.gps")).toBe("location");
    expect(categorizeReportColumn("mapped.battery_voltage")).toBe("power");
    expect(categorizeReportColumn("mapped.din13")).toBe("io");
    expect(categorizeReportColumn("mapped.gps.valid")).toBe("gnss");
    expect(categorizeReportColumn("protocol")).toBe("system");
  });
});

describe("parseReportEmails / formatReportBytes", () => {
  it("tokenizes emails and formats size", () => {
    expect(parseReportEmails("ops@example.com, night@example.com")).toEqual([
      "ops@example.com",
      "night@example.com",
    ]);
    expect(formatReportBytes(4.2 * 1024 * 1024)).toBe("4.2 MB");
  });
});

describe("normalizeReportSpec", () => {
  it("defaults Device Source fixes columns", () => {
    const spec = normalizeReportSpec({});
    expect(spec.grain).toBe("fixes");
    expect(spec.rangeKind).toBe("last7");
    expect(spec.columns).toEqual(["device", "recorded_at", "lat", "lon", "speed", "ignition"]);
  });

  it("drops unknown columns and mapped keys without prefix", () => {
    const spec = normalizeReportSpec({
      grain: "fixes",
      columns: ["device", "dropme", "mapped.fuel_level", "mapped."],
    });
    expect(spec.columns).toEqual(["device", "mapped.fuel_level"]);
  });

  it("keeps Device Source filters including mapped keys", () => {
    const spec = normalizeReportSpec({
      filters: [
        { field: "speed", cmp: ">", value: 80 },
        { field: "mapped.fuel_level", cmp: "<", value: 20 },
        { field: "", cmp: "==", value: 1 },
      ],
    });
    expect(spec.filters).toEqual([
      { field: "speed", cmp: ">", value: 80 },
      { field: "mapped.fuel_level", cmp: "<", value: 20 },
    ]);
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
