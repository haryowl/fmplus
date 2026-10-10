import { describe, expect, it } from "vitest";
import { isNativeDispatchApp, isNativeFieldApp } from "./nativeField";

describe("native app detection", () => {
  it("is false in the browser / test runner", () => {
    expect(isNativeFieldApp()).toBe(false);
    expect(isNativeDispatchApp()).toBe(false);
  });
});
