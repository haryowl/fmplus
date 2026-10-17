import { describe, expect, it } from "vitest";
import { commandTypeProtocolMismatch } from "../../server/device-manager.mjs";

describe("commandTypeProtocolMismatch", () => {
  it("allows text/raw on any protocol", () => {
    expect(commandTypeProtocolMismatch("teltonika", "text")).toBe("");
    expect(commandTypeProtocolMismatch("concox", "raw")).toBe("");
  });

  it("rejects cross-protocol command types", () => {
    expect(commandTypeProtocolMismatch("teltonika", "concox_gprs")).toMatch(/not valid/);
    expect(commandTypeProtocolMismatch("concox", "jt808_8103")).toMatch(/not valid/);
    expect(commandTypeProtocolMismatch("json", "galileosky_text")).toMatch(/not valid/);
  });

  it("allows matching protocol command types", () => {
    expect(commandTypeProtocolMismatch("jt808", "jt808_8105")).toBe("");
    expect(commandTypeProtocolMismatch("subiao", "query_params")).toBe("");
    expect(commandTypeProtocolMismatch("teltonika", "teltonika_codec12")).toBe("");
    expect(commandTypeProtocolMismatch("ruptela", "ruptela_sms")).toBe("");
  });
});
