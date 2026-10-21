import { describe, expect, it } from "vitest";
import { formatCoord, formatDms, formatDistance, formatSpeedValue, kmToDisplay } from "./units";

describe("units", () => {
  it("converts km to nautical miles", () => {
    expect(kmToDisplay(1.852, "nautical")).toBeCloseTo(1, 6);
    expect(kmToDisplay(10, "metric")).toBe(10);
  });

  it("formats distance and speed with units", () => {
    expect(formatDistance(10, "metric")).toBe("10.0 km");
    expect(formatDistance(1.852, "nautical")).toBe("1.0 NM");
    expect(formatSpeedValue(18.52, "nautical")).toBe("10.0 kn");
  });

  it("formats DMS coordinates", () => {
    expect(formatDms(-4.209222, "lat")).toMatch(/S$/);
    expect(formatDms(122.503333, "lon")).toMatch(/E$/);
    expect(formatCoord(-4.209222, 122.503333, "nautical")).toContain("S");
    expect(formatCoord(-6.2, 106.8, "metric")).toBe("-6.20000, 106.80000");
  });
});
