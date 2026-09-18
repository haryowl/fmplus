import { describe, expect, it } from "vitest";
import {
  checkPingRateLimit,
  MAX_PINGS_PER_BATCH,
  normalizePing,
  PING_MAX_BODY_BYTES,
} from "../../server/driver-pings.mjs";

const NOW = Date.parse("2026-09-17T10:00:00Z");

describe("normalizePing", () => {
  it("accepts a well-formed fix", () => {
    const res = normalizePing(
      {
        lat: -6.2,
        lon: 106.8,
        accuracyM: 12,
        speedMps: 8.3,
        headingDeg: 90,
        recordedAt: "2026-09-17T09:59:30Z",
      },
      NOW,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.ping.lat).toBeCloseTo(-6.2);
    expect(res.ping.lon).toBeCloseTo(106.8);
    expect(res.ping.recordedAt).toBe("2026-09-17T09:59:30.000Z");
  });

  it("accepts epoch millisecond timestamps", () => {
    const res = normalizePing({ lat: 1, lon: 2, timestamp: NOW - 5000 }, NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.ping.recordedAt).toBe(new Date(NOW - 5000).toISOString());
  });

  it("defaults a missing timestamp to now", () => {
    const res = normalizePing({ lat: 1, lon: 2 }, NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.ping.recordedAt).toBe(new Date(NOW).toISOString());
  });

  it("clamps a handset clock running ahead", () => {
    const res = normalizePing({ lat: 1, lon: 2, timestamp: NOW + 10 * 60_000 }, NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.ping.recordedAt).toBe(new Date(NOW).toISOString());
  });

  it("rejects missing or out-of-range coordinates", () => {
    expect(normalizePing({ lon: 106 }, NOW)).toMatchObject({ ok: false, reason: "no_coords" });
    expect(normalizePing({ lat: 91, lon: 0 }, NOW)).toMatchObject({
      ok: false,
      reason: "out_of_range",
    });
  });

  it("rejects the 0/0 not-ready sentinel", () => {
    expect(normalizePing({ lat: 0, lon: 0 }, NOW)).toMatchObject({
      ok: false,
      reason: "null_island",
    });
  });

  it("rejects stale and very coarse fixes", () => {
    expect(normalizePing({ lat: 1, lon: 2, timestamp: NOW - 7 * 60 * 60_000 }, NOW)).toMatchObject({
      ok: false,
      reason: "too_old",
    });
    expect(normalizePing({ lat: 1, lon: 2, accuracyM: 5000 }, NOW)).toMatchObject({
      ok: false,
      reason: "too_coarse",
    });
  });

  it("drops a malformed jobId instead of failing the fix", () => {
    const res = normalizePing({ lat: 1, lon: 2, jobId: "nope" }, NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.ping.jobId).toBeNull();
  });

  it("keeps a valid jobId", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const res = normalizePing({ lat: 1, lon: 2, jobId: id }, NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.ping.jobId).toBe(id);
  });

  it("nulls implausible speed and heading rather than rejecting", () => {
    const res = normalizePing({ lat: 1, lon: 2, speedMps: -4, headingDeg: 720 }, NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.ping.speedMps).toBeNull();
    expect(res.ping.headingDeg).toBeNull();
  });
});

describe("checkPingRateLimit", () => {
  it("allows a normal flush cadence and then throttles a flood", () => {
    const user = `user-${Math.random()}`;
    for (let i = 0; i < 10; i++) {
      expect(checkPingRateLimit(user, NOW + i).ok).toBe(true);
    }
    const blocked = checkPingRateLimit(user, NOW + 11);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("recovers once the window slides", () => {
    const user = `user-${Math.random()}`;
    for (let i = 0; i < 10; i++) checkPingRateLimit(user, NOW + i);
    expect(checkPingRateLimit(user, NOW + 61_000).ok).toBe(true);
  });

  it("tracks drivers independently", () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    for (let i = 0; i < 10; i++) checkPingRateLimit(a, NOW + i);
    expect(checkPingRateLimit(a, NOW + 11).ok).toBe(false);
    expect(checkPingRateLimit(b, NOW + 11).ok).toBe(true);
  });
});

describe("ingest limits", () => {
  it("keeps the batch and body caps small enough for a hot endpoint", () => {
    expect(MAX_PINGS_PER_BATCH).toBe(50);
    expect(PING_MAX_BODY_BYTES).toBeLessThanOrEqual(64 * 1024);
  });
});
