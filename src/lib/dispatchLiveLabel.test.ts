import { describe, expect, it } from "vitest";
import { livePositionLabel, liveSeparationPhrase } from "./dispatchLiveLabel";
import type { DispatchLivePosition } from "./dispatch";

function pos(partial: Partial<DispatchLivePosition>): DispatchLivePosition {
  return {
    lat: -6.2,
    lon: 106.8,
    source: "phone",
    recordedAt: null,
    ageSec: null,
    accuracyM: null,
    phoneSeparationKm: null,
    ...partial,
  };
}

describe("liveSeparationPhrase", () => {
  it("names the other source, not the one already shown", () => {
    expect(liveSeparationPhrase("phone", 13.8)).toBe("13.8 km from vehicle");
    expect(liveSeparationPhrase("armada", 13.8)).toBe("13.8 km from driver phone");
  });

  it("hides a tiny gap", () => {
    expect(liveSeparationPhrase("phone", 0.1)).toBe("");
  });
});

describe("livePositionLabel", () => {
  it("does not say vehicle GPS is kilometres from the vehicle", () => {
    const label = livePositionLabel({
      liveLat: -6.2,
      liveLon: 106.8,
      livePosition: pos({ source: "armada", phoneSeparationKm: 13.8 }),
    });
    expect(label?.text).toBe("Vehicle GPS · 13.8 km from driver phone");
  });

  it("keeps from-vehicle when the phone is the shown source", () => {
    const label = livePositionLabel({
      liveLat: -6.2,
      liveLon: 106.8,
      livePosition: pos({ source: "phone", ageSec: 9, phoneSeparationKm: 13.8 }),
    });
    expect(label?.text).toBe("Driver phone · 9s ago · 13.8 km from vehicle");
  });
});
