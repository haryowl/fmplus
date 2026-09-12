/**
 * WhatsApp (Wablas) notify when a dispatch job is assigned to a field user.
 * Mirrors maintenance assigned fan-out, with dispatch-specific copy and link.
 */
import { dbQuery } from "./db.mjs";
import { decryptSecret, secretsKeyConfigured } from "./crypto-secrets.mjs";
import { parseRecipientList, sendWablasMessage } from "./wablas.mjs";

function publicBase() {
  return String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
}

function dispatchFieldLink(tenantKey) {
  const base = publicBase() || "";
  const path = `/m?k=${encodeURIComponent(tenantKey || "")}`;
  return base ? `${base}${path}` : path;
}

async function loadTenantNotify(tenantId) {
  const res = await dbQuery(
    `SELECT key, notify_whatsapp, wablas_base_url,
            wablas_token_ciphertext, wablas_secret_ciphertext
     FROM tenants WHERE id = $1`,
    [tenantId],
  );
  return res.rows[0] || null;
}

async function wablasCreds(tenantRow) {
  const envBase = String(process.env.WABLAS_BASE_URL || "").trim();
  const envToken = String(process.env.WABLAS_TOKEN || "").trim();
  const envSecret = String(process.env.WABLAS_SECRET || "").trim();
  const baseUrl = String(tenantRow?.wablas_base_url || "").trim() || envBase || "https://wablas.com";
  let token = envToken;
  let secretKey = envSecret;
  if (tenantRow?.wablas_token_ciphertext && secretsKeyConfigured()) {
    try {
      token = decryptSecret(tenantRow.wablas_token_ciphertext);
    } catch {
      /* keep env */
    }
  }
  if (tenantRow?.wablas_secret_ciphertext && secretsKeyConfigured()) {
    try {
      secretKey = decryptSecret(tenantRow.wablas_secret_ciphertext);
    } catch {
      /* keep env */
    }
  }
  if (!token) return null;
  return { baseUrl, token, secretKey };
}

function vehicleLabel(job) {
  return (
    job.userDisplayName ||
    job.user_display_name ||
    job.armadaUsername ||
    job.armada_username ||
    (job.armadaUserId || job.armada_user_id ? `#${job.armadaUserId || job.armada_user_id}` : "Vehicle")
  );
}

function assigneeLabel(job) {
  return (
    job.assigneeDisplayName ||
    job.assignee_display_name ||
    job.assigneeUsername ||
    job.assignee_username ||
    "you"
  );
}

function serviceDateLabel(job) {
  const raw = job.serviceDate || job.service_date || "";
  const s = String(raw).slice(0, 10);
  return s || "—";
}

function buildAssignedMessage(job, tenantKey) {
  const stops = Array.isArray(job.stops) ? job.stops : [];
  const stopCount = stops.length;
  const vol =
    job.volumeUsed != null
      ? job.volumeUsed
      : stops.reduce((n, s) => n + (Number(s.volumeM3 ?? s.volume_m3) || 0), 0);
  const title = String(job.title || "Dispatch job").trim() || "Dispatch job";
  const lines = [
    `ARMADA M.1 · Dispatch job assigned`,
    ``,
    `Job: ${title}`,
    `Date: ${serviceDateLabel(job)}`,
    `Vehicle: ${vehicleLabel(job)}`,
    `Orders: ${stopCount} stop${stopCount === 1 ? "" : "s"}${vol ? ` · ${vol} m³` : ""}`,
    `Assigned to: ${assigneeLabel(job)}`,
    ``,
    `Open Dispatch:`,
    dispatchFieldLink(tenantKey),
  ];
  return lines.join("\n").slice(0, 1024);
}

/**
 * Recipients: assigned field user phone + tenant notify_whatsapp (same pattern as maintenance).
 */
async function recipientsForJob(tenantId, job) {
  const tenant = await loadTenantNotify(tenantId);
  const phones = new Set(parseRecipientList(tenant?.notify_whatsapp));
  const assignedId = job.assignedFieldUserId || job.assigned_field_user_id;
  if (assignedId) {
    const fu = await dbQuery(
      `SELECT phone FROM field_users WHERE id = $1 AND tenant_id = $2 AND enabled = true`,
      [assignedId, tenantId],
    );
    const p = parseRecipientList(fu.rows[0]?.phone || "")[0];
    if (p) phones.add(p);
  }
  return {
    tenant,
    phones: [...phones].filter(Boolean),
  };
}

/**
 * Send WhatsApp when a job is newly assigned (or reassigned) to a field user.
 * No-ops if assignee unchanged, missing, or Wablas is not configured.
 *
 * @param {{
 *   tenantId: string,
 *   tenantKey?: string,
 *   job: object,
 *   prevAssignedFieldUserId?: string | null,
 * }} opts
 */
export async function maybeNotifyDispatchJobAssigned(opts) {
  const tenantId = opts.tenantId;
  const job = opts.job;
  if (!tenantId || !job) return { skipped: true, reason: "missing" };

  const assigneeId = job.assignedFieldUserId || job.assigned_field_user_id || null;
  if (!assigneeId) return { skipped: true, reason: "no_assignee" };

  const prev = opts.prevAssignedFieldUserId ?? null;
  if (String(assigneeId) === String(prev || "")) {
    return { skipped: true, reason: "unchanged" };
  }

  const { tenant, phones } = await recipientsForJob(tenantId, job);
  if (!phones.length) return { skipped: true, reason: "no_phones" };

  const creds = await wablasCreds(tenant);
  if (!creds) return { skipped: true, reason: "wablas_not_configured" };

  const tenantKey = opts.tenantKey || tenant?.key || "";
  const message = buildAssignedMessage(job, tenantKey);
  const results = [];
  for (const phone of phones) {
    try {
      await sendWablasMessage({ ...creds, phone, message });
      results.push({ phone, ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[dispatch] assigned WhatsApp", phone, msg);
      results.push({ phone, ok: false, error: msg });
    }
  }
  return { sent: results.filter((r) => r.ok).length, results };
}
