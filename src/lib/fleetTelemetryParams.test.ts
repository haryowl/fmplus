import { describe, expect, it } from "vitest";
import {
  FLEET_DISPLAY_PIN_IDS,
  buildDisplayPinColumns,
  extraDisplayPinColumns,
  uniqueDisplayPinIds,
} from "./fleetTelemetryParams";

describe("uniqueDisplayPinIds", () => {
  it("keeps one id per voltage alias family", () => {
    expect(
      uniqueDisplayPinIds([
        "ext_voltage",
        "voltage.ext",
        "battery_voltage",
        "voltage.batt",
      ]),
    ).toEqual(["ext_voltage", "battery_voltage"]);
  });

  it("keeps the first alias when only vendor keys are listed", () => {
    expect(uniqueDisplayPinIds(["voltage.ext", "voltage.batt"])).toEqual([
      "voltage.ext",
      "voltage.batt",
    ]);
  });
});

describe("display pin columns", () => {
  it("does not list Ext V / Batt V twice from defaults", () => {
    const extra = extraDisplayPinColumns();
    const labels = extra.map((c) => c.label);
    expect(labels.filter((l) => l === "Ext V")).toHaveLength(1);
    expect(labels.filter((l) => l === "Batt V")).toHaveLength(1);
    expect(FLEET_DISPLAY_PIN_IDS).not.toContain("voltage.ext");
    expect(FLEET_DISPLAY_PIN_IDS).not.toContain("voltage.batt");
  });

  it("de-dupes tenant overrides that still list both aliases", () => {
    const cols = buildDisplayPinColumns([
      "fuel_level",
      "ext_voltage",
      "voltage.ext",
      "battery_voltage",
      "voltage.batt",
      "gps.valid",
    ]);
    expect(cols.map((c) => c.id)).toEqual([
      "fuel_level",
      "ext_voltage",
      "battery_voltage",
      "gps.valid",
    ]);
  });
});
