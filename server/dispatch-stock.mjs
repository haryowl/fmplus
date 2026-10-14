/**
 * Per-depot + truck stock ledger (manual adjust, pickup/delivery/return, day-close).
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
    itemName: row.item_name || "",
    itemSku: row.item_sku || "",
    unit: row.item_unit || "pcs",
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
    `SELECT t.*, j.title AS job_title,
            g.name AS item_name, g.sku AS item_sku, g.unit AS item_unit
     FROM dispatch_truck_stock t
     JOIN dispatch_jobs j ON j.id = t.job_id AND j.tenant_id = t.tenant_id
     LEFT JOIN dispatch_goods_items g ON g.id = t.catalog_item_id AND g.tenant_id = t.tenant_id
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

/** Pack-aware base qty for stock moves (box ↔ pcs). */
export function lineQtyToBasePcs(line, unitsPerPack) {
  return qtyToBasePcs(line.qty, unitsPerPack);
}

async function orderKindAlreadyApplied(tenantId, orderId, kind) {
  if (!orderId) return false;
  const found = await dbQuery(
    `SELECT id FROM dispatch_stock_movements
     WHERE tenant_id = $1 AND order_id = $2 AND kind = $3
     LIMIT 1`,
    [tenantId, orderId, kind],
  );
  return Boolean(found.rows[0]);
}

async function getOrCreateTruckRow(tenantId, jobId, catalogItemId) {
  const existing = await dbQuery(
    `SELECT * FROM dispatch_truck_stock
     WHERE tenant_id = $1 AND job_id = $2 AND catalog_item_id = $3`,
    [tenantId, jobId, catalogItemId],
  );
  if (existing.rows[0]) return existing.rows[0];
  const inserted = await dbQuery(
    `INSERT INTO dispatch_truck_stock (tenant_id, job_id, catalog_item_id, qty)
     VALUES ($1,$2,$3,0)
     ON CONFLICT (tenant_id, job_id, catalog_item_id) DO UPDATE
       SET updated_at = dispatch_truck_stock.updated_at
     RETURNING *`,
    [tenantId, jobId, catalogItemId],
  );
  return inserted.rows[0];
}

/**
 * Change truck/in-transit qty (signed). Records a stock movement on the truck layer.
 */
export async function adjustTruckStock(tenantId, body) {
  const jobId = String(body.jobId || body.job_id || "").trim();
  const catalogItemId = String(body.catalogItemId || body.catalog_item_id || "").trim();
  const delta = Number(body.qtyDelta ?? body.qty_delta);
  if (!jobId || !catalogItemId || !Number.isFinite(delta) || delta === 0) {
    const err = new Error("jobId, catalogItemId, and non-zero qtyDelta are required");
    err.status = 400;
    throw err;
  }
  await ensureGoodsItem(tenantId, catalogItemId);
  const row = await getOrCreateTruckRow(tenantId, jobId, catalogItemId);
  const current = Number(row.qty) || 0;
  const next = Math.round((current + delta) * 1000) / 1000;
  if (next < -1e-9 && body.allowNegative !== true) {
    const err = new Error(`Insufficient truck stock (have ${current}, delta ${delta})`);
    err.status = 400;
    throw err;
  }
  const updated = await dbQuery(
    `UPDATE dispatch_truck_stock
     SET qty = $4, updated_at = now()
     WHERE tenant_id = $1 AND job_id = $2 AND catalog_item_id = $3
     RETURNING *`,
    [tenantId, jobId, catalogItemId, Math.max(0, next)],
  );
  const kind = String(body.kind || "adjust").trim().toLowerCase();
  const mov = await dbQuery(
    `INSERT INTO dispatch_stock_movements (
       tenant_id, catalog_item_id, depot_id, job_id, order_id, kind, layer, qty_delta, note
     ) VALUES ($1,$2,$3,$4,$5,$6,'truck',$7,$8)
     RETURNING *`,
    [
      tenantId,
      catalogItemId,
      body.depotId || body.depot_id || null,
      jobId,
      body.orderId || body.order_id || null,
      STOCK_MOVE_KINDS.includes(kind) ? kind : "adjust",
      delta,
      String(body.note || "").trim().slice(0, 500),
    ],
  );
  return {
    truck: publicTruckStock({ ...updated.rows[0], job_title: "" }),
    movement: publicStockMovement(mov.rows[0]),
  };
}

function catalogLinesFrom(lines) {
  const out = [];
  for (const line of lines || []) {
    const id = line.catalogItemId || line.catalog_item_id;
    if (!id) continue;
    const qty = Math.max(0, Number(line.qty) || 0);
    if (!qty) continue;
    out.push({
      catalogItemId: String(id),
      qty,
      scannedAt: line.scannedAt || line.scanned_at || null,
      name: line.name || "",
    });
  }
  return out;
}

function assertScansIfRequired(lines, requireScan) {
  if (!requireScan) return;
  const missing = lines.filter((l) => !l.scannedAt);
  if (missing.length) {
    const err = new Error(
      `Cargo scan required before stock move (${missing.map((l) => l.name || l.catalogItemId).join(", ")})`,
    );
    err.status = 400;
    throw err;
  }
}

/** Depot ↓ truck ↑ when pickup is finished. */
export async function applyPickupStockMove(tenantId, opts) {
  const jobId = opts.jobId;
  const orderId = opts.orderId;
  const lines = catalogLinesFrom(opts.lines);
  if (!jobId || !orderId || !lines.length) {
    return { ok: true, moved: false, reason: "no_catalog_lines" };
  }
  if (await orderKindAlreadyApplied(tenantId, orderId, "pickup")) {
    return { ok: true, moved: false, reason: "already_picked" };
  }
  const settings = opts.settings || parseStockSettings(opts.entitlements);
  assertScansIfRequired(lines, settings.stockRequireScan);

  const depotId =
    opts.depotId ||
    (await resolveSourceDepotId(tenantId, { order: opts.order, job: opts.job }));
  if (!depotId) {
    if (settings.stockHardBlock) {
      const err = new Error("No source depot for stock pickup");
      err.status = 400;
      throw err;
    }
    return { ok: true, moved: false, reason: "no_depot", warnings: ["No source depot for stock pickup"] };
  }

  const check = await checkDepotStockForLines(tenantId, depotId, lines, {
    hardBlock: settings.stockHardBlock,
  });
  if (!check.ok) {
    const err = new Error(check.errors.join("; ") || "Insufficient depot stock");
    err.status = 400;
    throw err;
  }

  const movements = [];
  for (const line of lines) {
    const bal = await getOrCreateBalance(tenantId, line.catalogItemId, depotId);
    const have = Number(bal.on_hand_qty) || 0;
    const take = line.qty;
    if (have + 1e-9 < line.qty && settings.stockHardBlock) {
      const err = new Error(`Insufficient stock for ${line.name || line.catalogItemId}`);
      err.status = 400;
      throw err;
    }
    await dbQuery(
      `UPDATE dispatch_stock_balances
       SET on_hand_qty = $4, updated_at = now()
       WHERE tenant_id = $1 AND catalog_item_id = $2 AND depot_id = $3`,
      [tenantId, line.catalogItemId, depotId, have - take],
    );
    const movDepot = await dbQuery(
      `INSERT INTO dispatch_stock_movements (
         tenant_id, catalog_item_id, depot_id, job_id, order_id, kind, layer, qty_delta, note
       ) VALUES ($1,$2,$3,$4,$5,'pickup','depot',$6,$7)
       RETURNING *`,
      [
        tenantId,
        line.catalogItemId,
        depotId,
        jobId,
        orderId,
        -take,
        "Pickup: depot → truck",
      ],
    );
    movements.push(publicStockMovement(movDepot.rows[0]));
    await adjustTruckStock(tenantId, {
      jobId,
      catalogItemId: line.catalogItemId,
      qtyDelta: take,
      kind: "pickup",
      orderId,
      depotId,
      note: "Pickup: depot → truck",
    });
    await syncCatalogOnHandRollup(tenantId, line.catalogItemId);
  }
  return { ok: true, moved: true, depotId, warnings: check.warnings, movements };
}

/**
 * Apply optional Field Finish delivered qtys onto planned catalog lines.
 * Missing ids keep planned qty; explicit 0 drops the line (remainder stays on truck).
 */
export function applyDeliveredQtyOverrides(orderLines, deliveredLines) {
  const lines = catalogLinesFrom(orderLines);
  if (!deliveredLines || !Array.isArray(deliveredLines)) {
    return lines.filter((l) => l.qty > 0);
  }
  const byId = new Map(
    deliveredLines.map((l) => [
      String(l.catalogItemId || l.catalog_item_id || ""),
      Math.max(0, Number(l.qty) || 0),
    ]),
  );
  return lines
    .map((l) => ({
      ...l,
      qty: byId.has(l.catalogItemId) ? byId.get(l.catalogItemId) : l.qty,
    }))
    .filter((l) => l.qty > 0);
}

/** Truck ↓ on delivery (drop finished). Drop-only orders pull from depot if nothing on truck. */
export async function applyDeliveryStockMove(tenantId, opts) {
  const jobId = opts.jobId;
  const orderId = opts.orderId;
  const lines = applyDeliveredQtyOverrides(opts.lines, opts.deliveredLines);
  if (!jobId || !orderId || !lines.length) {
    return { ok: true, moved: false, reason: "no_catalog_lines" };
  }
  if (await orderKindAlreadyApplied(tenantId, orderId, "delivery")) {
    return { ok: true, moved: false, reason: "already_delivered" };
  }
  const settings = opts.settings || parseStockSettings(opts.entitlements);
  assertScansIfRequired(lines, settings.stockRequireScan);

  const hadPickup = await orderKindAlreadyApplied(tenantId, orderId, "pickup");
  const movements = [];

  if (hadPickup) {
    for (const line of lines) {
      await adjustTruckStock(tenantId, {
        jobId,
        catalogItemId: line.catalogItemId,
        qtyDelta: -line.qty,
        kind: "delivery",
        orderId,
        note: "Delivery: truck → customer",
      });
      movements.push({ catalogItemId: line.catalogItemId, qty: line.qty, layer: "truck" });
    }
    return { ok: true, moved: true, from: "truck", movements };
  }

  // Drop-only: consume from source depot directly.
  const depotId =
    opts.depotId ||
    (await resolveSourceDepotId(tenantId, { order: opts.order, job: opts.job }));
  if (!depotId) {
    if (settings.stockHardBlock) {
      const err = new Error("No source depot for stock delivery");
      err.status = 400;
      throw err;
    }
    return { ok: true, moved: false, reason: "no_depot", warnings: ["No source depot for delivery"] };
  }
  const check = await checkDepotStockForLines(tenantId, depotId, lines, {
    hardBlock: settings.stockHardBlock,
  });
  if (!check.ok) {
    const err = new Error(check.errors.join("; ") || "Insufficient depot stock");
    err.status = 400;
    throw err;
  }
  for (const line of lines) {
    const bal = await getOrCreateBalance(tenantId, line.catalogItemId, depotId);
    const have = Number(bal.on_hand_qty) || 0;
    await dbQuery(
      `UPDATE dispatch_stock_balances
       SET on_hand_qty = $4, updated_at = now()
       WHERE tenant_id = $1 AND catalog_item_id = $2 AND depot_id = $3`,
      [tenantId, line.catalogItemId, depotId, have - line.qty],
    );
    const mov = await dbQuery(
      `INSERT INTO dispatch_stock_movements (
         tenant_id, catalog_item_id, depot_id, job_id, order_id, kind, layer, qty_delta, note
       ) VALUES ($1,$2,$3,$4,$5,'delivery','depot',$6,$7)
       RETURNING *`,
      [
        tenantId,
        line.catalogItemId,
        depotId,
        jobId,
        orderId,
        -line.qty,
        "Delivery: depot → customer (drop-only)",
      ],
    );
    movements.push(publicStockMovement(mov.rows[0]));
    await syncCatalogOnHandRollup(tenantId, line.catalogItemId);
  }
  return { ok: true, moved: true, from: "depot", depotId, warnings: check.warnings, movements };
}

/** Remaining truck qty → depot (end of trip / cancel / manual return). */
export async function returnTruckStockToDepot(tenantId, opts) {
  const jobId = String(opts.jobId || "").trim();
  if (!jobId) {
    const err = new Error("jobId is required");
    err.status = 400;
    throw err;
  }
  const rows = await listTruckStock(tenantId, { jobId });
  if (!rows.length) return { ok: true, returned: 0, movements: [] };

  let depotId = opts.depotId || null;
  if (!depotId) {
    depotId = await resolveSourceDepotId(tenantId, { job: opts.job || { armada_user_id: opts.armadaUserId } });
  }
  if (!depotId) {
    const err = new Error("No depot to return truck stock to");
    err.status = 400;
    throw err;
  }

  const note = String(opts.note || "Return truck → depot").trim().slice(0, 500);
  const kind = opts.writeOff === true ? "write_off" : "return";
  const movements = [];
  for (const row of rows) {
    if (!(row.qty > 0)) continue;
    if (kind === "write_off") {
      await adjustTruckStock(tenantId, {
        jobId,
        catalogItemId: row.catalogItemId,
        qtyDelta: -row.qty,
        kind: "write_off",
        depotId,
        note: note || "Write-off damaged/lost",
      });
      movements.push({ catalogItemId: row.catalogItemId, qty: row.qty, fate: "write_off" });
      continue;
    }
    await adjustTruckStock(tenantId, {
      jobId,
      catalogItemId: row.catalogItemId,
      qtyDelta: -row.qty,
      kind: "return",
      depotId,
      note,
    });
    const bal = await getOrCreateBalance(tenantId, row.catalogItemId, depotId);
    const have = Number(bal.on_hand_qty) || 0;
    await dbQuery(
      `UPDATE dispatch_stock_balances
       SET on_hand_qty = $4, updated_at = now()
       WHERE tenant_id = $1 AND catalog_item_id = $2 AND depot_id = $3`,
      [tenantId, row.catalogItemId, depotId, have + row.qty],
    );
    const mov = await dbQuery(
      `INSERT INTO dispatch_stock_movements (
         tenant_id, catalog_item_id, depot_id, job_id, kind, layer, qty_delta, note
       ) VALUES ($1,$2,$3,$4,'return','depot',$5,$6)
       RETURNING *`,
      [tenantId, row.catalogItemId, depotId, jobId, row.qty, note],
    );
    movements.push(publicStockMovement(mov.rows[0]));
    await syncCatalogOnHandRollup(tenantId, row.catalogItemId);
  }
  return { ok: true, returned: movements.length, depotId, movements };
}

/**
 * Field Finish hook: pickup done → depot→truck; drop done → truck→customer (or depot if drop-only).
 * Skip does not move stock (stays on truck if already picked).
 */
export async function applyFieldStopStock(tenantId, opts) {
  const status = String(opts.status || "").toLowerCase();
  if (status !== "done") {
    return { ok: true, moved: false, reason: "not_done" };
  }
  const stop = opts.stop || {};
  const orderId = stop.order_id || stop.orderId || opts.orderId;
  if (!orderId) return { ok: true, moved: false, reason: "no_order" };

  const orderRow = await dbQuery(
    `SELECT * FROM dispatch_orders WHERE id = $1 AND tenant_id = $2`,
    [orderId, tenantId],
  );
  const order = orderRow.rows[0];
  if (!order) return { ok: true, moved: false, reason: "order_missing" };

  const lineRows = await dbQuery(
    `SELECT * FROM dispatch_order_lines
     WHERE tenant_id = $1 AND order_id = $2
     ORDER BY sort_order ASC`,
    [tenantId, orderId],
  );
  const lines = lineRows.rows.map((r) => ({
    catalogItemId: r.catalog_item_id,
    qty: Number(r.qty) || 0,
    name: r.name,
    scannedAt: r.scanned_at,
  }));
  if (!lines.some((l) => l.catalogItemId)) {
    return { ok: true, moved: false, reason: "no_catalog_lines" };
  }

  const settings = parseStockSettings(opts.entitlements);
  const role = stop.role === "pickup" ? "pickup" : "drop";
  const job = opts.job || {};
  const jobId = job.id || opts.jobId;

  if (role === "pickup") {
    return applyPickupStockMove(tenantId, {
      jobId,
      orderId,
      order,
      job,
      lines,
      settings,
      entitlements: opts.entitlements,
      deliveredLines: opts.deliveredLines,
    });
  }
  return applyDeliveryStockMove(tenantId, {
    jobId,
    orderId,
    order,
    job,
    lines,
    settings,
    entitlements: opts.entitlements,
    deliveredLines: opts.deliveredLines,
  });
}
