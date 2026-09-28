/**
 * Tenant-scoped scan codes for goods, maintenance parts, and later vehicles/locations.
 * QR, barcode, and NFC all resolve here.
 */
import { dbQuery } from "./db.mjs";

export const TARGET_KINDS = ["goods", "maint_part", "vehicle", "location"];
export const CODE_FORMATS = ["sku", "ean", "qr", "nfc", "other"];
export const SCAN_CONTEXTS = ["dispatch_cargo", "maint_part", "vehicle", "location", "any"];

export function normalizeCatalogCode(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/^([0-9a-f]{2}[:\-\s]){3,}[0-9a-f]{2}$/i.test(s)) {
    return s.replace(/[:\-\s]/g, "").toLowerCase();
  }
  return s.toLowerCase();
}

export function formatScanPayload(targetKind, sku) {
  const kind = targetKind === "maint_part" ? "part" : String(targetKind || "goods");
  const code = String(sku || "").trim();
  if (!code) return "";
  return `am1:v1:${kind}:${code}`;
}

export function parseScanPayload(raw) {
  const trimmed = String(raw || "").trim();
  const m = trimmed.match(/^am1:v(\d+):(goods|part|vehicle|location):(.+)$/i);
  if (m) {
    const token = m[2].toLowerCase();
    return {
      version: Number(m[1]) || 1,
      targetKind: token === "part" ? "maint_part" : token,
      code: normalizeCatalogCode(m[3]),
      raw: trimmed,
    };
  }
  return {
    version: null,
    targetKind: null,
    code: normalizeCatalogCode(trimmed),
    raw: trimmed,
  };
}

function publicCode(row) {
  return {
    id: row.id,
    targetKind: row.target_kind,
    targetId: row.target_id,
    code: row.code,
    codeFormat: row.code_format,
    label: row.label || "",
    enabled: row.enabled !== false,
    createdAt: row.created_at,
  };
}

export async function listCodesForTarget(tenantId, targetKind, targetId) {
  const rows = await dbQuery(
    `SELECT * FROM catalog_codes
     WHERE tenant_id = $1 AND target_kind = $2 AND target_id = $3
     ORDER BY code_format ASC, code ASC`,
    [tenantId, targetKind, targetId],
  );
  return rows.rows.map(publicCode);
}

export async function addCatalogCode(tenantId, { targetKind, targetId, code, codeFormat, label }) {
  if (!TARGET_KINDS.includes(targetKind)) {
    const err = new Error("Invalid target kind");
    err.status = 400;
    throw err;
  }
  const format = CODE_FORMATS.includes(codeFormat) ? codeFormat : "other";
  const normalized = normalizeCatalogCode(code);
  if (!normalized) {
    const err = new Error("code is required");
    err.status = 400;
    throw err;
  }
  try {
    const inserted = await dbQuery(
      `INSERT INTO catalog_codes (
         tenant_id, target_kind, target_id, code, code_format, label
       ) VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [tenantId, targetKind, targetId, normalized, format, String(label || "").trim().slice(0, 80) || null],
    );
    return publicCode(inserted.rows[0]);
  } catch (err) {
    if (err && err.code === "23505") {
      const conflict = new Error("That code is already used on this tenant");
      conflict.status = 409;
      throw conflict;
    }
    throw err;
  }
}

export async function deleteCatalogCode(tenantId, codeId) {
  const res = await dbQuery(
    `DELETE FROM catalog_codes WHERE id = $1 AND tenant_id = $2 RETURNING id`,
    [codeId, tenantId],
  );
  if (!res.rows[0]) {
    const err = new Error("Code not found");
    err.status = 404;
    throw err;
  }
  return { ok: true };
}

export async function deleteCodesForTarget(tenantId, targetKind, targetId) {
  await dbQuery(
    `DELETE FROM catalog_codes WHERE tenant_id = $1 AND target_kind = $2 AND target_id = $3`,
    [tenantId, targetKind, targetId],
  );
}

/** Keep the primary SKU row in sync with the catalog item field. */
export async function syncPrimarySku(tenantId, targetKind, targetId, sku) {
  await dbQuery(
    `DELETE FROM catalog_codes
     WHERE tenant_id = $1 AND target_kind = $2 AND target_id = $3 AND code_format = 'sku'`,
    [tenantId, targetKind, targetId],
  );
  const normalized = normalizeCatalogCode(sku);
  if (!normalized) return null;
  try {
    return await addCatalogCode(tenantId, {
      targetKind,
      targetId,
      code: normalized,
      codeFormat: "sku",
      label: "SKU",
    });
  } catch (err) {
    if (err && err.status === 409) {
      const conflict = new Error("SKU is already used by another catalog item");
      conflict.status = 409;
      throw conflict;
    }
    throw err;
  }
}

async function hydrateMatch(tenantId, row) {
  if (row.target_kind === "goods") {
    const { publicGoodsItem } = await import("./dispatch-goods.mjs");
    const found = await dbQuery(
      `SELECT * FROM dispatch_goods_items WHERE id = $1 AND tenant_id = $2`,
      [row.target_id, tenantId],
    );
    const item = found.rows[0];
    if (!item || item.enabled === false) return null;
    return { kind: "goods", item: publicGoodsItem(item) };
  }
  if (row.target_kind === "maint_part") {
    const { publicCatalogItem } = await import("./maintenance-catalog.mjs");
    const found = await dbQuery(
      `SELECT i.*, g.key AS group_key
       FROM maintenance_catalog_items i
       JOIN maintenance_catalog_groups g ON g.id = i.group_id
       WHERE i.id = $1 AND i.tenant_id = $2`,
      [row.target_id, tenantId],
    );
    const item = found.rows[0];
    if (!item || item.enabled === false) return null;
    return { kind: "maint_part", item: publicCatalogItem(item) };
  }
  if (row.target_kind === "vehicle") {
    return hydrateVehicle(tenantId, row.target_id);
  }
  if (row.target_kind === "location") {
    return hydrateLocation(tenantId, row.target_id);
  }
  return {
    kind: row.target_kind,
    item: { id: row.target_id },
  };
}

async function hydrateVehicle(tenantId, targetId) {
  const uid = Number(targetId);
  const found = await dbQuery(
    `SELECT armada_user_id, label, plate_parity
     FROM vehicle_capacities
     WHERE tenant_id = $1 AND armada_user_id = $2`,
    [tenantId, Number.isFinite(uid) ? uid : -1],
  );
  const cap = found.rows[0];
  return {
    kind: "vehicle",
    item: {
      id: String(targetId),
      armadaUserId: Number.isFinite(uid) ? uid : 0,
      label: cap?.label || "",
      plateParity: cap?.plate_parity || "",
    },
  };
}

async function hydrateLocation(tenantId, targetId) {
  const found = await dbQuery(
    `SELECT id, name, lat, lon FROM dispatch_depots WHERE tenant_id = $1 AND id = $2`,
    [tenantId, targetId],
  );
  const depot = found.rows[0];
  if (!depot) {
    return { kind: "location", item: { id: String(targetId), name: String(targetId) } };
  }
  return {
    kind: "location",
    item: { id: depot.id, name: depot.name, lat: depot.lat, lon: depot.lon },
  };
}

function contextAllowsKind(context, kind) {
  if (context === "any") return true;
  if (context === "dispatch_cargo") return kind === "goods";
  if (context === "maint_part") return kind === "maint_part";
  if (context === "vehicle") return kind === "vehicle";
  if (context === "location") return kind === "location";
  return true;
}

async function matchGoodsItem(tenantId, parsed, row, codeFormat) {
  const { publicGoodsItem } = await import("./dispatch-goods.mjs");
  if (row.sku) {
    try {
      await syncPrimarySku(tenantId, "goods", row.id, row.sku);
    } catch {
      /* still return the catalog hit */
    }
  }
  return {
    match: "goods",
    code: parsed.code,
    raw: parsed.raw,
    codeFormat,
    payload: formatScanPayload("goods", row.sku || parsed.code),
    item: publicGoodsItem(row),
  };
}

async function matchPartItem(tenantId, parsed, row, codeFormat) {
  const { publicCatalogItem } = await import("./maintenance-catalog.mjs");
  if (row.sku) {
    try {
      await syncPrimarySku(tenantId, "maint_part", row.id, row.sku);
    } catch {
      /* still return the catalog hit */
    }
  }
  return {
    match: "maint_part",
    code: parsed.code,
    raw: parsed.raw,
    codeFormat,
    payload: formatScanPayload("maint_part", row.sku || parsed.code),
    item: publicCatalogItem(row),
  };
}

/** SKU or unique name on the catalog item, when catalog_codes has no row yet. */
async function lookupByCatalogIdentity(tenantId, parsed, context) {
  const code = parsed.code;
  if (!code) return null;
  const wantGoods =
    contextAllowsKind(context, "goods") && (!parsed.targetKind || parsed.targetKind === "goods");
  const wantPart =
    contextAllowsKind(context, "maint_part") &&
    (!parsed.targetKind || parsed.targetKind === "maint_part");

  if (wantGoods) {
    const bySku = await dbQuery(
      `SELECT * FROM dispatch_goods_items
       WHERE tenant_id = $1 AND enabled = true AND sku IS NOT NULL AND trim(sku) <> ''
         AND lower(trim(sku)) = $2
       LIMIT 1`,
      [tenantId, code],
    );
    if (bySku.rows[0]) return matchGoodsItem(tenantId, parsed, bySku.rows[0], "sku");
    const byName = await dbQuery(
      `SELECT * FROM dispatch_goods_items
       WHERE tenant_id = $1 AND enabled = true AND lower(trim(name)) = $2`,
      [tenantId, code],
    );
    if (byName.rows.length === 1) return matchGoodsItem(tenantId, parsed, byName.rows[0], "other");
  }

  if (wantPart) {
    const bySku = await dbQuery(
      `SELECT i.*, g.key AS group_key
       FROM maintenance_catalog_items i
       JOIN maintenance_catalog_groups g ON g.id = i.group_id
       WHERE i.tenant_id = $1 AND i.enabled = true AND g.key = 'part'
         AND i.sku IS NOT NULL AND trim(i.sku) <> '' AND lower(trim(i.sku)) = $2
       LIMIT 1`,
      [tenantId, code],
    );
    if (bySku.rows[0]) return matchPartItem(tenantId, parsed, bySku.rows[0], "sku");
    const byName = await dbQuery(
      `SELECT i.*, g.key AS group_key
       FROM maintenance_catalog_items i
       JOIN maintenance_catalog_groups g ON g.id = i.group_id
       WHERE i.tenant_id = $1 AND i.enabled = true AND g.key = 'part'
         AND lower(trim(i.name)) = $2`,
      [tenantId, code],
    );
    if (byName.rows.length === 1) return matchPartItem(tenantId, parsed, byName.rows[0], "other");
  }
  return null;
}

/**
 * @param {{ code: string, context?: string }} body
 */
export async function lookupCatalogScan(tenantId, body) {
  const parsed = parseScanPayload(body?.code);
  const context = SCAN_CONTEXTS.includes(body?.context) ? body.context : "any";
  if (!parsed.code) {
    return { match: "none", reason: "empty", code: "", raw: parsed.raw || "" };
  }
  const found = await dbQuery(
    `SELECT * FROM catalog_codes
     WHERE tenant_id = $1 AND code = $2 AND enabled = true
     LIMIT 1`,
    [tenantId, parsed.code],
  );
  const row = found.rows[0];
  if (!row && parsed.targetKind === "vehicle") {
    const implicit = await hydrateVehicle(tenantId, parsed.code);
    if (implicit.item.armadaUserId > 0 && contextAllowsKind(context, "vehicle")) {
      return {
        match: "vehicle",
        code: parsed.code,
        raw: parsed.raw,
        codeFormat: "sku",
        payload: formatScanPayload("vehicle", parsed.code),
        item: implicit.item,
      };
    }
  }
  if (!row && parsed.targetKind === "location") {
    const implicit = await hydrateLocation(tenantId, parsed.code);
    if (implicit.item.id && implicit.item.name !== implicit.item.id && contextAllowsKind(context, "location")) {
      return {
        match: "location",
        code: parsed.code,
        raw: parsed.raw,
        codeFormat: "sku",
        payload: formatScanPayload("location", parsed.code),
        item: implicit.item,
      };
    }
  }
  if (!row) {
    const identity = await lookupByCatalogIdentity(tenantId, parsed, context);
    if (identity) return identity;
    return { match: "none", reason: "unknown", code: parsed.code, raw: parsed.raw };
  }
  if (parsed.targetKind && parsed.targetKind !== row.target_kind) {
    return { match: "none", reason: "kind_mismatch", code: parsed.code, raw: parsed.raw };
  }
  if (!contextAllowsKind(context, row.target_kind)) {
    return { match: "none", reason: "wrong_context", code: parsed.code, raw: parsed.raw };
  }
  const hydrated = await hydrateMatch(tenantId, row);
  if (!hydrated) {
    const identity = await lookupByCatalogIdentity(tenantId, parsed, context);
    if (identity) return identity;
    return { match: "none", reason: "disabled", code: parsed.code, raw: parsed.raw };
  }
  return {
    match: hydrated.kind,
    code: parsed.code,
    raw: parsed.raw,
    codeFormat: row.code_format,
    payload: formatScanPayload(row.target_kind, parsed.code),
    item: hydrated.item,
  };
}
