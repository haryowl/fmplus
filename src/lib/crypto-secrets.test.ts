import { describe, expect, it } from "vitest";

describe("crypto-secrets", () => {
  it("round-trips AES-GCM with FMS_SECRETS_KEY", async () => {
    process.env.FMS_SECRETS_KEY = "test-secret-key-for-unit-tests-only";
    const { encryptSecret, decryptSecret, hashWebhookSecret, verifyWebhookSecret } = await import(
      "../../server/crypto-secrets.mjs"
    );
    const cipher = encryptSecret("v2:example-token");
    expect(cipher.startsWith("v1:")).toBe(true);
    expect(decryptSecret(cipher)).toBe("v2:example-token");
    const hash = hashWebhookSecret("shared");
    expect(verifyWebhookSecret("shared", hash)).toBe(true);
    expect(verifyWebhookSecret("other", hash)).toBe(false);
  });
});
