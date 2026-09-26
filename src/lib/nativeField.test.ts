import { describe, expect, it } from "vitest";
import { isNativeFieldApp } from "./nativeField";

describe("isNativeFieldApp", () => {
  it("is false in the browser / test runner", () => {
    expect(isNativeFieldApp()).toBe(false);
  });
});
