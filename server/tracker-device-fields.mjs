/**
 * Tenant-defined custom fields for tracker fleet devices (metadata, not AVL remap).
 */
import { dbQuery } from "./db.mjs";

const VALUE_TYPES = new Set(["text", "number", "bool", "date", "select"]);

function normalizeFieldId(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 63);
}

function publicFieldDef(row) {
  if (!row) return null;
  const opts = Array.isArray(row.select_options)
    ? row.select_options.map((o) => String(o)).filter(Boolean)
    : [];
  return {
    id: row.id,
    tenantId: row.tenant_id,
    label: row.label || row.id,
    valueType: row.value_type || "text",
    unit: row.unit || "",
    description: row.description || "",
    selectOptions: opts,
    sortOrder: Number(row.sort_order) || 0,
    enabled: row.enabled !== false,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

export async function listDeviceFieldDefs(tenantId, { includeDisabled = false } = {}) {
  const rows = await dbQuery(
    `SELECT * FROM tracker_device_field_defs
     WHERE tenant_id = $1
       AND ($2::boolean OR enabled = true)
     ORDER BY sort_order ASC, lower(label) ASC`,
    [tenantId, includeDisabled === true],
  );
  return rows.rows.map(publicFieldDef);
}

export async function createDeviceFieldDef(tenantId, body) {
  let id = normalizeFieldId(body.id);
  if (!/^[a-z][a-z0-9_]{1,62}$/.test(id)) {
    const err = new Error("Field id must be snake_case starting with a letter (2–63 chars)");
    err.status = 400;
    throw err;
  }
  const label = String(body.label || id).trim().slice(0, 120) || id;
  const valueType = String(body.valueType || body.value_type || "text").trim().toLowerCase();
  if (!VALUE_TYPES.has(valueType)) {
    const err = new Error("Invalid valueType");
    err.status = 400;
    throw err;
  }
  const unit = String(body.unit || "").trim().slice(0, 32);
  const description = String(body.description || "").trim().slice(0, 500);
  const selectOptions = Array.isArray(body.selectOptions || body.select_options)
    ? (body.selectOptions || body.select_options).map((o) => String(o).trim()).filter(Boolean).slice(0, 40)
    : [];
  if (valueType === "select" && !selectOptions.length) {
    const err = new Error("select fields need selectOptions");
    err.status = 400;
    throw err;
  }
  const sortOrder = Number.isFinite(Number(body.sortOrder ?? body.sort_order))
    ? Math.trunc(Number(body.sortOrder ?? body.sort_order))
    : 0;
  try {
    const inserted = await dbQuery(
      `INSERT INTO tracker_device_field_defs
         (id, tenant_id, label, value_type, unit, description, select_options, sort_order, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
       RETURNING *`,
      [
        id,
        tenantId,
        label,
        valueType,
        unit,
        description,
        JSON.stringify(selectOptions),
        sortOrder,
        body.enabled !== false,
      ],
    );
    return publicFieldDef(inserted.rows[0]);
  } catch (e) {
    if (e && (e.code === "23505" || String(e.message || "").includes("duplicate"))) {
      const err = new Error("Field id already exists");
      err.status = 409;
      throw err;
    }
    throw e;
  }
}

export async function updateDeviceFieldDef(tenantId, fieldId, body) {
  const found = await dbQuery(
    `SELECT * FROM tracker_device_field_defs WHERE tenant_id = $1 AND id = $2`,
    [tenantId, fieldId],
  );
  const current = found.rows[0];
  if (!current) {
    const err = new Error("Field not found");
    err.status = 404;
    throw err;
  }
  const label =
    body.label !== undefined ? String(body.label || "").trim().slice(0, 120) || current.label : current.label;
  let valueType = current.value_type;
  if (body.valueType !== undefined || body.value_type !== undefined) {
    valueType = String(body.valueType || body.value_type || "text").trim().toLowerCase();
    if (!VALUE_TYPES.has(valueType)) {
      const err = new Error("Invalid valueType");
      err.status = 400;
      throw err;
    }
  }
  const unit =
    body.unit !== undefined ? String(body.unit || "").trim().slice(0, 32) : current.unit;
  const description =
    body.description !== undefined
      ? String(body.description || "").trim().slice(0, 500)
      : current.description;
  let selectOptions = Array.isArray(current.select_options) ? current.select_options : [];
  if (body.selectOptions !== undefined || body.select_options !== undefined) {
    selectOptions = Array.isArray(body.selectOptions || body.select_options)
      ? (body.selectOptions || body.select_options).map((o) => String(o).trim()).filter(Boolean).slice(0, 40)
      : [];
  }
  const sortOrder =
    body.sortOrder !== undefined || body.sort_order !== undefined
      ? Math.trunc(Number(body.sortOrder ?? body.sort_order) || 0)
      : current.sort_order;
  const enabled = body.enabled !== undefined ? body.enabled !== false : current.enabled !== false;
  const updated = await dbQuery(
    `UPDATE tracker_device_field_defs SET
       label = $3, value_type = $4, unit = $5, description = $6,
       select_options = $7::jsonb, sort_order = $8, enabled = $9, updated_at = now()
     WHERE tenant_id = $1 AND id = $2
     RETURNING *`,
    [
      tenantId,
      fieldId,
      label,
      valueType,
      unit,
      description,
      JSON.stringify(selectOptions),
      sortOrder,
      enabled,
    ],
  );
  return publicFieldDef(updated.rows[0]);
}

export async function deleteDeviceFieldDef(tenantId, fieldId) {
  const deleted = await dbQuery(
    `DELETE FROM tracker_device_field_defs WHERE tenant_id = $1 AND id = $2 RETURNING id`,
    [tenantId, fieldId],
  );
  if (!deleted.rows[0]) {
    const err = new Error("Field not found");
    err.status = 404;
    throw err;
  }
  return true;
}

/** Sanitize custom_attrs against known defs (unknown keys kept if already present; new unknown dropped). */
export function sanitizeCustomAttrs(raw, defs) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const byId = new Map((defs || []).map((d) => [d.id, d]));
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, value] of Object.entries(src)) {
    const def = byId.get(key);
    if (!def || def.enabled === false) continue;
    if (def.valueType === "number") {
      const n = Number(value);
      if (Number.isFinite(n)) out[key] = n;
      continue;
    }
    if (def.valueType === "bool") {
      out[key] = value === true || value === "true" || value === 1 || value === "1";
      continue;
    }
    if (def.valueType === "select") {
      const s = String(value ?? "").trim();
      if (s && (def.selectOptions || []).includes(s)) out[key] = s;
      continue;
    }
    // text / date
    const s = String(value ?? "").trim().slice(0, 500);
    if (s) out[key] = s;
  }
  return out;
}
