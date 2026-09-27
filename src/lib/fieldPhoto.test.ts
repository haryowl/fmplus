import { describe, expect, it } from "vitest";
import { CameraErrorCode } from "@capacitor/camera";
import { isFieldPhotoCancelled } from "./fieldPhoto";

describe("isFieldPhotoCancelled", () => {
  it("treats Capacitor camera / gallery cancel codes as cancel", () => {
    expect(isFieldPhotoCancelled({ code: CameraErrorCode.TakePhotoCancelled })).toBe(true);
    expect(isFieldPhotoCancelled({ code: CameraErrorCode.ChooseMediaCancelled })).toBe(true);
  });

  it("treats cancel-worded errors as cancel", () => {
    expect(isFieldPhotoCancelled(new Error("User cancelled photos app"))).toBe(true);
  });

  it("does not swallow real failures", () => {
    expect(isFieldPhotoCancelled(new Error("Camera permission is blocked"))).toBe(false);
    expect(isFieldPhotoCancelled({ code: CameraErrorCode.CameraPermissionDenied })).toBe(false);
  });
});
