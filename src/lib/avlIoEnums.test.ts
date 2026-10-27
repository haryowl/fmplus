import { describe, expect, it } from "vitest";
import { flattenFixParamRows } from "../../server/device-manager.mjs";
import { eventDisplayTitle } from "./fleetMedia";
import { formatDisplayPinValue } from "./fleetTelemetryParams";
import { avlIoLabel, formatAvlParamValue, permanentIoLabel } from "./avlIoEnums";

describe("Teltonika AVL descriptions", () => {
  it("maps green driving type 1/2/3 to official text", () => {
    expect(avlIoLabel("green_driving", 1)).toBe("Harsh acceleration");
    expect(avlIoLabel("green_driving", 2)).toBe("Harsh braking");
    expect(avlIoLabel("green_driving", 3)).toBe("Harsh cornering");
  });

  it("shows the official type instead of generic Green driving", () => {
    expect(
      eventDisplayTitle("green_driving", { "green_driving.value": 2 }),
    ).toBe("Harsh braking");
    expect(eventDisplayTitle("harsh_accel", { io_label: "Harsh acceleration" })).toBe(
      "Harsh acceleration",
    );
    expect(eventDisplayTitle("crash", { "crash.value": 1 })).toBe(
      "Crash · Real crash detected (device is calibrated)",
    );
  });

  it("maps Permanent I/O Description enums", () => {
    expect(permanentIoLabel("gnss.status", 1)).toBe("GNSS on with fix");
    expect(permanentIoLabel("sleep.mode", 4)).toBe("Ultra sleep");
    expect(permanentIoLabel("network.data_mode", 2)).toBe("Roaming on stop");
    expect(permanentIoLabel("status.ignition", true)).toBe("Ignition on");
    expect(permanentIoLabel("status.movement", 0)).toBe("Movement off");
    expect(permanentIoLabel("network.type", 99)).toBe("Unknown");
    expect(formatAvlParamValue("ext_voltage", 12.6)).toBe(12.6);
  });

  it("shows official ignition/movement text instead of generic titles", () => {
    expect(eventDisplayTitle("ignition", { "ignition.value": 1 })).toBe("Ignition on");
    expect(eventDisplayTitle("movement", { io_label: "Movement off" })).toBe("Movement off");
  });

  it("decodes Description from slim events plus matching-fix attrs", () => {
    expect(eventDisplayTitle("green_driving", { event_io: 243 }, { "io.253": 2 })).toBe(
      "Harsh braking",
    );
    expect(
      eventDisplayTitle("green_driving", { event_io: 253, "alarm.green_driving": true }, {
        io: { "253": 1 },
      }),
    ).toBe("Harsh acceleration");
    expect(eventDisplayTitle("ignition", { event_io: 239, ignition: true })).toBe("Ignition on");
    expect(
      eventDisplayTitle("ignition", { event_io: 239 }, { "status.ignition": false }),
    ).toBe("Ignition off");
    expect(
      eventDisplayTitle("movement", { event_io: 240 }, { "status.movement": true }),
    ).toBe("Movement on");
  });

  it("formats dashboard pins with Permanent I/O descriptions", () => {
    expect(formatDisplayPinValue(1, "gnss.status")).toBe("GNSS on with fix");
    expect(formatDisplayPinValue(true, "ignition")).toBe("Ignition on");
    expect(formatDisplayPinValue(12.6, "ext_voltage")).toBe("12.6");
    expect(formatDisplayPinValue(true, "gps.valid")).toBe("yes");
  });

  it("decodes Permanent I/O values in the param inspector", () => {
    const rows = flattenFixParamRows({
      deviceId: "d1",
      ignition: true,
      mappedAttrs: {
        "gnss.status": 1,
        "sleep.mode": 4,
        "network.data_mode": 2,
        "status.movement": true,
        "status.din1": false,
      },
    });
    const byId = Object.fromEntries(rows.map((r) => [r.paramId, r.value]));
    expect(byId.ignition).toBe("Ignition on");
    expect(byId["gnss.status"]).toBe("GNSS on with fix");
    expect(byId["sleep.mode"]).toBe("Ultra sleep");
    expect(byId["network.data_mode"]).toBe("Roaming on stop");
    expect(byId["status.movement"]).toBe("Movement on");
    expect(byId["status.din1"]).toBe("Off");
  });

  it("omits typed ignition when the last fix has no mapped value", () => {
    const rows = flattenFixParamRows({
      deviceId: "d1",
      protocol: "galileosky",
      ignition: null,
      mappedAttrs: { "status.engine": true },
    });
    expect(rows.some((r) => r.paramId === "ignition" || r.paramId === "status.ignition")).toBe(
      false,
    );
    expect(rows.find((r) => r.paramId === "status.engine")?.value).toBe(true);
  });
});
