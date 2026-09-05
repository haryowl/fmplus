/**
 * AES-256-GCM helpers for Armada tokens at rest.
 * Set FMS_SECRETS_KEY to 32+ char secret (or 64 hex chars).
 */
import crypto from "node:crypto";

const PREFIX = "v1:";

function keyBytes() {
  const raw = String(process.env.FMS_SECRETS_KEY || "").trim();
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

export function secretsKeyConfigured() {
  return Boolean(keyBytes());
}

/** @param {string} plaintext */
export function encryptSecret(plaintext) {
  const key = keyBytes();
  if (!key) throw new Error("FMS_SECRETS_KEY is required to store secrets in Postgres");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ivB64 = iv.toString("base64url");
  const tagB64 = tag.toString("base64url");
  const dataB64 = enc.toString("base64url");
  return `${PREFIX}${ivB64}.${tagB64}.${dataB64}`;
}

/** @param {string} ciphertext */
export function decryptSecret(ciphertext) {
  const key = keyBytes();
  if (!key) throw new Error("FMS_SECRETS_KEY is required to read secrets from Postgres");
  const body = String(ciphertext || "");
  if (!body.startsWith(PREFIX)) throw new Error("Unsupported secret ciphertext version");
  const [ivB64, tagB64, dataB64] = body.slice(PREFIX.length).split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Corrupt secret ciphertext");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** @param {string} secret */
export function hashWebhookSecret(secret) {
  return crypto.createHash("sha256").update(String(secret), "utf8").digest("hex");
}

/** @param {string} secret @param {string | null | undefined} hash */
export function verifyWebhookSecret(secret, hash) {
  if (!hash) return false;
  const a = Buffer.from(hashWebhookSecret(secret), "hex");
  const b = Buffer.from(String(hash), "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
