/**
 * Tenant customer list. Orders copy these fields at create time.
 */
import { dbQuery } from "./db.mjs";

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).trim().replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function clockOrNull(v) {
  const m = String(v || "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function enabledFlag(v) {
  if (v == null || String(v).trim() === "") return null;
  const s = String(v).trim().toLowerCase();
  if (["0", "no", "false", "off", "disabled"].includes(s)) return false;
  return true;
}

export function validCustomerCoords(lat, lon) {
  return lat != null && lon != null && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

export function publicCustomer(row) {
  return {
    id: row.id,
    name: row.name || "",
    lat: Number(row.lat),
    lon: Number(row.lon),
    zone: row.zone || "",
    address: row.address || "",
    phone: row.phone || "",
    contactName: row.contact_name || "",
    notes: row.notes || "",
    windowStart: row.window_start || "",
    windowEnd: row.window_end || "",
    proofRequired: row.proof_required === true,
    enabled: row.enabled !== false,
    updatedAt: row.updated_at || null,
  };
}

function customerFields(body, { requireCoords = true } = {}) {
  const name = String(body.name || body.customerName || body.customer_name || "").trim().slice(0, 200);
  const lat = numOrNull(body.lat);
  const lon = numOrNull(body.lon ?? body.lng);
  if (!name) {
    const err = new Error("Customer name is required");
    err.status = 400;
    throw err;
  }
  if (requireCoords && !validCustomerCoords(lat, lon)) {
    const err = new Error("Latitude and longitude are required");
    err.status = 400;
    throw err;
  }
  return {
    name,
    lat,
    lon,
    zone: String(body.zone || "").trim().slice(0, 80) || null,
    address: String(body.address || "").trim().slice(0, 500) || null,
    phone: String(body.phone || "").trim().slice(0, 40) || null,
    contactName: String(body.contactName || body.contact_name || "").trim().slice(0, 120) || null,
    notes: String(body.notes || "").trim().slice(0, 2000) || null,
    windowStart: clockOrNull(body.windowStart ?? body.window_start),
    windowEnd: clockOrNull(body.windowEnd ?? body.window_end),
    proofRequired: body.proofRequired === true || body.proof_required === true,
    enabled: body.enabled === false ? false : true,
  };
}

export async function listCustomers(tenantId) {
  const rows = await dbQuery(
    `SELECT * FROM dispatch_customers WHERE tenant_id = $1 ORDER BY lower(name) ASC, created_at ASC`,
    [tenantId],
  );
  return rows.rows.map(publicCustomer);
}

export async function createCustomer(tenantId, body) {
  const f = customerFields(body);
  const inserted = await dbQuery(
    `INSERT INTO dispatch_customers (
       tenant_id, name, lat, lon, zone, address, phone, contact_name, notes,
       window_start, window_end, proof_required, enabled
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      tenantId,
      f.name,
      f.lat,
      f.lon,
      f.zone,
      f.address,
      f.phone,
      f.contactName,
      f.notes,
      f.windowStart,
      f.windowEnd,
      f.proofRequired,
      f.enabled,
    ],
  );
  return publicCustomer(inserted.rows[0]);
}

export async function updateCustomer(tenantId, id, body) {
  const found = await dbQuery(`SELECT * FROM dispatch_customers WHERE id = $1 AND tenant_id = $2`, [
    id,
    tenantId,
  ]);
  if (!found.rows[0]) {
    const err = new Error("Customer not found");
    err.status = 404;
    throw err;
  }
  const row = found.rows[0];
  const name =
    body.name !== undefined || body.customerName !== undefined
      ? String(body.name ?? body.customerName ?? "").trim().slice(0, 200)
      : row.name;
  if (!name) {
    const err = new Error("Customer name is required");
    err.status = 400;
    throw err;
  }
  const lat = body.lat !== undefined ? numOrNull(body.lat) : Number(row.lat);
  const lon = body.lon !== undefined || body.lng !== undefined ? numOrNull(body.lon ?? body.lng) : Number(row.lon);
  if (!validCustomerCoords(lat, lon)) {
    const err = new Error("Latitude and longitude are required");
    err.status = 400;
    throw err;
  }
  const text = (key, alt, col, max) => {
    if (body[key] === undefined && body[alt] === undefined) return row[col];
    return String(body[key] ?? body[alt] ?? "").trim().slice(0, max) || null;
  };
  const updated = await dbQuery(
    `UPDATE dispatch_customers SET
       name = $3, lat = $4, lon = $5, zone = $6, address = $7, phone = $8,
       contact_name = $9, notes = $10, window_start = $11, window_end = $12,
       proof_required = $13, enabled = $14, updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [
      id,
      tenantId,
      name,
      lat,
      lon,
      text("zone", "zone", "zone", 80),
      text("address", "address", "address", 500),
      text("phone", "phone", "phone", 40),
      text("contactName", "contact_name", "contact_name", 120),
      text("notes", "notes", "notes", 2000),
      body.windowStart !== undefined || body.window_start !== undefined
        ? clockOrNull(body.windowStart ?? body.window_start)
        : row.window_start,
      body.windowEnd !== undefined || body.window_end !== undefined
        ? clockOrNull(body.windowEnd ?? body.window_end)
        : row.window_end,
      body.proofRequired !== undefined || body.proof_required !== undefined
        ? body.proofRequired === true || body.proof_required === true
        : row.proof_required === true,
      body.enabled !== undefined ? body.enabled !== false : row.enabled !== false,
    ],
  );
  return publicCustomer(updated.rows[0]);
}

export async function deleteCustomer(tenantId, id) {
  const res = await dbQuery(`DELETE FROM dispatch_customers WHERE id = $1 AND tenant_id = $2 RETURNING id`, [
    id,
    tenantId,
  ]);
  if (!res.rows[0]) {
    const err = new Error("Customer not found");
    err.status = 404;
    throw err;
  }
}

export async function importCustomersFromRows(tenantId, rawRows) {
  const rows = Array.isArray(rawRows) ? rawRows : [];
  if (rows.length > 500) {
    const err = new Error("Maximum 500 customer rows per import");
    err.status = 400;
    throw err;
  }
  const existing = await listCustomers(tenantId);
  const byName = new Map(existing.map((c) => [c.name.toLowerCase(), c]));
  const created = [];
  const updated = [];
  const errors = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] && typeof rows[i] === "object" ? rows[i] : {};
    const line = i + 2;
    const name = String(row.name || row.customer_name || row.customerName || "").trim().slice(0, 200);
    if (!name) {
      errors.push({ line, error: "name is required" });
      continue;
    }
    const lat = numOrNull(row.lat);
    const lon = numOrNull(row.lon ?? row.lng);
    const found = byName.get(name.toLowerCase()) || null;
    if (!found && !validCustomerCoords(lat, lon)) {
      errors.push({ line, error: "lat and lon are required" });
      continue;
    }
    if ((row.lat || row.lon) && !validCustomerCoords(lat, lon)) {
      errors.push({ line, error: "lat and lon are not valid coordinates" });
      continue;
    }
    try {
      const patch = { name };
      if (validCustomerCoords(lat, lon)) {
        patch.lat = lat;
        patch.lon = lon;
      }
      if (String(row.zone || "").trim()) patch.zone = String(row.zone).trim();
      if (String(row.address || "").trim()) patch.address = String(row.address).trim();
      if (String(row.phone || "").trim()) patch.phone = String(row.phone).trim();
      if (String(row.contact_name || row.contactName || "").trim()) {
        patch.contactName = String(row.contact_name || row.contactName).trim();
      }
      if (String(row.notes || "").trim()) patch.notes = String(row.notes).trim();
      if (String(row.window_start || row.windowStart || "").trim()) {
        patch.windowStart = row.window_start || row.windowStart;
      }
      if (String(row.window_end || row.windowEnd || "").trim()) {
        patch.windowEnd = row.window_end || row.windowEnd;
      }
      const enabled = enabledFlag(row.enabled);
      if (enabled != null) patch.enabled = enabled;
      const proof = enabledFlag(row.proof_required ?? row.proofRequired);
      if (String(row.proof_required ?? row.proofRequired ?? "").trim() !== "" && proof != null) {
        patch.proofRequired = proof;
      }
      const item = found
        ? await updateCustomer(tenantId, found.id, patch)
        : await createCustomer(tenantId, patch);
      if (found) updated.push(item);
      else created.push(item);
      byName.set(item.name.toLowerCase(), item);
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
