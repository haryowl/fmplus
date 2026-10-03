import { describe, expect, it } from "vitest";
import { validCustomerCoords } from "../../server/dispatch-customers.mjs";

describe("customer coordinates", () => {
  it("accepts a Bandung pin", () => {
    expect(validCustomerCoords(-6.9147, 107.6098)).toBe(true);
  });

  it("rejects missing or out-of-range coordinates", () => {
    expect(validCustomerCoords(null, 107)).toBe(false);
    expect(validCustomerCoords(91, 10)).toBe(false);
    expect(validCustomerCoords(0, 181)).toBe(false);
  });
});
