import { describe, expect, it } from "vitest";
import { preferredNfcCode, scanButtonLabel, scanSheetHint } from "./nfcScan";

describe("nfc scan helpers", () => {
  it("prefers the NDEF payload over the chip UID", () => {
    expect(
      preferredNfcCode({ code: "am1:v1:goods:OIL-01", uid: "04a2b1c3", fromNdef: true }),
    ).toBe("am1:v1:goods:OIL-01");
    expect(preferredNfcCode({ uid: "04a2b1c3" })).toBe("04a2b1c3");
    expect(preferredNfcCode({})).toBe("");
  });

  it("renames the Field button when NFC is allowed", () => {
    expect(scanButtonLabel("Scan", false)).toBe("Scan");
    expect(scanButtonLabel("Scan", true)).toBe("Scan or tap");
    expect(scanButtonLabel("Scan part", true)).toBe("Scan or tap part");
  });

  it("describes camera, tap, and type in one hint", () => {
    expect(scanSheetHint({ cameraReady: true, typed: true, nfcReady: true })).toBe(
      "Point the camera at a barcode or QR, or tap an NFC tag",
    );
    expect(scanSheetHint({ cameraReady: false, typed: true, nfcReady: true })).toBe(
      "Tap an NFC tag or type the code",
    );
    expect(scanSheetHint({ cameraReady: true, typed: true, nfcReady: false })).toBe(
      "Point the camera at a barcode or QR",
    );
  });
});
