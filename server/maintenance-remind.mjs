/**
 * Maintenance reminder fan-out: platform inbox + Wablas + SMTP.
 */
import { databaseUrlConfigured, dbQuery } from "./db.mjs";
import { decryptSecret, secretsKeyConfigured } from "./crypto-secrets.mjs";
import { parseRecipientList, sendWablasMessage } from "./wablas.mjs";
import { parseEmails, sendSmtpMail, smtpConfigured } from "./smtp-mail.mjs";
import { computeHoursAccrued, computeKmAccrued, publicEvent } from "./maintenance-api.mjs";
import { tenantByKey } from "./tenants.mjs";

const SELECT_EVENT = `id, status, title, notes, armada_user_id, armada_username, user_display_name,
  lat, lon, notification_id, started_at, ended_at, odometer_km,
  service_point_id, service_point_name, service_point_lat, service_point_lon,
  assigned_field_user_id,
  remind_due_at, remind_interval_days, remind_interval_km, remind_baseline_odometer_km,
  remind_interval_hours, remind_hours_since_at,
  remind_before_days, remind_before_km, remind_before_hours, parent_event_id,
  created_at, updated_at`;

function publicBase() {
  return String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
}

function eventLink(tenantKey, eventId) {
  const base = publicBase() || "";
  const path = `/maintenance?k=${encodeURIComponent(tenantKey)}&eventId=${encodeURIComponent(eventId)}`;
  return base ? `${base}${path}` : path;
}

export function publicReminder(row) {
  return {
    id: row.id,
    eventId: row.event_id || null,
    kind: row.kind,
    channel: row.channel,
    recipient: row.recipient || "",
    title: row.title || "",
    body: row.body || "",
    payload: row.payload && typeof row.payload === "object" ? row.payload : {},
    ackedAt: row.acked_at || null,
    sentAt: row.sent_at || null,
    error: row.error || "",
    createdAt: row.created_at,
  };
}

async function loadTenantNotify(tenantId) {
  const res = await dbQuery(
    `SELECT key, notify_emails, notify_whatsapp, wablas_base_url,
            wablas_token_ciphertext, wablas_secret_ciphertext, app_id
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

async function recipientsForEvent(tenantId, event) {
  const tenant = await loadTenantNotify(tenantId);
  const phones = new Set(parseRecipientList(tenant?.notify_whatsapp));
  const emails = new Set(parseEmails(tenant?.notify_emails));
  const assignedId = event.assignedFieldUserId || event.assigned_field_user_id;
  if (assignedId) {
    const fu = await dbQuery(
      `SELECT phone, email FROM field_users WHERE id = $1 AND tenant_id = $2 AND enabled = true`,
      [assignedId, tenantId],
    );
    const p = parseRecipientList(fu.rows[0]?.phone || "")[0];
    if (p) phones.add(p);
    for (const e of parseEmails(fu.rows[0]?.email || "")) emails.add(e);
  }
  return {
    tenant,
    phones: [...phones].filter(Boolean),
    emails: [...emails],
  };
}

export async function emitReminder({
  tenantId,
  tenantKey,
  eventId,
  kind,
  channel,
  recipient,
  title,
  body,
  payload = {},
  send = true,
}) {
  const dedupe = `${tenantId}:${eventId || "none"}:${kind}:${channel}:${recipient || "_"}`;
  const inserted = await dbQuery(
    `INSERT INTO maintenance_reminders (
       tenant_id, event_id, kind, channel, recipient, title, body, payload, dedupe_key
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING *`,
    [
      tenantId,
      eventId || null,
      kind,
      channel,
      recipient || null,
      title,
      body,
      JSON.stringify(payload),
      dedupe,
    ],
  );
  const row = inserted.rows[0];
  if (!row) return { skipped: true, reason: "deduped" };

  if (!send || channel === "platform") {
    if (channel === "platform") {
      await dbQuery(`UPDATE maintenance_reminders SET sent_at = now() WHERE id = $1`, [row.id]);
    }
    return { reminder: publicReminder(row) };
  }

  try {
    if (channel === "whatsapp") {
      const tenant = await loadTenantNotify(tenantId);
      const creds = await wablasCreds(tenant);
      if (!creds) {
        await dbQuery(
          `UPDATE maintenance_reminders SET error = $2 WHERE id = $1`,
          [row.id, "Wablas not configured"],
        );
        return { reminder: publicReminder({ ...row, error: "Wablas not configured" }), skipped: true };
      }
      await sendWablasMessage({
        ...creds,
        phone: recipient,
        message: `${title}\n\n${body}\n\n${eventLink(tenantKey || tenant?.key || "", eventId)}`,
      });
    } else if (channel === "email") {
      if (!smtpConfigured()) {
        await dbQuery(
          `UPDATE maintenance_reminders SET error = $2 WHERE id = $1`,
          [row.id, "SMTP not configured"],
        );
        return { reminder: publicReminder({ ...row, error: "SMTP not configured" }), skipped: true };
      }
      await sendSmtpMail({
        to: recipient,
        subject: title,
        text: `${body}\n\n${eventLink(tenantKey || "", eventId)}`,
      });
    }
    await dbQuery(`UPDATE maintenance_reminders SET sent_at = now(), error = NULL WHERE id = $1`, [row.id]);
    return { reminder: publicReminder({ ...row, sent_at: new Date().toISOString() }) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await dbQuery(`UPDATE maintenance_reminders SET error = $2 WHERE id = $1`, [row.id, message.slice(0, 500)]);
    return { reminder: publicReminder({ ...row, error: message }), error: message };
  }
}

export async function fanOutEventReminder({
  tenantId,
  tenantKey,
  event,
  kind,
  title,
  body,
  payload = {},
}) {
  const eventId = event.id;
  const { phones, emails } = await recipientsForEvent(tenantId, event);
  const results = [];
  results.push(
    await emitReminder({
      tenantId,
      tenantKey,
      eventId,
      kind,
      channel: "platform",
      recipient: null,
      title,
      body,
      payload,
    }),
  );
  for (const phone of phones) {
    results.push(
      await emitReminder({
        tenantId,
        tenantKey,
        eventId,
        kind,
        channel: "whatsapp",
        recipient: phone,
        title,
        body,
        payload,
      }),
    );
  }
  for (const email of emails) {
    results.push(
      await emitReminder({
        tenantId,
        tenantKey,
        eventId,
        kind,
        channel: "email",
        recipient: email,
        title,
        body,
        payload,
      }),
    );
  }
  return results;
}

function vehicleLabel(ev) {
  return ev.userDisplayName || ev.armadaUsername || (ev.armadaUserId ? `#${ev.armadaUserId}` : "Vehicle");
}

function hasSchedule(ev) {
  return Boolean(
    (ev.remindIntervalDays != null && ev.remindIntervalDays > 0) ||
      (ev.remindIntervalKm != null && ev.remindIntervalKm > 0) ||
      (ev.remindIntervalHours != null && ev.remindIntervalHours > 0) ||
      ev.remindDueAt,
  );
}

/**
 * @param {string} tenantId
 * @param {{ key: string, appId: number, token: string }} vaultTenant
 */
export async function evaluateTenantReminders(tenantId, vaultTenant) {
  if (!databaseUrlConfigured()) return { checked: 0, emitted: 0 };
  const rows = await dbQuery(
    `SELECT ${SELECT_EVENT} FROM service_events
     WHERE tenant_id = $1 AND status IN ('due', 'in_progress')
     ORDER BY created_at DESC LIMIT 200`,
    [tenantId],
  );
  let emitted = 0;
  const now = Date.now();
  for (const row of rows.rows) {
    const ev = publicEvent(row);
    if (!hasSchedule(ev)) continue;

    const beforeDays = ev.remindBeforeDays ?? 7;
    const beforeKm = ev.remindBeforeKm ?? 500;
    const beforeHours =
      ev.remindBeforeHours ??
      (ev.remindIntervalHours != null ? Math.max(1, ev.remindIntervalHours * 0.1) : 10);

    let kind = null;
    const bits = [];

    if (ev.remindDueAt) {
      const dueMs = Date.parse(ev.remindDueAt);
      if (Number.isFinite(dueMs)) {
        const leadMs = (Number(beforeDays) || 7) * 86400000;
        if (now >= dueMs) {
          kind = "overdue";
          bits.push("past due date");
        } else if (now >= dueMs - leadMs) {
          kind = "due_soon";
          bits.push(`due date ${ev.remindDueAt.slice(0, 10)}`);
        }
      }
    }

    if (ev.remindIntervalDays != null && ev.remindIntervalDays > 0 && ev.createdAt) {
      const start = Date.parse(ev.remindDueAt || ev.createdAt);
      if (Number.isFinite(start)) {
        const dueMs = ev.remindDueAt
          ? Date.parse(ev.remindDueAt)
          : start + ev.remindIntervalDays * 86400000;
        const leadMs = (Number(beforeDays) || 7) * 86400000;
        if (now >= dueMs) {
          kind = "overdue";
          bits.push(`interval ${ev.remindIntervalDays}d overdue`);
        } else if (now >= dueMs - leadMs) {
          if (kind !== "overdue") kind = "due_soon";
          bits.push(`interval ${ev.remindIntervalDays}d soon`);
        }
      }
    }

    if (ev.remindIntervalKm != null && vaultTenant?.token) {
      try {
        const km = await computeKmAccrued(ev, vaultTenant);
        if (km.kmAccrued != null && km.intervalKm != null) {
          const remaining = km.intervalKm - km.kmAccrued;
          if (remaining <= 0) {
            kind = "overdue";
            bits.push(`odo overdue (${km.kmAccrued}/${km.intervalKm} km)`);
          } else if (remaining <= (Number(beforeKm) || 500)) {
            if (kind !== "overdue") kind = "due_soon";
            bits.push(`${remaining.toFixed(0)} km remaining`);
          }
        }
      } catch {
        /* ignore */
      }
    }

    if (ev.remindIntervalHours != null && vaultTenant?.token) {
      try {
        const hrs = await computeHoursAccrued(ev, vaultTenant);
        if (hrs.hoursAccrued != null && hrs.intervalHours != null) {
          const remaining = hrs.intervalHours - hrs.hoursAccrued;
          if (remaining <= 0) {
            kind = "overdue";
            bits.push(`hours overdue (${hrs.hoursAccrued}/${hrs.intervalHours} h)`);
          } else if (remaining <= (Number(beforeHours) || 10)) {
            if (kind !== "overdue") kind = "due_soon";
            bits.push(`${remaining.toFixed(1)} h remaining`);
          }
        }
      } catch {
        /* ignore */
      }
    }

    if (!kind) continue;
    const title =
      kind === "overdue"
        ? `Maintenance overdue · ${vehicleLabel(ev)}`
        : `Maintenance due soon · ${vehicleLabel(ev)}`;
    const body = `${ev.title} — ${bits.join("; ")}`;
    const results = await fanOutEventReminder({
      tenantId,
      tenantKey: vaultTenant.key,
      event: ev,
      kind,
      title,
      body,
      payload: { bits },
    });
    emitted += results.filter((r) => r.reminder && !r.skipped).length;
  }
  return { checked: rows.rows.length, emitted };
}

export async function evaluateAllTenantReminders() {
  if (!databaseUrlConfigured()) return { tenants: 0, emitted: 0 };
  const tenants = await dbQuery(`SELECT id, key FROM tenants WHERE enabled = true`);
  let emitted = 0;
  for (const t of tenants.rows) {
    const vault = tenantByKey(t.key);
    if (!vault?.token) continue;
    const r = await evaluateTenantReminders(t.id, vault);
    emitted += r.emitted;
  }
  return { tenants: tenants.rows.length, emitted };
}
