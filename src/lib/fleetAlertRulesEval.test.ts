import { describe, expect, it } from "vitest";
import {
  applyHysteresis,
  cookedSnapshot,
  evalFormula,
  matchFormula,
  shouldFireRule,
} from "../../server/fleet-alert-rules.mjs";

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

  it("evaluates nested AND/OR groups", () => {
    const crash = { field: "mapped.alarm", cmp: "==", value: "overspeed" };
    const slow = { field: "speed", cmp: "<", value: 50 };
    const ign = { field: "ignition", cmp: "==", value: true };
    expect(
      evalFormula(
        {
          op: "or",
          conditions: [crash],
          groups: [{ op: "and", conditions: [slow, ign] }],
        },
        snap,
      ),
    ).toBe(true);
    expect(
      evalFormula(
        {
          op: "and",
          conditions: [{ field: "speed", cmp: ">", value: 80 }],
          groups: [{ op: "and", conditions: [{ field: "ignition", cmp: "==", value: false }] }],
        },
        snap,
      ),
    ).toBe(false);
    expect(
      evalFormula(
        {
          op: "and",
          conditions: [],
          groups: [{ op: "or", conditions: [crash, slow] }],
        },
        snap,
      ),
    ).toBe(true);
  });

  it("picks the first matching ELSE WHEN branch", () => {
    const formula = {
      op: "and",
      conditions: [],
      branches: [
        {
          label: "Critical",
          severity: "critical",
          notifyEmail: true,
          notifyWhatsapp: true,
          formula: { op: "and", conditions: [{ field: "speed", cmp: ">", value: 120 }] },
        },
        {
          label: "Warning",
          severity: "warning",
          notifyEmail: true,
          notifyWhatsapp: false,
          formula: { op: "and", conditions: [{ field: "speed", cmp: ">", value: 80 }] },
        },
      ],
    };
    const hit = matchFormula(formula, snap);
    expect(hit.hit).toBe(true);
    expect(hit.branch.label).toBe("Warning");
    expect(hit.branch.severity).toBe("warning");
    expect(matchFormula(formula, { ...snap, speed: 10 }).hit).toBe(false);
  });
});

describe("applyHysteresis", () => {
  it("loosens numeric thresholds when latched", () => {
    const shifted = applyHysteresis(
      { op: "and", conditions: [{ field: "speed", cmp: ">", value: 80 }] },
      10,
    );
    expect(shifted.conditions[0].value).toBe(70);
    expect(
      evalFormula(shifted, { speed: 72, ignition: true, mapped: {} }),
    ).toBe(true);
    expect(
      matchFormula(
        { op: "and", conditions: [{ field: "speed", cmp: ">", value: 80 }], hysteresis: 10 },
        { speed: 72, ignition: true, mapped: {} },
        { latched: true },
      ).hit,
    ).toBe(true);
    expect(
      matchFormula(
        { op: "and", conditions: [{ field: "speed", cmp: ">", value: 80 }], hysteresis: 10 },
        { speed: 72, ignition: true, mapped: {} },
        { latched: false },
      ).hit,
    ).toBe(false);
  });
});

describe("shouldFireRule", () => {
  const base = {
    hit: true,
    wasTrue: false,
    trueSinceMs: null,
    nowMs: 1_000_000,
    durationSec: 0,
    lastFiredMs: null,
    cooldownSec: 300,
  };

  it("fires once on rising and not again while still true", () => {
    expect(shouldFireRule({ ...base, emitOn: "rising" })).toBe(true);
    expect(
      shouldFireRule({
        ...base,
        emitOn: "rising",
        wasTrue: true,
        trueSinceMs: 900_000,
        lastFiredMs: 950_000,
      }),
    ).toBe(false);
  });

  it("fires on falling after a dwell", () => {
    expect(
      shouldFireRule({
        ...base,
        emitOn: "falling",
        hit: false,
        wasTrue: true,
        trueSinceMs: 800_000,
        durationSec: 60,
      }),
    ).toBe(true);
    expect(
      shouldFireRule({
        ...base,
        emitOn: "falling",
        hit: false,
        wasTrue: true,
        trueSinceMs: 980_000,
        durationSec: 60,
      }),
    ).toBe(false);
  });

  it("retriggers level after cooldown", () => {
    expect(
      shouldFireRule({
        ...base,
        emitOn: "level",
        wasTrue: true,
        trueSinceMs: 100_000,
        lastFiredMs: 400_000,
      }),
    ).toBe(true);
  });
});
