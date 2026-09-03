import { describe, expect, it } from "vitest";
import {
  ageLabel,
  filterStatusRows,
  normalizeUserStatus,
  normalizeUserStatusList,
  sortStatusRows,
  statusCsv,
} from "./lastStatus";

describe("normalizeUserStatus", () => {
  it("maps GpsGate uTC, array variables, and position", () => {
    const row = normalizeUserStatus({
      id: 12,
      name: "DT-01",
      username: "dt01",
      uTC: "2026-09-02T04:00:00Z",
      deviceActivity: "2026-09-02T04:01:00Z",
      position: { latitude: -6.2, longitude: 106.8, altitude: 12 },
      velocity: { groundSpeed: 42, heading: 90 },
      variables: [
        { name: "ignition", value: "True", time: "2026-09-02T04:00:00Z" },
        { name: "speed", value: "5", time: "2026-09-02T04:00:00Z" },
        { name: "fuel level", value: "48.2", time: "2026-09-02T04:00:00Z" },
        { name: "odometerAcc", value: "12345000", time: "2026-09-02T04:00:00Z" },
      ],
    });
    expect(row).toMatchObject({
      id: 12,
      name: "DT-01",
      utc: "2026-09-02T04:00:00Z",
      lastMs: Date.parse("2026-09-02T04:01:00Z"),
      lat: -6.2,
      lon: 106.8,
      heading: 90,
      ignition: true,
      speedKmh: 18,
      fuelLevel: 48.2,
      odometerKm: 12345,
    });
  });

  it("drops rows without a user id", () => {
    expect(normalizeUserStatus({ name: "x" })).toBeNull();
  });

  it("treats 0,0 as no position", () => {
    const row = normalizeUserStatus({
      id: 1,
      name: "office",
      position: { latitude: 0, longitude: 0 },
    });
    expect(row?.lat).toBeNull();
    expect(row?.lon).toBeNull();
  });

  it("unwraps { items } lists", () => {
    expect(normalizeUserStatusList({ items: [{ id: 1, name: "A" }] })).toHaveLength(1);
  });
});

describe("filter and sort", () => {
  const rows = [
    normalizeUserStatus({ id: 2, name: "B", uTC: "2026-09-02T02:00:00Z" })!,
    normalizeUserStatus({ id: 1, name: "A", uTC: "2026-09-02T03:00:00Z" })!,
  ];

  it("keeps only allowed user ids", () => {
    expect(filterStatusRows(rows, [1]).map((r) => r.id)).toEqual([1]);
  });

  it("sorts newest last-seen first", () => {
    const sorted = sortStatusRows(rows, "lastMs", "desc");
    expect(sorted.map((r) => r.id)).toEqual([1, 2]);
  });
});

describe("excel csv", () => {
  it("writes a BOM so Excel opens UTF-8 names", () => {
    const row = normalizeUserStatus({
      id: 9,
      name: "Truk, \"A\"",
      uTC: "2026-09-02T00:00:00Z",
    })!;
    const csv = statusCsv([row], "+08:00", Date.parse("2026-09-02T01:00:00Z"));
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("\"Truk, \"\"A\"\"\"");
    expect(csv).toContain("9");
  });
});

describe("ageLabel", () => {
  it("uses minutes then hours", () => {
    const now = Date.parse("2026-09-02T12:00:00Z");
    expect(ageLabel(now - 90_000, now)).toBe("1 min ago");
    expect(ageLabel(now - 3 * 60 * 60_000, now)).toBe("3 h ago");
  });
});
