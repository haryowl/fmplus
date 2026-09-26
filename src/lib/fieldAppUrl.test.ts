import { describe, expect, it } from "vitest";
import { fieldAppOrigin } from "./fieldAppUrl";

describe("fieldAppOrigin", () => {
  it("defaults to the production Field host", () => {
    expect(fieldAppOrigin()).toBe("https://81.17.100.7:4173");
    expect(fieldAppOrigin("")).toBe("https://81.17.100.7:4173");
  });

  it("strips a trailing slash and /m", () => {
    expect(fieldAppOrigin("https://81.17.100.7:4173/m/")).toBe("https://81.17.100.7:4173");
  });
});
