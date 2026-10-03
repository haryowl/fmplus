/**
 * Tenant parts/service catalog for maintenance lines.
 */
import { dbQuery } from "./db.mjs";
import { deleteCodesForTarget, syncPrimarySku } from "./catalog-codes.mjs";

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
    sku: row.sku || "",
    unitPrice: row.unit_price == null ? null : Number(row.unit_price),
    unitCost: row.unit_cost == null ? null : Number(row.unit_cost),
    onHand: row.on_hand_qty == null ? null : Number(row.on_hand_qty),
    reservedQty: Number(row.reserved_qty) || 0,
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
    `SELECT i.id, i.group_id, i.name, i.sku, i.unit_price, i.unit_cost,
            i.on_hand_qty, i.reserved_qty, i.enabled, i.sort_order, g.key AS group_key
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
  const sku = String(body.sku || "").trim().slice(0, 80) || null;
  const onHand =
    body.onHand == null && body.on_hand == null && body.on_hand_qty == null
      ? null
      : Number(body.onHand ?? body.on_hand ?? body.on_hand_qty);
  const inserted = await dbQuery(
    `INSERT INTO maintenance_catalog_items
       (tenant_id, group_id, name, sku, unit_price, unit_cost, on_hand_qty, reserved_qty, enabled, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id, group_id, name, sku, unit_price, unit_cost, on_hand_qty, reserved_qty, enabled, sort_order`,
    [
      tenantId,
      groupId,
      name,
      sku,
      Number.isFinite(unitPrice) ? unitPrice : null,
      Number.isFinite(unitCost) ? unitCost : null,
      Number.isFinite(onHand) ? onHand : null,
      0,
      body.enabled === false ? false : true,
      Number.isFinite(sortOrder) ? sortOrder : 0,
    ],
  );
  const item = publicCatalogItem({ ...inserted.rows[0], group_key: g.rows[0].key });
  if (g.rows[0].key === "part") {
    await syncPrimarySku(tenantId, "maint_part", item.id, sku);
  }
  return item;
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
  const sku =
    body.sku !== undefined ? String(body.sku || "").trim().slice(0, 80) || null : row.sku;
  let onHand = row.on_hand_qty;
  if (body.onHand !== undefined || body.on_hand !== undefined || body.on_hand_qty !== undefined) {
    const raw = body.onHand ?? body.on_hand ?? body.on_hand_qty;
    onHand = raw == null || raw === "" ? null : Number(raw);
    onHand = Number.isFinite(onHand) ? onHand : null;
  }
  const updated = await dbQuery(
    `UPDATE maintenance_catalog_items SET
       name = $3, sku = $4, unit_price = $5, unit_cost = $6, on_hand_qty = $7,
       enabled = $8, sort_order = $9, updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING id, group_id, name, sku, unit_price, unit_cost, on_hand_qty, reserved_qty, enabled, sort_order`,
    [itemId, tenantId, name, sku, unitPrice, unitCost, onHand, enabled, sortOrder],
  );
  if (row.group_key === "part" && body.sku !== undefined) {
    await syncPrimarySku(tenantId, "maint_part", itemId, sku);
  }
  return publicCatalogItem({ ...updated.rows[0], group_key: row.group_key });
}

/** CSV kind cell → catalog group key. Others stays free text and is not imported. */
export function catalogKindFromCsv(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (["part", "parts"].includes(s)) return "part";
  if (["service", "labor"].includes(s)) return "service";
  return "";
}

function csvEnabledFlag(v) {
  if (v == null || String(v).trim() === "") return null;
  const s = String(v).trim().toLowerCase();
  if (["0", "no", "false", "off", "disabled"].includes(s)) return false;
  return true;
}

function csvNumOrNull(v) {
  if (v == null || String(v).trim() === "") return null;
  const n = Number(String(v).trim().replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Create or update Part / Service catalog rows.
 * Match an existing row in the same kind by SKU, then by name.
 */
export async function importCatalogItemsFromRows(tenantId, rawRows) {
  const rows = Array.isArray(rawRows) ? rawRows : [];
  if (rows.length > 500) {
    const err = new Error("Maximum 500 catalog rows per import");
    err.status = 400;
    throw err;
  }
  const groups = await ensureCatalog(tenantId);
  const groupByKey = new Map(groups.map((g) => [g.key, g]));
  const bySku = new Map();
  const byName = new Map();
  for (const group of groups) {
    for (const item of group.items || []) {
      if (item.sku) bySku.set(`${group.key}|${String(item.sku).toLowerCase()}`, item);
      byName.set(`${group.key}|${String(item.name).toLowerCase()}`, item);
    }
  }
  const created = [];
  const updated = [];
  const errors = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] && typeof rows[i] === "object" ? rows[i] : {};
    const line = i + 2;
    const kind = catalogKindFromCsv(row.kind || row.group || row.type || row.line_kind);
    const name = String(row.name || row.item || "").trim().slice(0, 200);
    if (!kind) {
      errors.push({ line, error: "kind must be part or service" });
      continue;
    }
    if (!name) {
      errors.push({ line, error: "name is required" });
      continue;
    }
    const group = groupByKey.get(kind);
    if (!group) {
      errors.push({ line, error: "Catalog group not found" });
      continue;
    }
    const sku =
      kind === "part" ? String(row.sku || "").trim().slice(0, 80) : "";
    const unitPrice = csvNumOrNull(row.unit_price ?? row.unitPrice ?? row.price);
    const unitCost = csvNumOrNull(row.unit_cost ?? row.unitCost ?? row.cost);
    const onHand = csvNumOrNull(row.on_hand ?? row.onHand ?? row.on_hand_qty);
    const enabled = csvEnabledFlag(row.enabled);
    try {
      const found =
        (sku && bySku.get(`${kind}|${sku.toLowerCase()}`)) ||
        byName.get(`${kind}|${name.toLowerCase()}`) ||
        null;
      if (found) {
        const patch = { name };
        if (kind === "part" && sku) patch.sku = sku;
        if (unitPrice != null) patch.unitPrice = unitPrice;
        if (unitCost != null) patch.unitCost = unitCost;
        if (kind === "part" && onHand != null) patch.onHand = onHand;
        if (enabled != null) patch.enabled = enabled;
        const item = await updateCatalogItem(tenantId, found.id, patch);
        updated.push(item);
        byName.delete(`${kind}|${String(found.name).toLowerCase()}`);
        if (found.sku) bySku.delete(`${kind}|${String(found.sku).toLowerCase()}`);
        byName.set(`${kind}|${item.name.toLowerCase()}`, item);
        if (item.sku) bySku.set(`${kind}|${item.sku.toLowerCase()}`, item);
      } else {
        const item = await createCatalogItem(tenantId, {
          groupId: group.id,
          name,
          sku: sku || undefined,
          unitPrice,
          unitCost,
          onHand: kind === "part" ? onHand : null,
          enabled: enabled !== false,
        });
        created.push(item);
        byName.set(`${kind}|${item.name.toLowerCase()}`, item);
        if (item.sku) bySku.set(`${kind}|${item.sku.toLowerCase()}`, item);
      }
    } catch (err) {
      errors.push({ line, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return {
    created: created.length,
    updated: updated.length,
    errors: errors.length,
    items: [...created, ...updated],
    errorRows: errors,
  };
}

export async function deleteCatalogItem(tenantId, itemId) {
  await deleteCodesForTarget(tenantId, "maint_part", itemId);
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
