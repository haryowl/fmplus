import { describe, expect, it } from "vitest";
import { pickDriverFromCustomFields } from "./driverFields";

describe("pickDriverFromCustomFields", () => {
  it("prefers exact Driver name", () => {
    expect(
      pickDriverFromCustomFields([
        { name: "Plate", value: "B 1234 XX" },
        { name: "Driver", value: "Budi" },
      ]),
    ).toBe("Budi");
  });

  it("matches Indonesian labels", () => {
    expect(pickDriverFromCustomFields([{ name: "Pengemudi", value: "Siti" }])).toBe("Siti");
  });

  it("returns empty when no driver-like field", () => {
    expect(pickDriverFromCustomFields([{ name: "Depot", value: "Jakarta" }])).toBe("");
  });
});
