import { describe, expect, it } from "vitest";
import { isRetryableArmadaStatus, retryWaitMs } from "../../server/armada-retry.mjs";

describe("retryWaitMs", () => {
  it("honours Retry-After seconds", () => {
    expect(retryWaitMs("5", 0)).toBe(5000);
  });

  it("backs off when Armada sends no header", () => {
    expect(retryWaitMs(undefined, 0)).toBe(1000);
    expect(retryWaitMs(undefined, 3)).toBe(8000);
  });
});

describe("isRetryableArmadaStatus", () => {
  it("retries rate limits and gateways, not 404", () => {
    expect(isRetryableArmadaStatus(429)).toBe(true);
    expect(isRetryableArmadaStatus(503)).toBe(true);
    expect(isRetryableArmadaStatus(404)).toBe(false);
  });
});
