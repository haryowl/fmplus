import { describe, expect, it } from "vitest";
import { phoneTrailOrCrumbs } from "./dispatchPhoneTrail";

describe("phoneTrailOrCrumbs", () => {
  it("keeps a real trail when it already has two points", () => {
    expect(
      phoneTrailOrCrumbs(
        [
          [-6.2, 106.8],
          [-6.21, 106.81],
        ],
        { stops: [{ phoneLat: -6.3, phoneLon: 106.9 }] },
      ),
    ).toEqual([
      [-6.2, 106.8],
      [-6.21, 106.81],
    ]);
  });

  it("stitches start, complete, and live phone dots when the trail is empty", () => {
    const line = phoneTrailOrCrumbs([], {
      stops: [
        { startPhoneLat: -6.2, startPhoneLon: 106.8, phoneLat: -6.21, phoneLon: 106.81 },
        { phoneLat: -6.22, phoneLon: 106.82 },
      ],
      phonePos: { lat: -6.23, lon: 106.83 },
    });
    expect(line.length).toBeGreaterThanOrEqual(2);
    expect(line[0]).toEqual([-6.2, 106.8]);
    expect(line[line.length - 1]).toEqual([-6.23, 106.83]);
  });

  it("does not invent a line from a single complete dot", () => {
    expect(
      phoneTrailOrCrumbs([], {
        stops: [{ phoneLat: -6.2, phoneLon: 106.8 }],
      }),
    ).toEqual([]);
  });
});
