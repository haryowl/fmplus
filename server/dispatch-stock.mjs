/**
 * Per-depot + truck stock ledger (manual adjust now; auto moves next).
 */
import { dbQuery } from "./db.mjs";
import { mergeEntitlements } from "./entitlements.mjs";
import { normalizeZoneKey } from "./dispatch-zone.mjs";
import { numOrNullGoods, qtyToBasePcs } from "./dispatch-goods.mjs";

export const STOCK_MOVE_KINDS = [
  "adjust",
  "receive",
  "write_off",
  "pickup",
  "delivery",
  "return",
];

export function parseStockSettings(entitlements) {
  const e = mergeEntitlements(entitlements);
  return {
    /** true = hard block when depot stock insufficient; false = warn only */
    stockHardBlock: e.features.dispatchStockHardBlock === true,
    /** true = cargo scan required to move stock; false = Finish is enough */
    stockRequireScan: e.features.dispatchStockRequireScan === true,
  };
}

export function publicStockBalance(row) {
  return {
    id: row.id,
    catalogItemId: row.catalog_item_id,
    depotId: row.depot_id,
    depotName: row.depot_name || "",
    onHand: Number(row.on_hand_qty) || 0,
    reservedQty: Number(row.reserved_qty) || 0,
    updatedAt: row.updated_at || null,
  };
}

export function publicTruckStock(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    catalogItemId: row.catalog_item_id,
    jobTitle: row.job_title || "",
    qty: Number(row.qty) || 0,
    updatedAt: row.updated_at || null,
  };
}

export function publicStockMovement(row) {
  return {
    id: row.id,
    catalogItemId: row.catalog_item_id,
    depotId: row.depot_id || null,
    jobId: row.job_id || null,
    orderId: row.order_id || null,
    kind: row.kind || "adjust",
    layer: row.layer || "depot",
    qtyDelta: Number(row.qty_delta) || 0,
    note: row.note || "",
    createdAt: row.created_at || null,
  };
}

export async function listStockBalances(tenantId, { catalogItemId = null, depotId = null } = {}) {
  const params = [tenantId];
  let filter = "";
  if (catalogItemId) {
    params.push(catalogItemId);
    filter += ` AND b.catalog_item_id = $${params.length}`;
  }
  if (depotId) {
    params.push(depotId);
    filter += ` AND b.depot_id = $${params.length}`;
  }
  const rows = await dbQuery(
    `SELECT b.*, d.name AS depot_name
     FROM dispatch_stock_balances b
     JOIN dispatch_depots d ON d.id = b.depot_id AND d.tenant_id = b.tenant_id
     WHERE b.tenant_id = $1 ${filter}
     ORDER BY lower(d.name) ASC, b.updated_at DESC
     LIMIT 2000`,
    params,
  );
  return rows.rows.map(publicStockBalance);
}

export async function listTruckStock(tenantId, { catalogItemId = null, jobId = null } = {}) {
  const params = [tenantId];
  let filter = "";
  if (catalogItemId) {
    params.push(catalogItemId);
    filter += ` AND t.catalog_item_id = $${params.length}`;
  }
  if (jobId) {
    params.push(jobId);
    filter += ` AND t.job_id = $${params.length}`;
  }
  const rows = await dbQuery(
    `SELECT t.*, j.title AS job_title
     FROM dispatch_truck_stock t
     JOIN dispatch_jobs j ON j.id = t.job_id AND j.tenant_id = t.tenant_id
     WHERE t.tenant_id = $1 AND t.qty > 0 ${filter}
     ORDER BY j.service_date DESC NULLS LAST, t.updated_at DESC
     LIMIT 1000`,
    params,
  );
  return rows.rows.map(publicTruckStock);
}

export async function listRecentStockMovements(tenantId, catalogItemId, limit = 20) {
  const rows = await dbQuery(
    `SELECT * FROM dispatch_stock_movements
     WHERE tenant_id = $1 AND catalog_item_id = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [tenantId, catalogItemId, Math.min(100, Math.max(1, Number(limit) || 20))],
  );
  return rows.rows.map(publicStockMovement);
}

async function ensureDepot(tenantId, depotId) {
  const found = await dbQuery(
    `SELECT id, name FROM dispatch_depots WHERE id = $1 AND tenant_id = $2`,
    [depotId, tenantId],
  );
  if (!found.rows[0]) {
    const err = new Error("Depot not found");
    err.status = 404;
    throw err;
  }
  return found.rows[0];
}

async function ensureGoodsItem(tenantId, catalogItemId) {
  const found = await dbQuery(
    `SELECT id, name, unit, units_per_pack, on_hand_qty
     FROM dispatch_goods_items WHERE id = $1 AND tenant_id = $2`,
    [catalogItemId, tenantId],
  );
  if (!found.rows[0]) {
    const err = new Error("Goods item not found");
    err.status = 404;
    throw err;
  }
  return found.rows[0];
}

async function getOrCreateBalance(tenantId, catalogItemId, depotId) {
  const existing = await dbQuery(
    `SELECT * FROM dispatch_stock_balances
     WHERE tenant_id = $1 AND catalog_item_id = $2 AND depot_id = $3`,
    [tenantId, catalogItemId, depotId],
  );
  if (existing.rows[0]) return existing.rows[0];
  const inserted = await dbQuery(
    `INSERT INTO dispatch_stock_balances (tenant_id, catalog_item_id, depot_id, on_hand_qty, reserved_qty)
     VALUES ($1,$2,$3,0,0)
     ON CONFLICT (tenant_id, catalog_item_id, depot_id) DO UPDATE
       SET updated_at = dispatch_stock_balances.updated_at
     RETURNING *`,
    [tenantId, catalogItemId, depotId],
  );
  return inserted.rows[0];
}

async function syncCatalogOnHandRollup(tenantId, catalogItemId) {
  const sum = await dbQuery(
    `SELECT COALESCE(SUM(on_hand_qty), 0) AS total
     FROM dispatch_stock_balances
     WHERE tenant_id = $1 AND catalog_item_id = $2`,
    [tenantId, catalogItemId],
  );
  const total = Number(sum.rows[0]?.total) || 0;
  await dbQuery(
    `UPDATE dispatch_goods_items
     SET on_hand_qty = $3, updated_at = now()
     WHERE id = $1 AND tenant_id = $2`,
    [catalogItemId, tenantId, total],
  );
  return total;
}

/**
 * Manual depot stock change. qtyDelta signed; or setOnHand absolute.
 * kind: adjust | receive | write_off
 */
export async function adjustDepotStock(tenantId, body) {
  const catalogItemId = String(body.catalogItemId || body.catalog_item_id || "").trim();
  const depotId = String(body.depotId || body.depot_id || "").trim();
  if (!catalogItemId || !depotId) {
    const err = new Error("catalogItemId and depotId are required");
    err.status = 400;
    throw err;
  }
  await ensureGoodsItem(tenantId, catalogItemId);
  await ensureDepot(tenantId, depotId);

  let kind = String(body.kind || "adjust").trim().toLowerCase();
  if (!STOCK_MOVE_KINDS.includes(kind)) kind = "adjust";
  if (!["adjust", "receive", "write_off"].includes(kind)) kind = "adjust";

  const note = String(body.note || "").trim().slice(0, 500);
  const row = await getOrCreateBalance(tenantId, catalogItemId, depotId);
  const current = Number(row.on_hand_qty) || 0;

  let next = current;
  if (body.setOnHand !== undefined || body.set_on_hand !== undefined) {
    const absolute = numOrNullGoods(body.setOnHand ?? body.set_on_hand);
    if (absolute == null) {
      const err = new Error("setOnHand must be a number ≥ 0");
      err.status = 400;
      throw err;
    }
    next = Math.max(0, absolute);
  } else {
    const delta = Number(body.qtyDelta ?? body.qty_delta);
    if (!Number.isFinite(delta) || delta === 0) {
      const err = new Error("qtyDelta must be a non-zero number");
      err.status = 400;
      throw err;
    }
    next = current + delta;
    if (next < 0) {
      const err = new Error(`Insufficient stock at depot (have ${current}, delta ${delta})`);
      err.status = 400;
      throw err;
    }
  }

  const qtyDelta = Math.round((next - current) * 1000) / 1000;
  if (qtyDelta === 0) {
    return {
      balance: publicStockBalance({ ...row, depot_name: (await ensureDepot(tenantId, depotId)).name }),
      movement: null,
    };
  }

  if (kind === "receive" && qtyDelta < 0) kind = "adjust";
  if (kind === "write_off" && qtyDelta > 0) kind = "adjust";

  const updated = await dbQuery(
    `UPDATE dispatch_stock_balances
     SET on_hand_qty = $4, updated_at = now()
     WHERE tenant_id = $1 AND catalog_item_id = $2 AND depot_id = $3
     RETURNING *`,
    [tenantId, catalogItemId, depotId, next],
  );
  const mov = await dbQuery(
    `INSERT INTO dispatch_stock_movements (
       tenant_id, catalog_item_id, depot_id, kind, layer, qty_delta, note
     ) VALUES ($1,$2,$3,$4,'depot',$5,$6)
     RETURNING *`,
    [tenantId, catalogItemId, depotId, kind, qtyDelta, note],
  );
  await syncCatalogOnHandRollup(tenantId, catalogItemId);
  const depot = await ensureDepot(tenantId, depotId);
  return {
    balance: publicStockBalance({ ...updated.rows[0], depot_name: depot.name }),
    movement: publicStockMovement(mov.rows[0]),
  };
}

/** Source depot: order explicit → zone map → vehicle depot → tenant default. */
export async function resolveSourceDepotId(tenantId, { order = null, job = null } = {}) {
  const explicit = order?.sourceDepotId || order?.source_depot_id || null;
  if (explicit) {
    const ok = await dbQuery(
      `SELECT id FROM dispatch_depots WHERE id = $1 AND tenant_id = $2`,
      [String(explicit), tenantId],
    );
    if (ok.rows[0]) return ok.rows[0].id;
  }

  const zone = normalizeZoneKey(order?.zone || "");
  if (zone) {
    const mapped = await dbQuery(
      `SELECT depot_id FROM dispatch_zone_depot_map
       WHERE tenant_id = $1 AND zone_key = $2`,
      [tenantId, zone],
    );
    if (mapped.rows[0]?.depot_id) return mapped.rows[0].depot_id;
  }

  const armadaUserId = job?.armadaUserId ?? job?.armada_user_id;
  if (armadaUserId != null && Number.isFinite(Number(armadaUserId))) {
    const veh = await dbQuery(
      `SELECT depot_id FROM vehicle_capacities
       WHERE tenant_id = $1 AND armada_user_id = $2 AND depot_id IS NOT NULL`,
      [tenantId, Number(armadaUserId)],
    );
    if (veh.rows[0]?.depot_id) return veh.rows[0].depot_id;
  }

  const def = await dbQuery(
    `SELECT id FROM dispatch_depots
     WHERE tenant_id = $1
     ORDER BY is_default DESC, lower(name) ASC
     LIMIT 1`,
    [tenantId],
  );
  return def.rows[0]?.id || null;
}

/**
 * Check whether depot has enough sell-unit qty for lines.
 * Returns { ok, warnings, errors, depotId }.
 */
export async function checkDepotStockForLines(tenantId, depotId, lines, { hardBlock = false } = {}) {
  if (!depotId) {
    return {
      ok: !hardBlock,
      depotId: null,
      warnings: hardBlock ? [] : ["No source depot resolved for stock check"],
      errors: hardBlock ? ["No source depot resolved for stock check"] : [],
    };
  }
  const needed = new Map();
  for (const line of lines || []) {
    const id = line.catalogItemId || line.catalog_item_id;
    if (!id) continue;
    const qty = Math.max(0, Number(line.qty) || 0);
    if (!qty) continue;
    needed.set(String(id), (needed.get(String(id)) || 0) + qty);
  }
  if (!needed.size) return { ok: true, depotId, warnings: [], errors: [] };

  const ids = [...needed.keys()];
  const rows = await dbQuery(
    `SELECT catalog_item_id, on_hand_qty FROM dispatch_stock_balances
     WHERE tenant_id = $1 AND depot_id = $2 AND catalog_item_id = ANY($3::uuid[])`,
    [tenantId, depotId, ids],
  );
  const have = new Map(rows.rows.map((r) => [String(r.catalog_item_id), Number(r.on_hand_qty) || 0]));
  const names = await dbQuery(
    `SELECT id, name FROM dispatch_goods_items WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
    [tenantId, ids],
  );
  const nameById = new Map(names.rows.map((r) => [String(r.id), r.name]));

  const warnings = [];
  const errors = [];
  for (const [id, qty] of needed) {
    const onHand = have.get(id) || 0;
    if (onHand + 1e-9 < qty) {
      const label = nameById.get(id) || id;
      const msg = `Insufficient stock for ${label}: need ${qty}, have ${onHand}`;
      if (hardBlock) errors.push(msg);
      else warnings.push(msg);
    }
  }
  return { ok: errors.length === 0, depotId, warnings, errors };
}

/** Expose pack-aware base qty helper for future auto moves. */
export function lineQtyToBasePcs(line, unitsPerPack) {
  return qtyToBasePcs(line.qty, unitsPerPack);
}
