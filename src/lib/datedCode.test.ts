import { describe, expect, it } from "vitest";
import { dateStampDDMMYYYY, nextDatedCode } from "./datedCode";

describe("nextDatedCode", () => {
  it("stamps the day as DDMMYYYY and starts at 01", () => {
    expect(dateStampDDMMYYYY("2026-10-04")).toBe("04102026");
    expect(nextDatedCode("ORD", "2026-10-04", [])).toBe("ORD-04102026-01");
    expect(nextDatedCode("JOB", "2026-10-04", ["Van B 02"])).toBe("JOB-04102026-01");
  });

  it("continues after the highest number for that day", () => {
    expect(
      nextDatedCode("ORD", "2026-10-04", ["ORD-04102026-01", "ORD-03102026-09", "custom", "ORD-04102026-04"]),
    ).toBe("ORD-04102026-05");
  });
});
