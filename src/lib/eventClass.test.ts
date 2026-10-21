import { describe, expect, it } from "vitest";
import { classifyAlarmType } from "./eventClass";

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
