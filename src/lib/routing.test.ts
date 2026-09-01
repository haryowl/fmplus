import { describe, expect, it } from "vitest";
import { compactHref, fleetCompactHref, fleetHref, fullHref, isCompactPath, viewFromPath, withSearch } from "./routing";

describe("viewFromPath", () => {
  it("routes fleet compact separately from single-vehicle compact", () => {
    expect(viewFromPath("/compact")).toBe("compact");
    expect(viewFromPath("/compact/")).toBe("compact");
    expect(viewFromPath("/fleet")).toBe("fleet");
    expect(viewFromPath("/fleet/compact")).toBe("fleetCompact");
    expect(viewFromPath("/fleet/compact/")).toBe("fleetCompact");
    expect(viewFromPath("/")).toBe("full");
  });
});

describe("isCompactPath", () => {
  it("matches compact routes", () => {
    expect(isCompactPath("/compact")).toBe(true);
    expect(isCompactPath("/compact.html")).toBe(true);
  });

  it("rejects the full dashboard and fleet pages", () => {
    expect(isCompactPath("/")).toBe(false);
    expect(isCompactPath("/index.html")).toBe(false);
    expect(isCompactPath("/metrics")).toBe(false);
    expect(isCompactPath("/fleet")).toBe(false);
    expect(isCompactPath("/fleet/compact")).toBe(false);
  });
});

describe("withSearch", () => {
  it("keeps the query string on each view", () => {
    const q = "?groupId=12&userId=99&embed=1";
    expect(compactHref(q)).toBe("/compact?groupId=12&userId=99&embed=1");
    expect(fullHref(q)).toBe("/?groupId=12&userId=99&embed=1");
    expect(fleetHref(q)).toBe("/fleet?groupId=12&userId=99&embed=1");
    expect(fleetCompactHref(q)).toBe("/fleet/compact?groupId=12&userId=99&embed=1");
    expect(withSearch("/compact", "")).toBe("/compact");
  });
});
