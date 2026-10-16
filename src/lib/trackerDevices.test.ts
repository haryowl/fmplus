import { describe, expect, it } from "vitest";
import {
  mergeArmadaRowsWithDeviceFixes,
  trackerFixToStatusRow,
  type TrackerLastFix,
} from "./trackerDevices";
import type { LastStatusRow } from "./lastStatus";

const fix = (partial: Partial<TrackerLastFix> & Pick<TrackerLastFix, "deviceId" | "imei">): TrackerLastFix => ({
  label: partial.label || partial.imei,
  armadaUserId: partial.armadaUserId ?? null,
  protocol: partial.protocol || "json",
  lat: partial.lat ?? -6.2,
  lon: partial.lon ?? 106.8,
  recordedAt: partial.recordedAt ?? "2026-10-16T10:00:00.000Z",
  ageSec: partial.ageSec ?? 10,
  speed: partial.speed ?? 40,
  heading: partial.heading ?? null,
  ignition: partial.ignition ?? true,
  sourceProtocol: partial.sourceProtocol || "json",
  deviceId: partial.deviceId,
  imei: partial.imei,
});

describe("trackerFixToStatusRow", () => {
  it("uses armadaUserId when linked", () => {
    const row = trackerFixToStatusRow(fix({ deviceId: "d1", imei: "3520", armadaUserId: 99 }));
    expect(row.id).toBe(99);
    expect(row.username).toBe("3520");
  });

  it("uses a stable negative id for orphan devices", () => {
    const row = trackerFixToStatusRow(fix({ deviceId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", imei: "3520" }));
    expect(row.id).toBeLessThan(0);
  });
});

describe("mergeArmadaRowsWithDeviceFixes", () => {
  const armada: LastStatusRow[] = [
    {
      id: 99,
      name: "Truck",
      username: "truck",
      utc: "2026-10-16T09:00:00.000Z",
      deviceActivity: "2026-10-16T09:00:00.000Z",
      lastMs: Date.parse("2026-10-16T09:00:00.000Z"),
      lat: -6.1,
      lon: 106.7,
      altitude: null,
      heading: null,
      speedKmh: 10,
      ignition: true,
      fuelLevel: null,
      odometerKm: null,
    },
  ];

  it("overlays a fresher device fix onto the Armada row", () => {
    const merged = mergeArmadaRowsWithDeviceFixes(
      armada,
      [fix({ deviceId: "d1", imei: "3520", armadaUserId: 99, lat: -6.25, lon: 106.85 })],
      "both",
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].lat).toBeCloseTo(-6.25);
    expect(merged[0].lon).toBeCloseTo(106.85);
  });

  it("appends orphan devices", () => {
    const merged = mergeArmadaRowsWithDeviceFixes(
      armada,
      [fix({ deviceId: "orphan-1", imei: "9999", armadaUserId: null })],
      "both",
    );
    expect(merged.length).toBe(2);
  });

  it("returns only devices when telematics_source is devices", () => {
    const merged = mergeArmadaRowsWithDeviceFixes(
      armada,
      [fix({ deviceId: "d1", imei: "3520", armadaUserId: 99 })],
      "devices",
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].username).toBe("3520");
  });
});
