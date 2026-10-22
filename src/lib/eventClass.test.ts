import { describe, expect, it } from "vitest";
import {
  classifyAlarmType,
  isRuleSeverityAlert,
  isSafetyWarningEvent,
} from "./eventClass";

describe("classifyAlarmType", () => {
  it("seeds ignition as an asset event that does not raise an alert", () => {
    const info = classifyAlarmType("ignition");
    expect(info.eventClass).toBe("asset");
    expect(info.raiseAlert).toBe(false);
    expect(info.emitOn).toBe("change");
  });

  it("treats unknown types as warnings until mapped", () => {
    const info = classifyAlarmType("mystery_beep");
    expect(info.eventClass).toBe("warning");
    expect(info.raiseAlert).toBe(true);
  });

  it("classifies harsh/ADAS/DSM prefixes as safety", () => {
    expect(classifyAlarmType("harsh_brake").eventClass).toBe("safety");
    expect(classifyAlarmType("adas_fcw").eventClass).toBe("safety");
    expect(classifyAlarmType("dsm_fatigue").eventClass).toBe("safety");
  });

  it("hides media-only types from Events", () => {
    expect(classifyAlarmType("video_loss").eventClass).toBe("none");
    expect(classifyAlarmType("snapshot").raiseAlert).toBe(false);
  });

  it("applies Device Mapper overrides", () => {
    const info = classifyAlarmType("ignition", {
      eventClass: "warning",
      raiseAlert: true,
      emitOn: "rising",
    });
    expect(info.eventClass).toBe("warning");
    expect(info.raiseAlert).toBe(true);
    expect(info.emitOn).toBe("rising");
  });
});

describe("isSafetyWarningEvent", () => {
  it("keeps GNSS antenna and SIM missing on Alerts", () => {
    expect(isSafetyWarningEvent({ alarmType: "gnss_antenna" })).toBe(true);
    expect(isSafetyWarningEvent({ alarmType: "sim_missing" })).toBe(true);
    expect(isSafetyWarningEvent({ alarmType: "overspeed" })).toBe(true);
  });

  it("keeps movement and ignition off Alerts even if raiseAlert was omitted", () => {
    expect(isSafetyWarningEvent({ alarmType: "movement" })).toBe(false);
    expect(isSafetyWarningEvent({ alarmType: "ignition" })).toBe(false);
    expect(isSafetyWarningEvent({ alarmType: "movement", eventClass: "asset" })).toBe(false);
  });

  it("follows an explicit class from Device Mapper", () => {
    expect(isSafetyWarningEvent({ alarmType: "ignition", eventClass: "warning" })).toBe(true);
  });
});

describe("isRuleSeverityAlert", () => {
  it("includes critical and warning rule fires only", () => {
    expect(isRuleSeverityAlert("critical")).toBe(true);
    expect(isRuleSeverityAlert("warning")).toBe(true);
    expect(isRuleSeverityAlert("warn")).toBe(true);
    expect(isRuleSeverityAlert("info")).toBe(false);
    expect(isRuleSeverityAlert("")).toBe(false);
  });
});
