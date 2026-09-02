import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_APP_ID } from "./config";
import {
  bootTenantFromSearch,
  configureTenant,
  currentAppId,
  currentTenantKey,
  isTenantKey,
  tenantHeaders,
} from "./tenant";

describe("tenant key", () => {
  afterEach(() => {
    configureTenant("", DEFAULT_APP_ID);
  });

  it("accepts opaque keys and rejects short or unsafe ones", () => {
    expect(isTenantKey("emb_siteA_x7k2")).toBe(true);
    expect(isTenantKey("short")).toBe(false);
    expect(isTenantKey("has space")).toBe(false);
  });

  it("boots from search and sends X-Fms-Tenant only when k is valid", () => {
    bootTenantFromSearch("?k=emb_siteA_x7k2&appId=40&token=v2:secret");
    expect(currentTenantKey()).toBe("emb_siteA_x7k2");
    expect(currentAppId()).toBe(40);
    expect(tenantHeaders()).toEqual({ "X-Fms-Tenant": "emb_siteA_x7k2" });
  });

  it("ignores an invalid k and keeps the default app", () => {
    bootTenantFromSearch("?k=no&appId=36");
    expect(currentTenantKey()).toBe("");
    expect(currentAppId()).toBe(36);
    expect(tenantHeaders()).toEqual({});
  });
});
