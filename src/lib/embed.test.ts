import { describe, expect, it } from "vitest";
import { EMBED_SET, originAllowed, parseEmbedSearch, parseHostMessage } from "./embed";

describe("parseEmbedSearch", () => {
  it("reads host vehicle context and ignores auth params", () => {
    const cfg = parseEmbedSearch(
      "?embed=1&groupId=12&userId=99&from=2026-08-01&to=2026-08-31&tz=+07:00&period=weekly&token=v2:secret&auth=nope",
    );
    expect(cfg).toEqual({
      compact: true,
      groupId: "12",
      userId: "99",
      from: "2026-08-01",
      to: "2026-08-31",
      tz: "+07:00",
      period: "weekly",
      lock: { group: true, user: true, from: true, to: true, tz: true },
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
    expect(JSON.stringify(cfg)).not.toContain("v2:no");
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
});
