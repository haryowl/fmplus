import { describe, expect, it } from "vitest";
import { pointsJson } from "../../server/user-day-tracks.mjs";

describe("pointsJson", () => {
  it("passes an array body through without wrapping", () => {
    const raw = '[{"uTC":"2026-09-01T00:00:00Z"}]';
    expect(pointsJson(raw)).toBe(raw);
  });

  it("unwraps { items } lists", () => {
    expect(pointsJson('{"items":[{"id":1}]}')).toBe('[{"id":1}]');
  });

  it("treats empty and junk as no points", () => {
    expect(pointsJson("")).toBe("[]");
    expect(pointsJson("not-json")).toBe("[]");
  });
});
