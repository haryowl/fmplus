import { mkdtemp, readFile, rm, writeFile, mkdir, utimes, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CACHE_MAX_AGE_DAYS,
  TODAY_SOFT_CACHE_MS_DEFAULT,
  dayCacheLookup,
  dayCachePath,
  isPastDay,
  maybePurgeDayCache,
  readCachedDay,
  resetPurgeClock,
  shouldWriteDayCache,
  tenantCacheScope,
  todayKeyFromOffset,
  todaySoftCacheMs,
  writeCachedDay,
} from "../../server/day-tracks-cache.mjs";

describe("tenantCacheScope", () => {
  it("keeps safe tenant keys and maps empty to _default", () => {
    expect(tenantCacheScope("emb_siteA_x7k2")).toBe("emb_siteA_x7k2");
    expect(tenantCacheScope("")).toBe("_default");
    expect(tenantCacheScope("../evil")).toBe("_default");
  });
});

describe("isPastDay", () => {
  it("only treats days strictly before today as past", () => {
    expect(isPastDay("2026-08-31", "2026-09-04")).toBe(true);
    expect(isPastDay("2026-09-04", "2026-09-04")).toBe(false);
    expect(isPastDay("2026-09-05", "2026-09-04")).toBe(false);
  });
});

describe("dayCacheLookup / shouldWriteDayCache", () => {
  const prev = process.env.DAY_TRACKS_TODAY_SOFT_CACHE_MS;

  afterEach(() => {
    if (prev === undefined) delete process.env.DAY_TRACKS_TODAY_SOFT_CACHE_MS;
    else process.env.DAY_TRACKS_TODAY_SOFT_CACHE_MS = prev;
  });

  it("soft-caches today with TTL and never touches mtime on hit", () => {
    expect(todaySoftCacheMs()).toBe(TODAY_SOFT_CACHE_MS_DEFAULT);
    expect(dayCacheLookup("2026-09-04", "2026-09-04")).toEqual({
      maxAgeMs: TODAY_SOFT_CACHE_MS_DEFAULT,
      touch: false,
    });
    expect(shouldWriteDayCache("2026-09-04", "2026-09-04")).toBe(true);
    expect(dayCacheLookup("2026-09-03", "2026-09-04")).toEqual({ touch: true });
    expect(dayCacheLookup("2026-09-05", "2026-09-04")).toBeNull();
    expect(shouldWriteDayCache("2026-09-05", "2026-09-04")).toBe(false);
  });

  it("disables today soft-cache when env is 0", () => {
    process.env.DAY_TRACKS_TODAY_SOFT_CACHE_MS = "0";
    expect(todaySoftCacheMs()).toBe(0);
    expect(dayCacheLookup("2026-09-04", "2026-09-04")).toBeNull();
    expect(shouldWriteDayCache("2026-09-04", "2026-09-04")).toBe(false);
  });
});

describe("todayKeyFromOffset", () => {
  it("shifts the calendar day by timezone offset", () => {
    // 2026-09-03 22:00 UTC → still 03 in UTC, already 04 in +08
    const ms = Date.parse("2026-09-03T22:00:00.000Z");
    expect(todayKeyFromOffset("+00:00", ms)).toBe("2026-09-03");
    expect(todayKeyFromOffset("+08:00", ms)).toBe("2026-09-04");
  });
});

describe("day cache files", () => {
  let dir = "";
  const prevDir = process.env.DAY_TRACKS_CACHE_DIR;
  const prevTtl = process.env.DAY_TRACKS_TODAY_SOFT_CACHE_MS;

  afterEach(async () => {
    if (prevDir === undefined) delete process.env.DAY_TRACKS_CACHE_DIR;
    else process.env.DAY_TRACKS_CACHE_DIR = prevDir;
    if (prevTtl === undefined) delete process.env.DAY_TRACKS_TODAY_SOFT_CACHE_MS;
    else process.env.DAY_TRACKS_TODAY_SOFT_CACHE_MS = prevTtl;
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = "";
    resetPurgeClock();
  });

  it("writes and reads slimmed points under tenant/app/user/date", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "day-cache-"));
    process.env.DAY_TRACKS_CACHE_DIR = dir;
    await writeCachedDay("emb_siteA_x7k2", 36, 1859, "2026-08-01", '[{"utc":"2026-08-01T01:00:00Z"}]');
    expect(dayCachePath("emb_siteA_x7k2", 36, 1859, "2026-08-01")).toBe(
      path.join(dir, "emb_siteA_x7k2", "36", "1859", "2026-08-01.json"),
    );
    expect(await readCachedDay("emb_siteA_x7k2", 36, 1859, "2026-08-01")).toBe(
      '[{"utc":"2026-08-01T01:00:00Z"}]',
    );
    expect(await readCachedDay("emb_siteA_x7k2", 36, 1859, "2026-08-02")).toBeNull();
  });

  it("refuses to write non-array payloads", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "day-cache-"));
    process.env.DAY_TRACKS_CACHE_DIR = dir;
    await writeCachedDay("_default", 36, 1, "2026-08-01", '{"failed":true}');
    expect(await readCachedDay("_default", 36, 1, "2026-08-01")).toBeNull();
  });

  it("serves today within soft-cache TTL and misses after it expires", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "day-cache-"));
    process.env.DAY_TRACKS_CACHE_DIR = dir;
    process.env.DAY_TRACKS_TODAY_SOFT_CACHE_MS = String(3 * 60 * 1000);
    const payload = '[{"utc":"2026-09-07T01:00:00Z"}]';
    await writeCachedDay("_default", 36, 42, "2026-09-07", payload);
    const file = dayCachePath("_default", 36, 42, "2026-09-07");
    const now = Date.now();
    const fresh = now - 60_000;
    await utimes(file, new Date(fresh), new Date(fresh));

    const lookup = dayCacheLookup("2026-09-07", "2026-09-07");
    expect(await readCachedDay("_default", 36, 42, "2026-09-07", { ...lookup, nowMs: now })).toBe(payload);
    // Soft-cache hits must not bump mtime (TTL is from write).
    const st = await stat(file);
    expect(Math.abs(st.mtimeMs - fresh)).toBeLessThan(2000);

    const stale = now - 4 * 60 * 1000;
    await utimes(file, new Date(stale), new Date(stale));
    expect(await readCachedDay("_default", 36, 42, "2026-09-07", { ...lookup, nowMs: now })).toBeNull();
  });

  it("purges files older than the retention window", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "day-cache-"));
    process.env.DAY_TRACKS_CACHE_DIR = dir;
    const file = path.join(dir, "_default", "36", "1", "2026-01-01.json");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "[]", "utf8");
    const old = new Date(Date.now() - (CACHE_MAX_AGE_DAYS + 2) * 86_400_000);
    await utimes(file, old, old);
    resetPurgeClock();
    const result = await maybePurgeDayCache();
    expect(result.removed).toBe(1);
    await expect(readFile(file, "utf8")).rejects.toThrow();
  });
});
