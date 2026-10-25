/**
 * Fleet Live alert rules: CRUD, cooked-field evaluation, event write + notify.
 */
import { dbQuery } from "./db.mjs";
import { decryptSecret } from "./crypto-secrets.mjs";
import { parseRecipientList, sendWablasMessage } from "./wablas.mjs";
import { geofenceSnapFields, listTenantGeofences } from "./tenant-geofences.mjs";

const CMP = new Set([">", ">=", "<", "<=", "==", "!=", "in", "contains"]);

function asNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function ageSec(recordedAt) {
  if (!recordedAt) return null;
  const ms = recordedAt instanceof Date ? recordedAt.getTime() : Date.parse(recordedAt);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round((Date.now() - ms) / 1000));
}

/** Build cooked snapshot for one last-fix row + device. */
export function cookedSnapshot(deviceRow, fixRow) {
  const mapped =
    fixRow?.mapped_attrs && typeof fixRow.mapped_attrs === "object" && !Array.isArray(fixRow.mapped_attrs)
      ? fixRow.mapped_attrs
      : {};
  const odo = asNumber(fixRow?.odometer);
  const fuel = asNumber(mapped.fuel_level ?? mapped.fuelLevel);
  return {
    speed: asNumber(fixRow?.speed),
    heading: asNumber(fixRow?.heading),
    ignition: fixRow?.ignition == null ? null : Boolean(fixRow.ignition),
    age_sec: ageSec(fixRow?.recorded_at),
    odometer_km: odo,
    fuel_level: fuel,
    lat: asNumber(fixRow?.lat),
    lon: asNumber(fixRow?.lon),
    protocol: deviceRow?.protocol || fixRow?.source_protocol || "",
    mapped,
  };
}

function readField(snap, field) {
  const f = String(field || "").trim();
  if (!f) return null;
  if (Object.prototype.hasOwnProperty.call(snap, f)) return snap[f];
  if (f.startsWith("mapped.")) {
    return snap.mapped?.[f.slice(7)] ?? null;
  }
  return snap.mapped?.[f] ?? null;
}

function cmpValues(left, cmp, right) {
  if (!CMP.has(cmp)) return false;
  if (cmp === "in") {
    const list = Array.isArray(right)
      ? right
      : String(right || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
    return list.map(String).includes(String(left));
  }
  if (cmp === "contains") {
    return String(left ?? "")
      .toLowerCase()
      .includes(String(right ?? "").toLowerCase());
  }
  const ln = asNumber(left);
  const rn = asNumber(right);
  const useNum = ln != null && rn != null;
  const a = useNum ? ln : left;
  const b = useNum ? rn : right;
  switch (cmp) {
    case ">":
      return a > b;
    case ">=":
      return a >= b;
    case "<":
      return a < b;
    case "<=":
      return a <= b;
    case "==":
      return a === b || String(a) === String(b);
    case "!=":
      return a !== b && String(a) !== String(b);
    default:
      return false;
  }
}

export function evalFormula(formula, snap, depth = 0) {
  if (depth > 4) return false;
  const f = formula && typeof formula === "object" ? formula : {};
  const conditions = Array.isArray(f.conditions) ? f.conditions : [];
  const groups = Array.isArray(f.groups) ? f.groups : [];
  if (!conditions.length && !groups.length) return false;
  const op = String(f.op || "and").toLowerCase() === "or" ? "or" : "and";
  const results = [
    ...conditions.map((c) => {
      if (!c || typeof c !== "object") return false;
      return cmpValues(readField(snap, c.field), String(c.cmp || "=="), c.value);
    }),
    ...groups.map((g) => evalFormula(g, snap, depth + 1)),
  ];
  return op === "or" ? results.some(Boolean) : results.every(Boolean);
}

function normalizeFormula(raw, depth = 0) {
  if (depth > 4) return { op: "and", conditions: [], groups: [], durationSec: 0 };
  const f = raw && typeof raw === "object" ? raw : {};
  const conditions = Array.isArray(f.conditions)
    ? f.conditions
        .filter((c) => c && c.field)
        .map((c) => ({
          field: String(c.field).trim(),
          cmp: CMP.has(String(c.cmp)) ? String(c.cmp) : "==",
          value: c.value,
        }))
    : [];
  const groups = Array.isArray(f.groups)
    ? f.groups
        .filter((g) => g && typeof g === "object")
        .map((g) => {
          const nested = normalizeFormula({ ...g, durationSec: 0, branches: undefined }, depth + 1);
          return { op: nested.op, conditions: nested.conditions, groups: nested.groups };
        })
        .filter((g) => g.conditions.length || g.groups.length)
    : [];
  const durationSec = depth === 0 ? Math.max(0, Math.min(86400, Number(f.durationSec) || 0)) : 0;
  const branches = depth === 0 ? normalizeBranches(f.branches) : [];
  return {
    op: String(f.op || "and").toLowerCase() === "or" ? "or" : "and",
    conditions,
    groups,
    durationSec,
    ...(branches.length ? { branches } : {}),
  };
}

function normalizeBranches(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 6)
    .map((b, i) => {
      if (!b || typeof b !== "object") return null;
      const formula = normalizeFormula(
        { ...(b.formula && typeof b.formula === "object" ? b.formula : b), durationSec: 0, branches: undefined },
        1,
      );
      if (!formula.conditions.length && !formula.groups.length) return null;
      return {
        label: String(b.label || (i === 0 ? "When" : "Else when")).slice(0, 80),
        formula: { op: formula.op, conditions: formula.conditions, groups: formula.groups },
        severity: ["info", "warning", "critical"].includes(b.severity) ? b.severity : "warning",
        notifyEmail: b.notifyEmail === true,
        notifyWhatsapp: b.notifyWhatsapp === true,
      };
    })
    .filter(Boolean);
}

function formulaHasTerms(formula) {
  if (formula?.branches?.length) {
    return formula.branches.some((b) => formulaHasTerms(b.formula));
  }
  return Boolean(formula?.conditions?.length || formula?.groups?.length);
}

/** First matching WHEN / ELSE WHEN, or the top-level formula when there are no branches. */
export function matchFormula(formula, snap) {
  const f = formula && typeof formula === "object" ? formula : {};
  const branches = Array.isArray(f.branches) ? f.branches : [];
  if (branches.length) {
    for (const b of branches) {
      if (evalFormula(b.formula, snap)) return { hit: true, branch: b };
    }
    return { hit: false, branch: null };
  }
  return { hit: evalFormula(f, snap), branch: null };
}

function formulaDetail(formula) {
  const f = formula && typeof formula === "object" ? formula : {};
  const conds = Array.isArray(f.conditions)
    ? f.conditions.map((c) => `${c.field} ${c.cmp} ${JSON.stringify(c.value)}`)
    : [];
  const groups = Array.isArray(f.groups)
    ? f.groups.map((g) => {
        const inner = formulaDetail(g);
        return inner ? `(${inner})` : "";
      }).filter(Boolean)
    : [];
  return [...conds, ...groups].join(f.op === "or" ? " OR " : " AND ");
}

function mapRule(r) {
  return {
    id: r.id,
    name: r.name,
    enabled: Boolean(r.enabled),
    severity: r.severity,
    scopeKind: r.scope_kind,
    scopeGroupId: r.scope_group_id || null,
    scopeDeviceIds: Array.isArray(r.scope_device_ids) ? r.scope_device_ids : [],
    formula: normalizeFormula(r.formula),
    notifyEmail: Boolean(r.notify_email),
    notifyWhatsapp: Boolean(r.notify_whatsapp),
    cooldownSec: Number(r.cooldown_sec) || 300,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listFleetAlertRules(tenantId) {
  const rows = await dbQuery(
    `SELECT * FROM fleet_alert_rules WHERE tenant_id = $1 ORDER BY lower(name) ASC`,
    [tenantId],
  );
  return rows.rows.map(mapRule);
}

export async function getFleetAlertRule(tenantId, ruleId) {
  const rows = await dbQuery(
    `SELECT * FROM fleet_alert_rules WHERE tenant_id = $1 AND id = $2::uuid`,
    [tenantId, ruleId],
  );
  return rows.rows[0] ? mapRule(rows.rows[0]) : null;
}

export async function createFleetAlertRule(tenantId, body) {
  const name = String(body.name || "").trim().slice(0, 120);
  if (!name) {
    const err = new Error("name required");
    err.status = 400;
    throw err;
  }
  const formula = normalizeFormula(body.formula);
  if (!formulaHasTerms(formula)) {
    const err = new Error("At least one condition required");
    err.status = 400;
    throw err;
  }
  const severity = ["info", "warning", "critical"].includes(body.severity) ? body.severity : "warning";
  const scopeKind = ["all", "group", "devices"].includes(body.scopeKind) ? body.scopeKind : "all";
  const scopeGroupId = scopeKind === "group" ? body.scopeGroupId || null : null;
  const scopeDeviceIds =
    scopeKind === "devices" && Array.isArray(body.scopeDeviceIds)
      ? body.scopeDeviceIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id))
      : [];
  const rows = await dbQuery(
    `INSERT INTO fleet_alert_rules (
       tenant_id, name, enabled, severity, scope_kind, scope_group_id, scope_device_ids,
       formula, notify_email, notify_whatsapp, cooldown_sec
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::uuid[],$8::jsonb,$9,$10,$11)
     RETURNING *`,
    [
      tenantId,
      name,
      body.enabled !== false,
      severity,
      scopeKind,
      scopeGroupId,
      scopeDeviceIds,
      JSON.stringify(formula),
      body.notifyEmail === true,
      body.notifyWhatsapp === true,
      Math.max(60, Math.min(86400, Number(body.cooldownSec) || 300)),
    ],
  );
  return mapRule(rows.rows[0]);
}

export async function updateFleetAlertRule(tenantId, ruleId, body) {
  const cur = await getFleetAlertRule(tenantId, ruleId);
  if (!cur) {
    const err = new Error("Rule not found");
    err.status = 404;
    throw err;
  }
  const name = body.name !== undefined ? String(body.name || "").trim().slice(0, 120) : cur.name;
  const formula = body.formula !== undefined ? normalizeFormula(body.formula) : cur.formula;
  if (!name || !formulaHasTerms(formula)) {
    const err = new Error("name and conditions required");
    err.status = 400;
    throw err;
  }
  const severity =
    body.severity !== undefined && ["info", "warning", "critical"].includes(body.severity)
      ? body.severity
      : cur.severity;
  const scopeKind =
    body.scopeKind !== undefined && ["all", "group", "devices"].includes(body.scopeKind)
      ? body.scopeKind
      : cur.scopeKind;
  const scopeGroupId =
    scopeKind === "group"
      ? body.scopeGroupId !== undefined
        ? body.scopeGroupId || null
        : cur.scopeGroupId
      : null;
  const scopeDeviceIds =
    scopeKind === "devices"
      ? body.scopeDeviceIds !== undefined
        ? (Array.isArray(body.scopeDeviceIds) ? body.scopeDeviceIds : []).filter((id) =>
            /^[0-9a-f-]{36}$/i.test(id),
          )
        : cur.scopeDeviceIds
      : [];
  const rows = await dbQuery(
    `UPDATE fleet_alert_rules SET
       name = $3,
       enabled = $4,
       severity = $5,
       scope_kind = $6,
       scope_group_id = $7,
       scope_device_ids = $8::uuid[],
       formula = $9::jsonb,
       notify_email = $10,
       notify_whatsapp = $11,
       cooldown_sec = $12,
       updated_at = now()
     WHERE tenant_id = $1 AND id = $2::uuid
     RETURNING *`,
    [
      tenantId,
      ruleId,
      name,
      body.enabled !== undefined ? body.enabled === true : cur.enabled,
      severity,
      scopeKind,
      scopeGroupId,
      scopeDeviceIds,
      JSON.stringify(formula),
      body.notifyEmail !== undefined ? body.notifyEmail === true : cur.notifyEmail,
      body.notifyWhatsapp !== undefined ? body.notifyWhatsapp === true : cur.notifyWhatsapp,
      body.cooldownSec !== undefined
        ? Math.max(60, Math.min(86400, Number(body.cooldownSec) || 300))
        : cur.cooldownSec,
    ],
  );
  return mapRule(rows.rows[0]);
}

export async function deleteFleetAlertRule(tenantId, ruleId) {
  const res = await dbQuery(
    `DELETE FROM fleet_alert_rules WHERE tenant_id = $1 AND id = $2::uuid RETURNING id`,
    [tenantId, ruleId],
  );
  return Boolean(res.rows[0]);
}

function mapFleetAlertEvent(r) {
  const payload =
    r.payload && typeof r.payload === "object" && !Array.isArray(r.payload) ? r.payload : {};
  return {
    id: r.id,
    ruleId: r.rule_id,
    ruleName: r.rule_name || "",
    deviceId: r.device_id,
    deviceLabel: r.device_label || r.imei || "",
    imei: r.imei || "",
    severity: r.severity,
    title: r.title,
    detail: r.detail || "",
    lat: r.lat == null ? null : Number(r.lat),
    lon: r.lon == null ? null : Number(r.lon),
    status: r.status,
    firedAt: r.fired_at,
    ackedAt: r.acked_at,
    resolvedAt: r.resolved_at,
    notifyEmailSent: Boolean(r.notify_email_sent),
    notifyWhatsappSent: Boolean(r.notify_whatsapp_sent),
    payload,
  };
}

const FLEET_EVENT_SELECT = `SELECT e.*, r.name AS rule_name, d.label AS device_label, d.imei
     FROM fleet_alert_events e
     LEFT JOIN fleet_alert_rules r ON r.id = e.rule_id
     LEFT JOIN tracker_devices d ON d.id = e.device_id`;

export async function listFleetAlertEvents(tenantId, { limit = 80, status } = {}) {
  const lim = Math.min(200, Math.max(1, Number(limit) || 80));
  const params = [tenantId];
  let where = "e.tenant_id = $1";
  if (status === "closed") {
    where += ` AND e.status IN ('acked', 'resolved')`;
  } else if (status && ["open", "acked", "resolved"].includes(status)) {
    params.push(status);
    where += ` AND e.status = $${params.length}`;
  }
  params.push(lim);
  const rows = await dbQuery(
    `${FLEET_EVENT_SELECT}
     WHERE ${where}
     ORDER BY e.fired_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return rows.rows.map(mapFleetAlertEvent);
}

export async function getFleetAlertEvent(tenantId, eventId) {
  const rows = await dbQuery(
    `${FLEET_EVENT_SELECT}
     WHERE e.tenant_id = $1 AND e.id = $2::uuid`,
    [tenantId, eventId],
  );
  return rows.rows[0] ? mapFleetAlertEvent(rows.rows[0]) : null;
}

/**
 * Active duration holds: condition true, waiting to meet durationSec (or ready/cooldown).
 */
export async function listFleetAlertRuleHolds(tenantId, { limit = 40 } = {}) {
  const lim = Math.min(100, Math.max(1, Number(limit) || 40));
  const rows = await dbQuery(
    `SELECT s.rule_id, s.device_id, s.true_since, s.last_eval_at, s.last_fired_at,
            r.name AS rule_name, r.severity, r.formula, r.cooldown_sec,
            d.label AS device_label, d.imei
     FROM fleet_alert_rule_state s
     JOIN fleet_alert_rules r ON r.id = s.rule_id AND r.tenant_id = s.tenant_id
     LEFT JOIN tracker_devices d ON d.id = s.device_id
     WHERE s.tenant_id = $1
       AND s.true_since IS NOT NULL
       AND r.enabled = true
       AND COALESCE((r.formula->>'durationSec')::int, 0) > 0
     ORDER BY s.true_since ASC
     LIMIT $2`,
    [tenantId, lim],
  );
  const now = Date.now();
  return rows.rows.map((r) => {
    const formula = r.formula && typeof r.formula === "object" ? r.formula : {};
    const durationSec = Math.max(0, Number(formula.durationSec) || 0);
    const trueSinceMs = r.true_since ? new Date(r.true_since).getTime() : now;
    const heldSec = Math.max(0, Math.round((now - trueSinceMs) / 1000));
    const cooldownSec = Number(r.cooldown_sec) || 300;
    const lastFiredMs = r.last_fired_at ? new Date(r.last_fired_at).getTime() : null;
    const inCooldown =
      lastFiredMs != null && Number.isFinite(lastFiredMs) && now - lastFiredMs < cooldownSec * 1000;
    const progress =
      durationSec > 0 ? Math.min(100, Math.round((heldSec / durationSec) * 100)) : 100;
    let phase = "holding";
    if (heldSec >= durationSec) phase = inCooldown ? "cooldown" : "ready";
    return {
      ruleId: r.rule_id,
      ruleName: r.rule_name || "",
      deviceId: r.device_id,
      deviceLabel: r.device_label || r.imei || "",
      severity: r.severity,
      trueSince: r.true_since,
      heldSec,
      durationSec,
      progress,
      phase,
      cooldownSec,
      lastEvalAt: r.last_eval_at,
      lastFiredAt: r.last_fired_at,
    };
  });
}

export async function ackFleetAlertEvent(tenantId, eventId) {
  const rows = await dbQuery(
    `UPDATE fleet_alert_events
     SET status = 'acked', acked_at = now()
     WHERE tenant_id = $1 AND id = $2::uuid AND status = 'open'
     RETURNING id`,
    [tenantId, eventId],
  );
  return Boolean(rows.rows[0]);
}

export async function resolveFleetAlertEvent(tenantId, eventId) {
  const rows = await dbQuery(
    `UPDATE fleet_alert_events
     SET status = 'resolved',
         resolved_at = now(),
         acked_at = COALESCE(acked_at, now())
     WHERE tenant_id = $1 AND id = $2::uuid AND status IN ('open', 'acked')
     RETURNING id`,
    [tenantId, eventId],
  );
  return Boolean(rows.rows[0]);
}

export async function unackFleetAlertEvent(tenantId, eventId) {
  const rows = await dbQuery(
    `UPDATE fleet_alert_events
     SET status = 'open', acked_at = NULL, resolved_at = NULL
     WHERE tenant_id = $1 AND id = $2::uuid AND status IN ('acked', 'resolved')
     RETURNING id`,
    [tenantId, eventId],
  );
  return Boolean(rows.rows[0]);
}

async function deviceInScope(tenantId, rule, deviceId) {
  if (rule.scopeKind === "all") return true;
  if (rule.scopeKind === "devices") return rule.scopeDeviceIds.includes(deviceId);
  if (rule.scopeKind === "group" && rule.scopeGroupId) {
    const rows = await dbQuery(
      `SELECT 1 FROM tracker_device_group_members
       WHERE group_id = $1::uuid AND device_id = $2::uuid`,
      [rule.scopeGroupId, deviceId],
    );
    return Boolean(rows.rows[0]);
  }
  return false;
}

async function sendRuleNotify(tenantId, rule, eventTitle, detail) {
  const t = await dbQuery(
    `SELECT notify_emails, notify_whatsapp, wablas_base_url,
            wablas_token_ciphertext, wablas_secret_ciphertext
     FROM tenants WHERE id = $1`,
    [tenantId],
  );
  const row = t.rows[0];
  if (!row) return { email: false, whatsapp: false };
  let emailOk = false;
  let waOk = false;
  const msg = `[Fleet Alert · ${rule.severity}] ${eventTitle}\n${detail}`.slice(0, 1000);

  if (rule.notifyEmail && row.notify_emails) {
    try {
      const { parseEmails, sendSmtpMail, smtpConfigured } = await import("./smtp-mail.mjs");
      if (smtpConfigured()) {
        const emails = parseEmails(row.notify_emails).slice(0, 8);
        for (const to of emails) {
          await sendSmtpMail({
            to,
            subject: `Fleet alert: ${eventTitle}`.slice(0, 180),
            text: msg,
          });
          emailOk = true;
        }
      }
    } catch {
      /* optional path */
    }
  }

  if (rule.notifyWhatsapp && row.notify_whatsapp) {
    try {
      const token = row.wablas_token_ciphertext ? decryptSecret(row.wablas_token_ciphertext) : "";
      const secret = row.wablas_secret_ciphertext ? decryptSecret(row.wablas_secret_ciphertext) : "";
      const phones = parseRecipientList(row.notify_whatsapp);
      for (const phone of phones.slice(0, 5)) {
        await sendWablasMessage({
          baseUrl: row.wablas_base_url || "",
          token,
          secretKey: secret,
          phone,
          message: msg,
        });
        waOk = true;
      }
    } catch {
      /* ignore notify failures */
    }
  }
  return { email: emailOk, whatsapp: waOk };
}

/**
 * Evaluate enabled rules for one device after a fresh last-fix write.
 */
export async function evaluateRulesForDevice(tenantId, deviceRow, fixRow) {
  if (!tenantId || !deviceRow?.id) return;
  const rules = await listFleetAlertRules(tenantId);
  const enabled = rules.filter((r) => r.enabled);
  if (!enabled.length) return;

  const snap = cookedSnapshot(deviceRow, fixRow);
  const fences = await listTenantGeofences(tenantId, { enabledOnly: true }).catch(() => []);
  Object.assign(snap, geofenceSnapFields(snap.lat, snap.lon, fences));
  const now = new Date();

  for (const rule of enabled) {
    try {
      if (!(await deviceInScope(tenantId, rule, deviceRow.id))) continue;
      const match = matchFormula(rule.formula, snap);
      const hit = match.hit;
      const durationSec = Number(rule.formula.durationSec) || 0;
      const action = {
        ...rule,
        severity: match.branch?.severity || rule.severity,
        notifyEmail: match.branch ? match.branch.notifyEmail === true : rule.notifyEmail,
        notifyWhatsapp: match.branch ? match.branch.notifyWhatsapp === true : rule.notifyWhatsapp,
      };

      const st = await dbQuery(
        `SELECT true_since, last_fired_at FROM fleet_alert_rule_state
         WHERE tenant_id = $1 AND rule_id = $2::uuid AND device_id = $3::uuid`,
        [tenantId, rule.id, deviceRow.id],
      );
      let trueSince = st.rows[0]?.true_since ? new Date(st.rows[0].true_since) : null;
      const lastFired = st.rows[0]?.last_fired_at ? new Date(st.rows[0].last_fired_at) : null;

      if (hit) {
        if (!trueSince) trueSince = now;
      } else {
        trueSince = null;
      }

      await dbQuery(
        `INSERT INTO fleet_alert_rule_state (tenant_id, rule_id, device_id, true_since, last_eval_at, last_fired_at)
         VALUES ($1,$2::uuid,$3::uuid,$4, now(), $5)
         ON CONFLICT (tenant_id, rule_id, device_id) DO UPDATE SET
           true_since = EXCLUDED.true_since,
           last_eval_at = now()`,
        [tenantId, rule.id, deviceRow.id, trueSince, lastFired],
      );

      if (!hit || !trueSince) continue;
      const heldSec = Math.round((now.getTime() - trueSince.getTime()) / 1000);
      if (durationSec > 0 && heldSec < durationSec) continue;

      const cooldown = rule.cooldownSec || 300;
      if (lastFired && now.getTime() - lastFired.getTime() < cooldown * 1000) continue;

      const fingerprint = `${rule.id}:${deviceRow.id}`;
      const title = rule.name;
      const detailParts = [];
      const matchText = formulaDetail(match.branch?.formula || rule.formula);
      if (match.branch?.label) detailParts.push(match.branch.label);
      if (matchText) detailParts.push(matchText);
      if (durationSec > 0) detailParts.push(`held ${heldSec}s (need ${durationSec}s)`);
      const detail = `${deviceRow.label || deviceRow.imei || deviceRow.id} · ${detailParts.join(" · ")}`;

      const notified = await sendRuleNotify(tenantId, action, title, detail);
      await dbQuery(
        `INSERT INTO fleet_alert_events (
           tenant_id, rule_id, device_id, severity, title, detail, lat, lon, fingerprint,
           notify_email_sent, notify_whatsapp_sent, payload
         ) VALUES ($1,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
        [
          tenantId,
          rule.id,
          deviceRow.id,
          action.severity,
          title,
          detail,
          snap.lat,
          snap.lon,
          fingerprint,
          notified.email,
          notified.whatsapp,
          JSON.stringify({
            snap,
            formula: rule.formula,
            GEOFENCE_NAME: snap.geofence_name || "",
          }),
        ],
      );
      await dbQuery(
        `UPDATE fleet_alert_rule_state SET last_fired_at = now()
         WHERE tenant_id = $1 AND rule_id = $2::uuid AND device_id = $3::uuid`,
        [tenantId, rule.id, deviceRow.id],
      );
    } catch (err) {
      console.error("[fleet-alert-rules] eval", rule.id, err?.message || err);
    }
  }
}

/** Evaluate a draft formula against a device's last fix (desk preview). */
export async function previewFleetAlertRule(tenantId, deviceId, formula) {
  const id = String(deviceId || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    const err = new Error("deviceId required");
    err.status = 400;
    throw err;
  }
  const rows = await dbQuery(
    `SELECT d.id, d.label, d.imei, d.protocol,
            lf.lat, lf.lon, lf.recorded_at, lf.speed, lf.heading, lf.ignition,
            lf.odometer, lf.mapped_attrs, lf.source_protocol
     FROM tracker_devices d
     JOIN vehicle_last_fix lf ON lf.device_id = d.id
     WHERE d.tenant_id = $1 AND d.id = $2::uuid AND d.enabled = true`,
    [tenantId, id],
  );
  const row = rows.rows[0];
  if (!row) {
    const err = new Error("No last fix for this device");
    err.status = 404;
    throw err;
  }
  const snap = cookedSnapshot(row, row);
  const fences = await listTenantGeofences(tenantId, { enabledOnly: true }).catch(() => []);
  Object.assign(snap, geofenceSnapFields(snap.lat, snap.lon, fences));
  const f = normalizeFormula(formula);
  const match = matchFormula(f, snap);
  return {
    result: match.hit,
    branch: match.branch?.label || "",
    label: row.label || row.imei || id,
    snap: {
      speed: snap.speed,
      ignition: snap.ignition,
      age_sec: snap.age_sec,
      fuel_level: snap.fuel_level,
      odometer_km: snap.odometer_km,
      heading: snap.heading,
      inside_geofence: snap.inside_geofence ?? null,
      geofence_name: snap.geofence_name || "",
      mapped: snap.mapped,
    },
  };
}
