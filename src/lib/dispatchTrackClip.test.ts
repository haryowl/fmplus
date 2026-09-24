import { describe, expect, it } from "vitest";
import { clipTimedTrackToWindow, downsampleTimedTrack } from "./dispatchTrackClip";

describe("clipTimedTrackToWindow", () => {
  const pts = [
    { lat: 0, lon: 0, recordedAt: "2026-09-19T01:00:00.000Z" },
    { lat: 1, lon: 1, recordedAt: "2026-09-19T03:00:00.000Z" },
    { lat: 2, lon: 2, recordedAt: "2026-09-19T05:00:00.000Z" },
    { lat: 3, lon: 3, recordedAt: "2026-09-19T07:00:00.000Z" },
  ];

  it("clips to start→end", () => {
    const line = clipTimedTrackToWindow(
      pts,
      "2026-09-19T02:30:00.000Z",
      "2026-09-19T06:00:00.000Z",
    );
    expect(line).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });

  it("uses now as end when job still open", () => {
    const now = Date.parse("2026-09-19T04:00:00.000Z");
    const line = clipTimedTrackToWindow(pts, "2026-09-19T02:00:00.000Z", null, now);
    expect(line).toEqual([[1, 1]]);
  });

  it("falls back to the day trail when the job window matches no samples", () => {
    const line = clipTimedTrackToWindow(
      pts,
      "2026-09-19T12:00:00.000Z",
      "2026-09-19T13:00:00.000Z",
    );
    expect(line).toHaveLength(4);
    expect(line[0]).toEqual([0, 0]);
  });
});

describe("downsampleTimedTrack", () => {
  it("caps long trails", () => {
    const pts = Array.from({ length: 500 }, (_, i) => ({
      lat: i,
      lon: i,
      recordedAt: new Date(i * 1000).toISOString(),
    }));
    expect(downsampleTimedTrack(pts, 50)).toHaveLength(50);
  });
});
