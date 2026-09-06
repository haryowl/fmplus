/**
 * Tenant parts/service catalog for maintenance lines.
 */
import { dbQuery } from "./db.mjs";

const DEFAULT_ITEMS = {
  part: [
    { name: "Oil", unitPrice: null, unitCost: null },
    { name: "Brake Pad", unitPrice: null, unitCost: null },
    { name: "Tire", unitPrice: null, unitCost: null },
    { name: "Filter", unitPrice: null, unitCost: null },
    { name: "Battery", unitPrice: null, unitCost: null },
  ],
  service: [
    { name: "Routine service", unitPrice: null, unitCost: null },
    { name: "Broke service", unitPrice: null, unitCost: null },
    { name: "Inspection", unitPrice: null, unitCost: null },
  ],
  other: [],
};

export function publicCatalogGroup(row, items = []) {
  return {
    id: row.id,
    key: row.key,
    name: row.name || "",
    sortOrder: Number(row.sort_order) || 0,
    items: items.map(publicCatalogItem),
  };
}

export function publicCatalogItem(row) {
  return {
    id: row.id,
    groupId: row.group_id,
    groupKey: row.group_key || row.key || "",
    name: row.name || "",
    unitPrice: row.unit_price == null ? null : Number(row.unit_price),
    unitCost: row.unit_cost == null ? null : Number(row.unit_cost),
    enabled: row.enabled !== false,
    sortOrder: Number(row.sort_order) || 0,
  };
}

/** Ensure Part / Service / Others groups (+ default items) exist for tenant. */
export async function ensureCatalog(tenantId) {
  const existing = await dbQuery(
    `SELECT id, key, name, sort_order FROM maintenance_catalog_groups WHERE tenant_id = $1`,
    [tenantId],
  );
  const byKey = new Map(existing.rows.map((r) => [r.key, r]));
  const seeds = [
    { key: "part", name: "Part", sort: 0 },
    { key: "service", name: "Service", sort: 1 },
    { key: "other", name: "Others", sort: 2 },
  ];
  for (const s of seeds) {
    if (byKey.has(s.key)) continue;
    const inserted = await dbQuery(
      `INSERT INTO maintenance_catalog_groups (tenant_id, key, name, sort_order)
       VALUES ($1,$2,$3,$4) RETURNING id, key, name, sort_order`,
      [tenantId, s.key, s.name, s.sort],
    );
    byKey.set(s.key, inserted.rows[0]);
    for (let i = 0; i < (DEFAULT_ITEMS[s.key] || []).length; i += 1) {
      const it = DEFAULT_ITEMS[s.key][i];
      await dbQuery(
        `INSERT INTO maintenance_catalog_items
           (tenant_id, group_id, name, unit_price, unit_cost, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [tenantId, inserted.rows[0].id, it.name, it.unitPrice, it.unitCost, i],
      );
    }
  }
  return loadCatalog(tenantId);
}

export async function loadCatalog(tenantId) {
  const groups = await dbQuery(
    `SELECT id, key, name, sort_order FROM maintenance_catalog_groups
     WHERE tenant_id = $1 ORDER BY sort_order ASC, name ASC`,
    [tenantId],
  );
  const items = await dbQuery(
    `SELECT i.id, i.group_id, i.name, i.unit_price, i.unit_cost, i.enabled, i.sort_order, g.key AS group_key
     FROM maintenance_catalog_items i
     JOIN maintenance_catalog_groups g ON g.id = i.group_id
     WHERE i.tenant_id = $1
     ORDER BY i.sort_order ASC, i.name ASC`,
    [tenantId],
  );
  const byGroup = new Map();
  for (const it of items.rows) {
    const list = byGroup.get(it.group_id) || [];
    list.push(it);
    byGroup.set(it.group_id, list);
  }
  return groups.rows.map((g) => publicCatalogGroup(g, byGroup.get(g.id) || []));
}

export async function createCatalogItem(tenantId, body) {
  const groupId = String(body.groupId || "").trim();
  const name = String(body.name || "").trim().slice(0, 200);
  if (!groupId || !name) {
    const err = new Error("groupId and name are required");
    err.status = 400;
    throw err;
  }
  const g = await dbQuery(
    `SELECT id, key FROM maintenance_catalog_groups WHERE id = $1 AND tenant_id = $2`,
    [groupId, tenantId],
  );
  if (!g.rows[0]) {
    const err = new Error("Catalog group not found");
    err.status = 404;
    throw err;
  }
  if (g.rows[0].key === "other") {
    const err = new Error("Others is free-text only — do not add catalog items there");
    err.status = 400;
    throw err;
  }
  const unitPrice = body.unitPrice == null || body.unitPrice === "" ? null : Number(body.unitPrice);
  const unitCost = body.unitCost == null || body.unitCost === "" ? null : Number(body.unitCost);
  const sortOrder = Number(body.sortOrder);
  const inserted = await dbQuery(
    `INSERT INTO maintenance_catalog_items
       (tenant_id, group_id, name, unit_price, unit_cost, enabled, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, group_id, name, unit_price, unit_cost, enabled, sort_order`,
    [
      tenantId,
      groupId,
      name,
      Number.isFinite(unitPrice) ? unitPrice : null,
      Number.isFinite(unitCost) ? unitCost : null,
      body.enabled === false ? false : true,
      Number.isFinite(sortOrder) ? sortOrder : 0,
    ],
  );
  return publicCatalogItem({ ...inserted.rows[0], group_key: g.rows[0].key });
}

export async function updateCatalogItem(tenantId, itemId, body) {
  const found = await dbQuery(
    `SELECT i.*, g.key AS group_key FROM maintenance_catalog_items i
     JOIN maintenance_catalog_groups g ON g.id = i.group_id
     WHERE i.id = $1 AND i.tenant_id = $2`,
    [itemId, tenantId],
  );
  if (!found.rows[0]) {
    const err = new Error("Catalog item not found");
    err.status = 404;
    throw err;
  }
  const row = found.rows[0];
  const name =
    body.name !== undefined ? String(body.name || "").trim().slice(0, 200) || row.name : row.name;
  let unitPrice = row.unit_price;
  if (body.unitPrice !== undefined) {
    unitPrice = body.unitPrice == null || body.unitPrice === "" ? null : Number(body.unitPrice);
    unitPrice = Number.isFinite(unitPrice) ? unitPrice : null;
  }
  let unitCost = row.unit_cost;
  if (body.unitCost !== undefined) {
    unitCost = body.unitCost == null || body.unitCost === "" ? null : Number(body.unitCost);
    unitCost = Number.isFinite(unitCost) ? unitCost : null;
  }
  const enabled = body.enabled !== undefined ? Boolean(body.enabled) : row.enabled !== false;
  const sortOrder =
    body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))
      ? Number(body.sortOrder)
      : row.sort_order;
  const updated = await dbQuery(
    `UPDATE maintenance_catalog_items SET
       name = $3, unit_price = $4, unit_cost = $5, enabled = $6, sort_order = $7, updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING id, group_id, name, unit_price, unit_cost, enabled, sort_order`,
    [itemId, tenantId, name, unitPrice, unitCost, enabled, sortOrder],
  );
  return publicCatalogItem({ ...updated.rows[0], group_key: row.group_key });
}

export async function deleteCatalogItem(tenantId, itemId) {
  const res = await dbQuery(
    `DELETE FROM maintenance_catalog_items WHERE id = $1 AND tenant_id = $2 RETURNING id`,
    [itemId, tenantId],
  );
  if (!res.rows[0]) {
    const err = new Error("Catalog item not found");
    err.status = 404;
    throw err;
  }
  return { ok: true };
}

/** Map line kind UI → DB (labor kept as legacy alias of service). */
export function normalizeLineKind(kind) {
  const k = String(kind || "").trim();
  if (k === "labor" || k === "service") return "service";
  if (k === "part") return "part";
  return "other";
}
