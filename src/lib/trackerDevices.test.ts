import { describe, expect, it } from "vitest";
import {
  deviceIdByStatusRowId,
  dispatchVehiclePickerRows,
  hashDeviceId,
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
  odometerKm: partial.odometerKm ?? null,
  fuelLevel: partial.fuelLevel ?? null,
  fuelLiters: partial.fuelLiters ?? null,
  groups: partial.groups,
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

  it("can ignore a linked Armada user id", () => {
    const row = trackerFixToStatusRow(fix({ deviceId: "d1", imei: "3520", armadaUserId: 99 }), {
      ignoreArmadaLink: true,
    });
    expect(row.id).toBe(hashDeviceId("d1"));
  });
});

describe("deviceIdByStatusRowId", () => {
  it("maps linked and synthetic status ids to device UUID", () => {
    const orphanId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const map = deviceIdByStatusRowId([
      fix({ deviceId: "linked-dev", imei: "1", armadaUserId: 42 }),
      fix({ deviceId: orphanId, imei: "2" }),
    ]);
    expect(map.get(42)).toBe("linked-dev");
    expect(map.get(hashDeviceId(orphanId))).toBe(orphanId);
  });

  it("ignores Armada links when telematics_source is devices", () => {
    const map = deviceIdByStatusRowId(
      [fix({ deviceId: "linked-dev", imei: "1", armadaUserId: 42 })],
      { ignoreArmadaLink: true },
    );
    expect(map.get(42)).toBeUndefined();
    expect(map.get(hashDeviceId("linked-dev"))).toBe("linked-dev");
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
      [
        fix({
          deviceId: "d1",
          imei: "3520",
          armadaUserId: 99,
          lat: -6.25,
          lon: 106.85,
          odometerKm: 12345,
          fuelLevel: 55,
        }),
      ],
      "both",
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].lat).toBeCloseTo(-6.25);
    expect(merged[0].lon).toBeCloseTo(106.85);
    expect(merged[0].odometerKm).toBe(12345);
    expect(merged[0].fuelLevel).toBe(55);
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
    expect(merged[0].id).toBe(hashDeviceId("d1"));
    expect(merged[0].id).not.toBe(99);
  });
});

describe("dispatchVehiclePickerRows", () => {
  const armadaRow: LastStatusRow = {
    id: 99,
    name: "Armada truck",
    username: "truck",
    utc: "",
    deviceActivity: "",
    lastMs: null,
    lat: null,
    lon: null,
    altitude: null,
    heading: null,
    speedKmh: null,
    ignition: null,
    fuelLevel: null,
    odometerKm: null,
  };
  const gpsRow: LastStatusRow = { ...armadaRow, id: -200, name: "GPS van", username: "3520" };

  it("lists Device Source rows when source is devices", () => {
    const rows = dispatchVehiclePickerRows({
      source: "devices",
      deviceRows: [gpsRow],
      groupRows: [armadaRow],
      hasArmadaGroups: true,
      armadaGroupSelected: true,
    });
    expect(rows.map((r) => r.id)).toEqual([-200]);
  });

  it("does not hide GPS devices behind an Armada group in both mode", () => {
    const unset = dispatchVehiclePickerRows({
      source: "both",
      deviceRows: [armadaRow, gpsRow],
      groupRows: [armadaRow],
      hasArmadaGroups: true,
      armadaGroupSelected: false,
    });
    expect(unset.some((r) => r.id < 0)).toBe(true);

    const picked = dispatchVehiclePickerRows({
      source: "both",
      deviceRows: [armadaRow, gpsRow],
      groupRows: [armadaRow],
      hasArmadaGroups: true,
      armadaGroupSelected: true,
    });
    expect(picked.map((r) => r.id).sort()).toEqual([-200, 99]);
  });
});
