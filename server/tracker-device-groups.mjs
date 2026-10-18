/**
 * Tenant fleet / device groups (M2M membership).
 */
import { dbQuery } from "./db.mjs";

function cleanName(v) {
  return String(v || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

function cleanDescription(v) {
  return String(v || "").trim().slice(0, 500);
}

export function publicDeviceGroup(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name || "",
    description: row.description || "",
    sortOrder: Number(row.sort_order) || 0,
    memberCount: row.member_count == null ? undefined : Number(row.member_count),
    deviceIds: Array.isArray(row.device_ids) ? row.device_ids : undefined,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

export async function listDeviceGroups(tenantId, { includeMembers = false } = {}) {
  if (includeMembers) {
    const rows = await dbQuery(
      `SELECT g.*,
              COALESCE(
                (SELECT count(*)::int FROM tracker_device_group_members m WHERE m.group_id = g.id),
                0
              ) AS member_count,
              COALESCE(
                (SELECT array_agg(m.device_id ORDER BY m.device_id)
                 FROM tracker_device_group_members m WHERE m.group_id = g.id),
                '{}'::uuid[]
              ) AS device_ids
       FROM tracker_device_groups g
       WHERE g.tenant_id = $1
       ORDER BY g.sort_order ASC, lower(g.name) ASC`,
      [tenantId],
    );
    return rows.rows.map((r) => publicDeviceGroup(r));
  }
  const rows = await dbQuery(
    `SELECT g.*,
            COALESCE(
              (SELECT count(*)::int FROM tracker_device_group_members m WHERE m.group_id = g.id),
              0
            ) AS member_count
     FROM tracker_device_groups g
     WHERE g.tenant_id = $1
     ORDER BY g.sort_order ASC, lower(g.name) ASC`,
    [tenantId],
  );
  return rows.rows.map((r) => publicDeviceGroup(r));
}

export async function getDeviceGroup(tenantId, groupId) {
  const rows = await dbQuery(
    `SELECT g.*,
            COALESCE(
              (SELECT count(*)::int FROM tracker_device_group_members m WHERE m.group_id = g.id),
              0
            ) AS member_count,
            COALESCE(
              (SELECT array_agg(m.device_id ORDER BY m.device_id)
               FROM tracker_device_group_members m WHERE m.group_id = g.id),
              '{}'::uuid[]
            ) AS device_ids
     FROM tracker_device_groups g
     WHERE g.tenant_id = $1 AND g.id = $2`,
    [tenantId, groupId],
  );
  return publicDeviceGroup(rows.rows[0] || null);
}

export async function createDeviceGroup(tenantId, body) {
  const name = cleanName(body.name);
  if (!name) {
    const err = new Error("Group name is required");
    err.status = 400;
    throw err;
  }
  const description = cleanDescription(body.description);
  const sortOrder =
    body.sortOrder != null && body.sortOrder !== ""
      ? Math.max(0, Math.min(9999, Math.round(Number(body.sortOrder)) || 0))
      : 0;
  try {
    const inserted = await dbQuery(
      `INSERT INTO tracker_device_groups (tenant_id, name, description, sort_order)
       VALUES ($1,$2,$3,$4)
       RETURNING *`,
      [tenantId, name, description, sortOrder],
    );
    const group = publicDeviceGroup({ ...inserted.rows[0], member_count: 0, device_ids: [] });
    const deviceIds = normalizeDeviceIdList(body.deviceIds ?? body.device_ids);
    if (deviceIds.length) {
      await setGroupMembers(tenantId, group.id, deviceIds);
      return getDeviceGroup(tenantId, group.id);
    }
    return group;
  } catch (err) {
    if (err?.code === "23505") {
      const e = new Error("A group with that name already exists");
      e.status = 409;
      throw e;
    }
    throw err;
  }
}

export async function updateDeviceGroup(tenantId, groupId, body) {
  const current = await getDeviceGroup(tenantId, groupId);
  if (!current) {
    const err = new Error("Group not found");
    err.status = 404;
    throw err;
  }
  const name = body.name !== undefined ? cleanName(body.name) : current.name;
  if (!name) {
    const err = new Error("Group name is required");
    err.status = 400;
    throw err;
  }
  const description =
    body.description !== undefined ? cleanDescription(body.description) : current.description;
  const sortOrder =
    body.sortOrder !== undefined
      ? Math.max(0, Math.min(9999, Math.round(Number(body.sortOrder)) || 0))
      : current.sortOrder;
  try {
    await dbQuery(
      `UPDATE tracker_device_groups
       SET name = $3, description = $4, sort_order = $5, updated_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, groupId, name, description, sortOrder],
    );
  } catch (err) {
    if (err?.code === "23505") {
      const e = new Error("A group with that name already exists");
      e.status = 409;
      throw e;
    }
    throw err;
  }
  if (body.deviceIds !== undefined || body.device_ids !== undefined) {
    await setGroupMembers(tenantId, groupId, normalizeDeviceIdList(body.deviceIds ?? body.device_ids));
  }
  return getDeviceGroup(tenantId, groupId);
}

export async function deleteDeviceGroup(tenantId, groupId) {
  const deleted = await dbQuery(
    `DELETE FROM tracker_device_groups WHERE tenant_id = $1 AND id = $2 RETURNING id`,
    [tenantId, groupId],
  );
  if (!deleted.rows[0]) {
    const err = new Error("Group not found");
    err.status = 404;
    throw err;
  }
  return { ok: true };
}

function normalizeDeviceIdList(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const id of raw) {
    const s = String(id || "").trim().toLowerCase();
    if (!/^[0-9a-f-]{36}$/.test(s) || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** Replace membership for a group (only devices owned by the same tenant). */
export async function setGroupMembers(tenantId, groupId, deviceIds) {
  const owned = await dbQuery(
    `SELECT id FROM tracker_device_groups WHERE tenant_id = $1 AND id = $2`,
    [tenantId, groupId],
  );
  if (!owned.rows[0]) {
    const err = new Error("Group not found");
    err.status = 404;
    throw err;
  }
  const ids = normalizeDeviceIdList(deviceIds);
  let validIds = [];
  if (ids.length) {
    const devices = await dbQuery(
      `SELECT id FROM tracker_devices WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, ids],
    );
    validIds = devices.rows.map((r) => r.id);
  }
  await dbQuery(`DELETE FROM tracker_device_group_members WHERE group_id = $1`, [groupId]);
  for (const deviceId of validIds) {
    await dbQuery(
      `INSERT INTO tracker_device_group_members (group_id, device_id)
       VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [groupId, deviceId],
    );
  }
  return getDeviceGroup(tenantId, groupId);
}

/** Add one device to a group. */
export async function addGroupMember(tenantId, groupId, deviceId) {
  const device = String(deviceId || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(device)) {
    const err = new Error("Invalid deviceId");
    err.status = 400;
    throw err;
  }
  const ok = await dbQuery(
    `SELECT g.id
     FROM tracker_device_groups g
     JOIN tracker_devices d ON d.tenant_id = g.tenant_id AND d.id = $3
     WHERE g.tenant_id = $1 AND g.id = $2`,
    [tenantId, groupId, device],
  );
  if (!ok.rows[0]) {
    const err = new Error("Group or device not found");
    err.status = 404;
    throw err;
  }
  await dbQuery(
    `INSERT INTO tracker_device_group_members (group_id, device_id)
     VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [groupId, device],
  );
  return getDeviceGroup(tenantId, groupId);
}

export async function removeGroupMember(tenantId, groupId, deviceId) {
  const owned = await dbQuery(
    `SELECT id FROM tracker_device_groups WHERE tenant_id = $1 AND id = $2`,
    [tenantId, groupId],
  );
  if (!owned.rows[0]) {
    const err = new Error("Group not found");
    err.status = 404;
    throw err;
  }
  await dbQuery(
    `DELETE FROM tracker_device_group_members WHERE group_id = $1 AND device_id = $2`,
    [groupId, deviceId],
  );
  return getDeviceGroup(tenantId, groupId);
}

/** Map device_id → group summaries for a tenant (for last-status enrichment). */
export async function groupSummariesByDeviceIds(tenantId, deviceIds) {
  const ids = normalizeDeviceIdList(deviceIds);
  /** @type {Map<string, Array<{ id: string, name: string }>>} */
  const map = new Map();
  if (!ids.length) return map;
  const rows = await dbQuery(
    `SELECT m.device_id, g.id AS group_id, g.name
     FROM tracker_device_group_members m
     JOIN tracker_device_groups g ON g.id = m.group_id
     WHERE g.tenant_id = $1 AND m.device_id = ANY($2::uuid[])
     ORDER BY g.sort_order ASC, lower(g.name) ASC`,
    [tenantId, ids],
  );
  for (const r of rows.rows) {
    const list = map.get(r.device_id) || [];
    list.push({ id: r.group_id, name: r.name });
    map.set(r.device_id, list);
  }
  return map;
}

/** Device ids that belong to any of the given group ids (tenant-scoped). */
export async function deviceIdsInGroups(tenantId, groupIds) {
  const ids = normalizeDeviceIdList(groupIds);
  if (!ids.length) return [];
  const rows = await dbQuery(
    `SELECT DISTINCT m.device_id
     FROM tracker_device_group_members m
     JOIN tracker_device_groups g ON g.id = m.group_id
     WHERE g.tenant_id = $1 AND g.id = ANY($2::uuid[])`,
    [tenantId, ids],
  );
  return rows.rows.map((r) => r.device_id);
}
