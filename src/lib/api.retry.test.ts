import { describe, expect, it } from "vitest";
import { isRetryableStatus, retryDelayMs } from "./api";
import { API_RETRY_CAP_MS } from "./config";

describe("isRetryableStatus", () => {
  it("retries Armada throttle and gateway failures", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(502)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(504)).toBe(true);
  });

  it("does not retry client or success statuses", () => {
    expect(isRetryableStatus(200)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
  });
});

describe("retryDelayMs", () => {
  it("honors Retry-After seconds, capped", () => {
    const res = new Response(null, { headers: { "Retry-After": "3" } });
    expect(retryDelayMs(res, 0)).toBe(3_000);
  });

  it("caps very large Retry-After values", () => {
    const res = new Response(null, { headers: { "Retry-After": "999" } });
    expect(retryDelayMs(res, 0)).toBe(20_000);
  });

  it("uses exponential backoff when there is no header", () => {
    expect(retryDelayMs(null, 0)).toBe(400);
    expect(retryDelayMs(null, 3)).toBe(3_200);
    expect(retryDelayMs(null, 20)).toBe(API_RETRY_CAP_MS);
  });
});
