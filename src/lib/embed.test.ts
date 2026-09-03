import { describe, expect, it } from "vitest";
import { EMBED_SET, originAllowed, originMatches, parseEmbedSearch, parseHostMessage } from "./embed";

describe("parseEmbedSearch", () => {
  it("reads host vehicle context and ignores auth params", () => {
    const cfg = parseEmbedSearch(
      "?embed=1&groupId=12&userId=99&from=2026-08-01&to=2026-08-31&tz=+07:00&period=weekly&token=v2:secret&auth=nope",
    );
    expect(cfg).toEqual({
      compact: true,
      tenantKey: "",
      appId: "",
      groupId: "12",
      userId: "99",
      from: "2026-08-01",
      to: "2026-08-31",
      tz: "+07:00",
      period: "weekly",
      lock: { group: false, user: false, from: false, to: false, tz: false },
    });
    expect(JSON.stringify(cfg).toLowerCase()).not.toContain("secret");
    expect(JSON.stringify(cfg).toLowerCase()).not.toContain("token");
  });

  it("rejects non-numeric ids and malformed dates", () => {
    const cfg = parseEmbedSearch("?groupId=abc&userId=12x&from=01-08-2026&auth_header=v2:x");
    expect(cfg.groupId).toBe("");
    expect(cfg.userId).toBe("");
    expect(cfg.from).toBe("");
    expect(cfg.compact).toBe(false);
    expect(cfg.lock).toEqual({ group: false, user: false, from: false, to: false, tz: false });
    expect(cfg.tenantKey).toBe("");
    expect(cfg.appId).toBe("");
  });

  it("reads opaque tenant key and public appId, not tokens", () => {
    const cfg = parseEmbedSearch("?embed=1&k=emb_siteA_x7k2&appId=40&userId=99&token=v2:secret");
    expect(cfg.tenantKey).toBe("emb_siteA_x7k2");
    expect(cfg.appId).toBe("40");
    expect(cfg.userId).toBe("99");
    expect(JSON.stringify(cfg).toLowerCase()).not.toContain("secret");
  });

  it("rejects short or unsafe tenant keys", () => {
    expect(parseEmbedSearch("?k=short").tenantKey).toBe("");
    expect(parseEmbedSearch("?k=has space!!").tenantKey).toBe("");
  });

  it("does not lock pickers when ids are last-used tab context, not an iframe embed", () => {
    const cfg = parseEmbedSearch("?groupId=12&userId=99&from=2026-08-01&tz=+08:00");
    expect(cfg.groupId).toBe("12");
    expect(cfg.userId).toBe("99");
    expect(cfg.lock).toEqual({ group: false, user: false, from: false, to: false, tz: false });
  });

  it("does not lock dates because a tenant key is in the URL", () => {
    const cfg = parseEmbedSearch("?k=emb_siteA_x7k2&from=2026-08-21&to=2026-09-03&tz=+08:00");
    expect(cfg.tenantKey).toBe("emb_siteA_x7k2");
    expect(cfg.lock).toEqual({ group: false, user: false, from: false, to: false, tz: false });
  });
});

describe("parseHostMessage", () => {
  it("accepts a typed host payload from an allowed origin", () => {
    const cfg = parseHostMessage(
      { type: EMBED_SET, groupId: "3", userId: "7", from: "2026-01-01", embed: true, token: "v2:no" },
      "https://host.example",
      ["https://host.example"],
      "http://localhost:5173",
    );
    expect(cfg?.userId).toBe("7");
    expect(cfg?.groupId).toBe("3");
    expect(cfg?.lock).toEqual({ group: false, user: false, from: false, to: false, tz: false });
    expect(JSON.stringify(cfg)).not.toContain("v2:no");
  });

  it("does not lock filters when Armada posts vehicle context", () => {
    const cfg = parseHostMessage(
      {
        type: EMBED_SET,
        embed: true,
        groupId: "12",
        userId: "99",
        from: "2026-08-01",
        to: "2026-08-31",
        tz: "+07:00",
      },
      "https://ops.armada.id",
      ["https://armada.id", "https://*.armada.id"],
      "http://localhost:5173",
    );
    expect(cfg?.groupId).toBe("12");
    expect(cfg?.lock).toEqual({ group: false, user: false, from: false, to: false, tz: false });
  });

  it("rejects other origins when no allowlist means same-origin only", () => {
    expect(
      originAllowed("https://evil.example", [], "http://localhost:5173"),
    ).toBe(false);
    expect(originAllowed("http://localhost:5173", [], "http://localhost:5173")).toBe(true);
    expect(
      parseHostMessage({ type: EMBED_SET, userId: "1" }, "https://evil.example", [], "http://localhost:5173"),
    ).toBeNull();
  });

  it("allows armada.id apex and any https subdomain", () => {
    const allow = ["https://armada.id", "https://*.armada.id"];
    expect(originMatches("https://armada.id", "https://*.armada.id")).toBe(true);
    expect(originMatches("https://ops.armada.id", "https://*.armada.id")).toBe(true);
    expect(originMatches("https://a.b.armada.id", "https://*.armada.id")).toBe(true);
    expect(originAllowed("https://ops.armada.id", allow, "http://localhost:5173")).toBe(true);
    expect(originAllowed("https://armada.id", allow, "http://localhost:5173")).toBe(true);
    expect(originAllowed("http://ops.armada.id", allow, "http://localhost:5173")).toBe(false);
    expect(originAllowed("https://evil.example", allow, "http://localhost:5173")).toBe(false);
    expect(originAllowed("https://armada.id.evil.example", allow, "http://localhost:5173")).toBe(false);
  });
});
