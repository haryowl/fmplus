/**
 * Tenant goods catalog and optional per-order cargo lines.
 * Lines snapshot name / unit / per-unit volume+weight at pick time.
 */
import { dbQuery } from "./db.mjs";

export const GOODS_UNITS = ["pcs", "box", "bag", "kg", "L"];
const MAX_LINES = 40;

export function parseGoodsUnit(v) {
  const s = String(v || "pcs").trim();
  return GOODS_UNITS.includes(s) ? s : "pcs";
}

export function numOrNullGoods(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function publicGoodsItem(row) {
  return {
    id: row.id,
    name: row.name || "",
    sku: row.sku || "",
    unit: parseGoodsUnit(row.unit),
    volumeM3Each: row.volume_m3_each == null ? null : Number(row.volume_m3_each),
    weightKgEach: row.weight_kg_each == null ? null : Number(row.weight_kg_each),
    enabled: row.enabled !== false,
    sortOrder: Number(row.sort_order) || 0,
    updatedAt: row.updated_at || null,
  };
}

export function publicOrderLine(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    catalogItemId: row.catalog_item_id || null,
    name: row.name || "",
    qty: Number(row.qty) || 0,
    unit: parseGoodsUnit(row.unit),
    volumeM3Each: row.volume_m3_each == null ? null : Number(row.volume_m3_each),
    weightKgEach: row.weight_kg_each == null ? null : Number(row.weight_kg_each),
    sortOrder: Number(row.sort_order) || 0,
  };
}

export function sumCargoTotals(lines) {
  let volumeM3 = 0;
  let weightKg = 0;
  let anyVol = false;
  let anyWt = false;
  for (const line of lines || []) {
    const qty = Math.max(0, Number(line.qty) || 0);
    const v = line.volumeM3Each ?? line.volume_m3_each;
    const w = line.weightKgEach ?? line.weight_kg_each;
    if (v != null && Number.isFinite(Number(v))) {
      volumeM3 += qty * Number(v);
      anyVol = true;
    }
    if (w != null && Number.isFinite(Number(w))) {
      weightKg += qty * Number(w);
      anyWt = true;
    }
  }
  return {
    volumeM3: anyVol ? Math.round(volumeM3 * 1000) / 1000 : null,
    weightKg: anyWt ? Math.round(weightKg * 10) / 10 : null,
  };
}

/**
 * Parse an optional order-CSV goods cell.
 * Accepts `Oil:2; Filter:1 box` or `Oil x 2 pcs | SKU-9:3`.
 */
export function parseOrderGoodsCell(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];
  const chunks =
    /[;|]/.test(text) ? text.split(/[;|]/) : /:|\s[x×]\s/i.test(text) ? text.split(",") : [text];
  const out = [];
  for (const chunk of chunks) {
    const s = chunk.trim();
    if (!s) continue;
    let m = s.match(/^(.+?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*([A-Za-z]+)?$/i);
    if (m) {
      out.push({ key: m[1].trim(), qty: Number(m[2]), unit: m[3] || "" });
      continue;
    }
    m = s.match(/^(.+?):(\d+(?:\.\d+)?)(?:[:\s]+([A-Za-z]+))?$/);
    if (m) {
      out.push({ key: m[1].trim(), qty: Number(m[2]), unit: m[3] || "" });
      continue;
    }
    out.push({ key: s, qty: 1, unit: "" });
  }
  return out.filter((p) => p.key && Number.isFinite(p.qty) && p.qty > 0);
}

export async function resolveCsvGoodsLines(tenantId, rawCell, extraRow = {}) {
  const parsed = parseOrderGoodsCell(rawCell);
  const extraName = String(extraRow.goods_name || extraRow.goodsName || "").trim();
  if (extraName && !parsed.some((p) => p.key.toLowerCase() === extraName.toLowerCase())) {
    const qty = Number(extraRow.goods_qty ?? extraRow.goodsQty ?? 1);
    parsed.push({
      key: extraName,
      qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
      unit: String(extraRow.goods_unit || extraRow.goodsUnit || ""),
    });
  }
  if (!parsed.length) return [];
  const catalog = await listGoodsItems(tenantId, { includeDisabled: true });
  const bySku = new Map();
  const byName = new Map();
  for (const item of catalog) {
    if (item.sku) bySku.set(item.sku.toLowerCase(), item);
    byName.set(item.name.toLowerCase(), item);
  }
  return parsed.slice(0, MAX_LINES).map((p, i) => {
    const item = bySku.get(p.key.toLowerCase()) || byName.get(p.key.toLowerCase()) || null;
    return {
      catalogItemId: item ? item.id : null,
      name: item ? item.name : p.key.slice(0, 200),
      qty: p.qty,
      unit: parseGoodsUnit(p.unit || item?.unit),
      volumeM3Each: item ? item.volumeM3Each : null,
      weightKgEach: item ? item.weightKgEach : null,
      sortOrder: i,
    };
  });
}

function csvEnabledFlag(v) {
  if (v == null || v === "") return true;
  const s = String(v).trim().toLowerCase();
  if (["0", "no", "false", "off", "disabled"].includes(s)) return false;
  return true;
}

export async function importGoodsItemsFromRows(tenantId, rawRows) {
  const rows = Array.isArray(rawRows) ? rawRows : [];
  if (rows.length > 500) {
    const err = new Error("Maximum 500 catalog rows per import");
    err.status = 400;
    throw err;
  }
  const created = [];
  const updated = [];
  const errors = [];
  const existing = await listGoodsItems(tenantId, { includeDisabled: true });
  const bySku = new Map();
  const byName = new Map();
  for (const item of existing) {
    if (item.sku) bySku.set(item.sku.toLowerCase(), item);
    byName.set(item.name.toLowerCase(), item);
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] && typeof rows[i] === "object" ? rows[i] : {};
    const line = i + 2;
    const name = String(row.name || row.item || "").trim().slice(0, 200);
    if (!name) {
      errors.push({ line, error: "name is required" });
      continue;
    }
    const sku = String(row.sku || "").trim().slice(0, 80);
    const body = {
      name,
      sku,
      unit: parseGoodsUnit(row.unit),
      volumeM3Each: numOrNullGoods(row.volume_m3_each ?? row.volumeM3Each),
      weightKgEach: numOrNullGoods(row.weight_kg_each ?? row.weightKgEach),
      enabled: csvEnabledFlag(row.enabled),
    };
    try {
      const found =
        (sku && bySku.get(sku.toLowerCase())) || byName.get(name.toLowerCase()) || null;
      if (found) {
        const item = await updateGoodsItem(tenantId, found.id, body);
        updated.push(item);
        if (item.sku) bySku.set(item.sku.toLowerCase(), item);
        byName.set(item.name.toLowerCase(), item);
      } else {
        const item = await createGoodsItem(tenantId, body);
        created.push(item);
        if (item.sku) bySku.set(item.sku.toLowerCase(), item);
        byName.set(item.name.toLowerCase(), item);
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

export function formatCargoSummary(lines, maxItems = 3) {
  const list = (lines || []).filter((l) => l && String(l.name || "").trim());
  if (!list.length) return "";
  const parts = list.slice(0, maxItems).map((l) => {
    const qty = Number(l.qty);
    const q = Number.isFinite(qty) ? String(qty) : "";
    const unit = parseGoodsUnit(l.unit);
    return [q, unit, String(l.name).trim()].filter(Boolean).join(" ");
  });
  const extra = list.length > maxItems ? ` +${list.length - maxItems}` : "";
  return `${parts.join(" · ")}${extra}`;
}

export async function listGoodsItems(tenantId, { includeDisabled = false } = {}) {
  const rows = await dbQuery(
    `SELECT * FROM dispatch_goods_items
     WHERE tenant_id = $1 ${includeDisabled ? "" : "AND enabled = true"}
     ORDER BY sort_order ASC, lower(name) ASC
     LIMIT 500`,
    [tenantId],
  );
  return rows.rows.map(publicGoodsItem);
}

export async function createGoodsItem(tenantId, body) {
  const name = String(body.name || "").trim().slice(0, 200);
  if (!name) {
    const err = new Error("name is required");
    err.status = 400;
    throw err;
  }
  const inserted = await dbQuery(
    `INSERT INTO dispatch_goods_items (
       tenant_id, name, sku, unit, volume_m3_each, weight_kg_each, enabled, sort_order
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      tenantId,
      name,
      String(body.sku || "").trim().slice(0, 80) || null,
      parseGoodsUnit(body.unit),
      numOrNullGoods(body.volumeM3Each ?? body.volume_m3_each),
      numOrNullGoods(body.weightKgEach ?? body.weight_kg_each),
      body.enabled === false ? false : true,
      Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
    ],
  );
  return publicGoodsItem(inserted.rows[0]);
}

export async function updateGoodsItem(tenantId, itemId, body) {
  const found = await dbQuery(
    `SELECT * FROM dispatch_goods_items WHERE id = $1 AND tenant_id = $2`,
    [itemId, tenantId],
  );
  if (!found.rows[0]) {
    const err = new Error("Goods item not found");
    err.status = 404;
    throw err;
  }
  const row = found.rows[0];
  const name =
    body.name !== undefined ? String(body.name || "").trim().slice(0, 200) || row.name : row.name;
  const sku =
    body.sku !== undefined ? String(body.sku || "").trim().slice(0, 80) || null : row.sku;
  const unit = body.unit !== undefined ? parseGoodsUnit(body.unit) : parseGoodsUnit(row.unit);
  let volume = row.volume_m3_each;
  if (body.volumeM3Each !== undefined || body.volume_m3_each !== undefined) {
    volume = numOrNullGoods(body.volumeM3Each ?? body.volume_m3_each);
  }
  let weight = row.weight_kg_each;
  if (body.weightKgEach !== undefined || body.weight_kg_each !== undefined) {
    weight = numOrNullGoods(body.weightKgEach ?? body.weight_kg_each);
  }
  const enabled = body.enabled !== undefined ? Boolean(body.enabled) : row.enabled !== false;
  const sortOrder =
    body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))
      ? Number(body.sortOrder)
      : row.sort_order;
  const updated = await dbQuery(
    `UPDATE dispatch_goods_items
     SET name = $3, sku = $4, unit = $5, volume_m3_each = $6, weight_kg_each = $7,
         enabled = $8, sort_order = $9, updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [itemId, tenantId, name, sku, unit, volume, weight, enabled, sortOrder],
  );
  return publicGoodsItem(updated.rows[0]);
}

export async function deleteGoodsItem(tenantId, itemId) {
  const res = await dbQuery(
    `DELETE FROM dispatch_goods_items WHERE id = $1 AND tenant_id = $2 RETURNING id`,
    [itemId, tenantId],
  );
  if (!res.rows[0]) {
    const err = new Error("Goods item not found");
    err.status = 404;
    throw err;
  }
  return { ok: true };
}

export async function loadLinesByOrderIds(tenantId, orderIds) {
  const ids = [...new Set((orderIds || []).filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;
  const rows = await dbQuery(
    `SELECT * FROM dispatch_order_lines
     WHERE tenant_id = $1 AND order_id = ANY($2::uuid[])
     ORDER BY sort_order ASC, created_at ASC`,
    [tenantId, ids],
  );
  for (const row of rows.rows) {
    const list = map.get(row.order_id) || [];
    list.push(publicOrderLine(row));
    map.set(row.order_id, list);
  }
  return map;
}

export async function decorateOrdersWithLines(tenantId, orders) {
  const map = await loadLinesByOrderIds(
    tenantId,
    (orders || []).map((o) => o.id),
  );
  return (orders || []).map((o) => ({
    ...o,
    lines: map.get(o.id) || o.lines || [],
  }));
}

export function withStopLines(job, linesByOrder) {
  if (!job) return job;
  return {
    ...job,
    stops: (job.stops || []).map((s) => ({
      ...s,
      lines: s.orderId && linesByOrder ? linesByOrder.get(s.orderId) || [] : s.lines || [],
    })),
  };
}

export async function decorateJobsWithLines(tenantId, jobs) {
  const ids = [];
  for (const job of jobs || []) {
    for (const s of job.stops || []) {
      if (s.orderId) ids.push(s.orderId);
    }
  }
  const map = await loadLinesByOrderIds(tenantId, ids);
  return (jobs || []).map((j) => withStopLines(j, map));
}

async function resolveLineSnapshots(tenantId, rawLines) {
  const incoming = Array.isArray(rawLines) ? rawLines.slice(0, MAX_LINES) : [];
  const catalogIds = incoming.map((l) => l.catalogItemId || l.catalog_item_id).filter(Boolean);
  const catalog = new Map();
  if (catalogIds.length) {
    const rows = await dbQuery(
      `SELECT * FROM dispatch_goods_items WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, catalogIds],
    );
    for (const row of rows.rows) catalog.set(row.id, row);
  }
  const out = [];
  for (let i = 0; i < incoming.length; i += 1) {
    const raw = incoming[i] && typeof incoming[i] === "object" ? incoming[i] : {};
    const catalogId = raw.catalogItemId || raw.catalog_item_id || null;
    const item = catalogId ? catalog.get(String(catalogId)) : null;
    const name = String(raw.name || item?.name || "").trim().slice(0, 200);
    const qty = Number(raw.qty);
    if (!name || !Number.isFinite(qty) || qty <= 0) continue;
    out.push({
      catalogItemId: item ? item.id : null,
      name,
      qty,
      unit: parseGoodsUnit(raw.unit || item?.unit),
      volumeM3Each:
        raw.volumeM3Each !== undefined || raw.volume_m3_each !== undefined
          ? numOrNullGoods(raw.volumeM3Each ?? raw.volume_m3_each)
          : item
            ? numOrNullGoods(item.volume_m3_each)
            : null,
      weightKgEach:
        raw.weightKgEach !== undefined || raw.weight_kg_each !== undefined
          ? numOrNullGoods(raw.weightKgEach ?? raw.weight_kg_each)
          : item
            ? numOrNullGoods(item.weight_kg_each)
            : null,
      sortOrder: i,
    });
  }
  return out;
}

export async function replaceOrderLines(tenantId, orderId, rawLines) {
  const lines = await resolveLineSnapshots(tenantId, rawLines);
  await dbQuery(`DELETE FROM dispatch_order_lines WHERE tenant_id = $1 AND order_id = $2`, [
    tenantId,
    orderId,
  ]);
  const saved = [];
  for (const line of lines) {
    const inserted = await dbQuery(
      `INSERT INTO dispatch_order_lines (
         tenant_id, order_id, catalog_item_id, name, qty, unit,
         volume_m3_each, weight_kg_each, sort_order
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        tenantId,
        orderId,
        line.catalogItemId,
        line.name,
        line.qty,
        line.unit,
        line.volumeM3Each,
        line.weightKgEach,
        line.sortOrder,
      ],
    );
    saved.push(publicOrderLine(inserted.rows[0]));
  }
  return saved;
}

export async function applyCargoTotals(tenantId, orderId, { locked = false } = {}) {
  if (locked) return null;
  const map = await loadLinesByOrderIds(tenantId, [orderId]);
  const lines = map.get(orderId) || [];
  if (!lines.length) return null;
  const totals = sumCargoTotals(lines);
  await dbQuery(
    `UPDATE dispatch_orders
     SET volume_m3 = $3, weight_kg = $4, updated_at = now()
     WHERE id = $1 AND tenant_id = $2`,
    [orderId, tenantId, totals.volumeM3, totals.weightKg],
  );
  await dbQuery(
    `UPDATE dispatch_stops
     SET volume_m3 = $2, weight_kg = $3
     WHERE order_id = $1
       AND (
         role = 'pickup'
         OR (
           role = 'drop'
           AND NOT EXISTS (
             SELECT 1 FROM dispatch_stops s2
             WHERE s2.order_id = dispatch_stops.order_id AND s2.role = 'pickup'
           )
         )
       )`,
    [orderId, totals.volumeM3, totals.weightKg],
  );
  return totals;
}

export async function setCargoTotalsLocked(tenantId, orderId, locked) {
  await dbQuery(
    `UPDATE dispatch_orders
     SET cargo_totals_locked = $3, updated_at = now()
     WHERE id = $1 AND tenant_id = $2`,
    [orderId, tenantId, Boolean(locked)],
  );
}
