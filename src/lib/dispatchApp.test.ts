import { describe, expect, it } from "vitest";
import { isTenantKey } from "./tenant";

describe("dispatch embed key rules", () => {
  it("accepts desk-style tenant keys", () => {
    expect(isTenantKey("emb_siteA_x7k2")).toBe(true);
    expect(isTenantKey("no")).toBe(false);
  });
});
