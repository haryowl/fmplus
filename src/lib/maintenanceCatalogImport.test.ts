import { describe, expect, it } from "vitest";
import { catalogKindFromCsv } from "../../server/maintenance-catalog.mjs";

describe("maintenance catalog CSV kind", () => {
  it("accepts part and service labels", () => {
    expect(catalogKindFromCsv("part")).toBe("part");
    expect(catalogKindFromCsv("Parts")).toBe("part");
    expect(catalogKindFromCsv("service")).toBe("service");
    expect(catalogKindFromCsv("labor")).toBe("service");
  });

  it("rejects others and blank kinds", () => {
    expect(catalogKindFromCsv("other")).toBe("");
    expect(catalogKindFromCsv("")).toBe("");
  });
});
