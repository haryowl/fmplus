import { describe, expect, it } from "vitest";
import { cookedSnapshot, evalFormula } from "../../server/fleet-alert-rules.mjs";

describe("cookedSnapshot", () => {
  it("maps core fix fields and fuel from mapped attrs", () => {
    const snap = cookedSnapshot(
      { protocol: "teltonika" },
      {
        speed: 72.4,
        heading: 180,
        ignition: true,
        odometer: 12345.6,
        lat: -6.2,
        lon: 106.8,
        recorded_at: new Date(),
        mapped_attrs: { fuel_level: 55 },
      },
    );
    expect(snap.speed).toBe(72.4);
    expect(snap.heading).toBe(180);
    expect(snap.ignition).toBe(true);
    expect(snap.odometer_km).toBe(12345.6);
    expect(snap.fuel_level).toBe(55);
    expect(snap.protocol).toBe("teltonika");
    expect(snap.age_sec).toBeTypeOf("number");
    expect(snap.age_sec).toBeGreaterThanOrEqual(0);
  });

  it("tolerates missing fix data", () => {
    const snap = cookedSnapshot(null, null);
    expect(snap.speed).toBeNull();
    expect(snap.ignition).toBeNull();
    expect(snap.age_sec).toBeNull();
    expect(snap.mapped).toEqual({});
  });
});

describe("evalFormula", () => {
  const snap = {
    speed: 90,
    ignition: true,
    age_sec: 30,
    fuel_level: 40,
    odometer_km: 1000,
    heading: 90,
    lat: 1,
    lon: 2,
    protocol: "teltonika",
    mapped: { alarm: "overspeed", tag: "fleet-a" },
  };

  it("requires at least one condition", () => {
    expect(evalFormula({ op: "and", conditions: [] }, snap)).toBe(false);
    expect(evalFormula(null, snap)).toBe(false);
  });

  it("evaluates numeric comparators", () => {
    expect(
      evalFormula({ op: "and", conditions: [{ field: "speed", cmp: ">", value: 80 }] }, snap),
    ).toBe(true);
    expect(
      evalFormula({ op: "and", conditions: [{ field: "speed", cmp: "<=", value: 80 }] }, snap),
    ).toBe(false);
    expect(
      evalFormula({ op: "and", conditions: [{ field: "fuel_level", cmp: "==", value: 40 }] }, snap),
    ).toBe(true);
  });

  it("ANDs and ORs conditions", () => {
    const slow = { field: "speed", cmp: "<", value: 50 };
    const fast = { field: "speed", cmp: ">", value: 80 };
    const ign = { field: "ignition", cmp: "==", value: true };
    expect(evalFormula({ op: "and", conditions: [fast, ign] }, snap)).toBe(true);
    expect(evalFormula({ op: "and", conditions: [slow, ign] }, snap)).toBe(false);
    expect(evalFormula({ op: "or", conditions: [slow, ign] }, snap)).toBe(true);
    expect(evalFormula({ op: "or", conditions: [slow, { field: "speed", cmp: "<", value: 10 }] }, snap)).toBe(
      false,
    );
  });

  it("supports in and contains", () => {
    expect(
      evalFormula(
        { op: "and", conditions: [{ field: "mapped.alarm", cmp: "in", value: "overspeed,crash" }] },
        snap,
      ),
    ).toBe(true);
    expect(
      evalFormula(
        { op: "and", conditions: [{ field: "mapped.tag", cmp: "contains", value: "FLEET" }] },
        snap,
      ),
    ).toBe(true);
    expect(
      evalFormula(
        { op: "and", conditions: [{ field: "mapped.alarm", cmp: "in", value: ["idle", "tow"] }] },
        snap,
      ),
    ).toBe(false);
  });

  it("compares boolean ignition with string/boolean values", () => {
    expect(
      evalFormula({ op: "and", conditions: [{ field: "ignition", cmp: "==", value: true }] }, snap),
    ).toBe(true);
    expect(
      evalFormula({ op: "and", conditions: [{ field: "ignition", cmp: "==", value: "true" }] }, snap),
    ).toBe(true);
    expect(
      evalFormula({ op: "and", conditions: [{ field: "ignition", cmp: "!=", value: false }] }, snap),
    ).toBe(true);
  });

  it("rejects unknown comparators", () => {
    expect(
      evalFormula({ op: "and", conditions: [{ field: "speed", cmp: "~~", value: 1 }] }, snap),
    ).toBe(false);
  });
});
