import { mkdtemp, readFile, rm, writeFile, mkdir, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CACHE_MAX_AGE_DAYS,
  dayCachePath,
  isPastDay,
  maybePurgeDayCache,
  readCachedDay,
  resetPurgeClock,
  tenantCacheScope,
  todayKeyFromOffset,
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
  it("only caches days strictly before today", () => {
    expect(isPastDay("2026-08-31", "2026-09-04")).toBe(true);
    expect(isPastDay("2026-09-04", "2026-09-04")).toBe(false);
    expect(isPastDay("2026-09-05", "2026-09-04")).toBe(false);
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
  const prev = process.env.DAY_TRACKS_CACHE_DIR;

  afterEach(async () => {
    if (prev === undefined) delete process.env.DAY_TRACKS_CACHE_DIR;
    else process.env.DAY_TRACKS_CACHE_DIR = prev;
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
