/**
 * Resolve a tenant tracker device for Dispatch / Maintenance attachment.
 */
import { dbQuery } from "./db.mjs";

/**
 * @param {string} tenantId
 * @param {unknown} rawId
 * @returns {Promise<{ id: string, label: string, imei: string, armadaUserId: number|null }|null>}
 */
export async function resolveTenantTrackerDevice(tenantId, rawId) {
  const id = String(rawId || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await dbQuery(
    `SELECT id, label, imei, armada_user_id
     FROM tracker_devices
     WHERE tenant_id = $1 AND id = $2 AND enabled = true`,
    [tenantId, id],
  );
  const row = rows.rows[0];
  if (!row) return null;
  const armada =
    row.armada_user_id == null ? null : Number(row.armada_user_id);
  return {
    id: String(row.id),
    label: String(row.label || row.imei || "").trim() || String(row.imei || id),
    imei: String(row.imei || ""),
    armadaUserId: Number.isInteger(armada) && armada > 0 ? armada : null,
  };
}
