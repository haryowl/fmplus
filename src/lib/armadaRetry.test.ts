import { describe, expect, it } from "vitest";
import {
  GATEWAY_GAP_MS,
  isRetryableArmadaStatus,
  planArmadaRetry,
  retryWaitMs,
} from "../../server/armada-retry.mjs";

describe("retryWaitMs", () => {
  it("honours Retry-After seconds", () => {
    expect(retryWaitMs("5", 0)).toBe(5000);
  });

  it("backs off when Armada sends no header", () => {
    expect(retryWaitMs(undefined, 0)).toBe(1000);
    expect(retryWaitMs(undefined, 3)).toBe(8000);
    expect(retryWaitMs(null, 3)).toBe(8000);
  });
});

describe("isRetryableArmadaStatus", () => {
  it("retries rate limits and gateways, not 404", () => {
    expect(isRetryableArmadaStatus(429)).toBe(true);
    expect(isRetryableArmadaStatus(503)).toBe(true);
    expect(isRetryableArmadaStatus(404)).toBe(false);
  });
});

describe("planArmadaRetry", () => {
  it("pauses the pool and drops cap only on 429", () => {
    expect(planArmadaRetry(429, "5", 1)).toEqual({ dropCap: true, cooldownMs: 5000 });
    expect(planArmadaRetry(429, null, 3).dropCap).toBe(true);
    expect(planArmadaRetry(429, null, 3).cooldownMs).toBe(8000);
  });

  it("requeues timeouts without stalling other workers", () => {
    expect(planArmadaRetry(0, null, 8)).toEqual({ dropCap: false, cooldownMs: 0 });
  });

  it("keeps concurrency on 5xx and only waits briefly unless Retry-After is set", () => {
    expect(planArmadaRetry(503, null, 10)).toEqual({ dropCap: false, cooldownMs: GATEWAY_GAP_MS });
    expect(planArmadaRetry(502, "2", 1)).toEqual({ dropCap: false, cooldownMs: 2000 });
    expect(planArmadaRetry(500, null, 4).dropCap).toBe(false);
  });
});
