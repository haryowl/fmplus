/**
 * Load tenants from Postgres into the in-memory vault (overlay on file/env).
 */
import { databaseUrlConfigured, dbQuery } from "./db.mjs";
import { decryptSecret, secretsKeyConfigured } from "./crypto-secrets.mjs";

/**
 * @param {(tenant: { key: string, appId: number, token: string, userIds: number[], groupIds: number[], entitlements?: object, enabled?: boolean, source: string }) => void} upsert
 */
export async function loadTenantsFromDatabase(upsert) {
  if (!databaseUrlConfigured()) return { loaded: 0, skipped: true };
  if (!secretsKeyConfigured()) {
    console.warn("[tenants] DATABASE_URL set but FMS_SECRETS_KEY missing — skip DB tenants");
    return { loaded: 0, skipped: true, reason: "no_secrets_key" };
  }
  const res = await dbQuery(
    `SELECT key, app_id, token_ciphertext, user_ids, group_ids, entitlements, enabled, display_name
     FROM tenants
     WHERE enabled = true`,
  );
  let loaded = 0;
  for (const row of res.rows) {
    try {
      const token = decryptSecret(row.token_ciphertext);
      upsert({
        key: row.key,
        appId: Number(row.app_id),
        token,
        userIds: Array.isArray(row.user_ids) ? row.user_ids.map(Number) : [],
        groupIds: Array.isArray(row.group_ids) ? row.group_ids.map(Number) : [],
        entitlements: row.entitlements && typeof row.entitlements === "object" ? row.entitlements : {},
        enabled: row.enabled !== false,
        displayName: row.display_name || "",
        source: "database",
      });
      loaded += 1;
    } catch (err) {
      console.warn(`[tenants] skip key=${row.key}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return { loaded, skipped: false };
}
