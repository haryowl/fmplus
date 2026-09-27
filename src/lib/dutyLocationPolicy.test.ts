import { describe, expect, it } from "vitest";
import { DEFAULT_DUTY_LOCATION_POLICY, normalizeDutyLocationPolicy } from "./dutyLocationPolicy";

describe("normalizeDutyLocationPolicy", () => {
  it("keeps the 15s / 60s / 25m defaults", () => {
    expect(normalizeDutyLocationPolicy()).toEqual(DEFAULT_DUTY_LOCATION_POLICY);
    expect(normalizeDutyLocationPolicy({})).toEqual(DEFAULT_DUTY_LOCATION_POLICY);
  });

  it("clamps a very fast interval", () => {
    expect(normalizeDutyLocationPolicy({ intervalSec: 1 }).intervalSec).toBe(5);
  });

  it("raises quiet so it is never faster than the moving interval", () => {
    expect(normalizeDutyLocationPolicy({ intervalSec: 45, quietSec: 20 }).quietSec).toBe(45);
  });
});
