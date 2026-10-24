/**
 * Fleet Live Reports v1 — Device Source column picker, run-now, scheduled CSV email.
 */
import { dbQuery } from "./db.mjs";
import { evalFormula } from "./fleet-alert-rules.mjs";
import { todayKeyFromOffset } from "./day-tracks-cache.mjs";
import { parseEmails, sendSmtpMail, smtpConfigured } from "./smtp-mail.mjs";

const PREVIEW_CAP = 5000;
const EXPORT_CAP = 20000;
const COL_ID_RE = /^[a-zA-Z0-9_.:/-]{1,64}$/;

export const REPORT_FIX_COLUMNS = [
  { id: "device", label: "Device" },
  { id: "imei", label: "IMEI" },
  { id: "recorded_at", label: "Time" },
  { id: "lat", label: "Lat" },
  { id: "lon", label: "Lon" },
  { id: "speed", label: "Speed" },
  { id: "heading", label: "Heading" },
  { id: "ignition", label: "Ignition" },
  { id: "odometer_km", label: "Odometer km" },
  { id: "altitude", label: "Altitude" },
  { id: "protocol", label: "Protocol" },
];

export const REPORT_DAILY_COLUMNS = [
  { id: "device", label: "Device" },
  { id: "imei", label: "IMEI" },
  { id: "date", label: "Date" },
  { id: "fix_count", label: "Fixes" },
  { id: "avg_speed", label: "Avg speed" },
  { id: "max_speed", label: "Max speed" },
  { id: "first_at", label: "First fix" },
  { id: "last_at", label: "Last fix" },
  { id: "odo_start", label: "Odo start" },
  { id: "odo_end", label: "Odo end" },
  { id: "ignition_on", label: "Ignition-on fixes" },
];

const FIX_IDS = new Set(REPORT_FIX_COLUMNS.map((c) => c.id));
const DAILY_IDS = new Set(REPORT_DAILY_COLUMNS.map((c) => c.id));

function asNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function addDays(dateYmd, days) {
  const utc = Date.parse(`${dateYmd}T12:00:00Z`);
  return new Date(utc + days * 86_400_000).toISOString().slice(0, 10);
}

function validTz(raw) {
  return /^[+-]\d{2}:\d{2}$/.test(String(raw || "").trim()) ? String(raw).trim() : "+07:00";
}

function isMappedCol(id) {
  return /^mapped\.[a-zA-Z0-9_.:/-]{1,64}$/.test(String(id || ""));
}

function isColId(id, grain) {
  const s = String(id || "").trim();
  if (grain === "daily") return DAILY_IDS.has(s);
  return FIX_IDS.has(s) || isMappedCol(s);
}

function normalizeFilters(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => c && c.field)
    .slice(0, 12)
    .map((c) => ({
      field: String(c.field).trim().slice(0, 80),
      cmp: String(c.cmp || "=="),
      value: c.value,
    }));
}

function normalizeColumns(raw, grain) {
  const ids = Array.isArray(raw) ? raw.map((c) => String(c || "").trim()) : [];
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    if (!isColId(id, grain) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 24) break;
  }
  if (out.length) return out;
  return grain === "daily"
    ? ["device", "date", "fix_count", "max_speed"]
    : ["device", "recorded_at", "lat", "lon", "speed", "ignition"];
}

export function normalizeReportSpec(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const grain = s.grain === "daily" ? "daily" : "fixes";
  const rangeKind = ["today", "last7", "last30", "custom"].includes(s.rangeKind) ? s.rangeKind : "today";
  const scopeKind = ["all", "group", "devices"].includes(s.scopeKind) ? s.scopeKind : "all";
  const deviceIds = Array.isArray(s.scopeDeviceIds)
    ? s.scopeDeviceIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 80)
    : [];
  return {
    grain,
    rangeKind,
    dateFrom: /^\d{4}-\d{2}-\d{2}$/.test(String(s.dateFrom || "")) ? String(s.dateFrom) : "",
    dateTo: /^\d{4}-\d{2}-\d{2}$/.test(String(s.dateTo || "")) ? String(s.dateTo) : "",
    timezone: validTz(s.timezone),
    scopeKind,
    scopeGroupId: scopeKind === "group" && /^[0-9a-f-]{36}$/i.test(String(s.scopeGroupId || ""))
      ? String(s.scopeGroupId)
      : null,
    scopeDeviceIds: scopeKind === "devices" ? deviceIds : [],
    columns: normalizeColumns(s.columns, grain),
    format: s.format === "xlsx" ? "xlsx" : "csv",
    filters: normalizeFilters(s.filters),
  };
}

export function resolveReportRange(spec, nowMs = Date.now()) {
  const tz = validTz(spec.timezone);
  const today = todayKeyFromOffset(tz, nowMs);
  if (spec.rangeKind === "last7") return { from: addDays(today, -6), to: today, timezone: tz };
  if (spec.rangeKind === "last30") return { from: addDays(today, -29), to: today, timezone: tz };
  if (spec.rangeKind === "custom" && spec.dateFrom && spec.dateTo && spec.dateTo >= spec.dateFrom) {
    return { from: spec.dateFrom, to: spec.dateTo, timezone: tz };
  }
  return { from: today, to: today, timezone: tz };
}

function mapReport(r) {
  return {
    id: r.id,
    name: r.name,
    enabled: Boolean(r.enabled),
    source: r.source || "device",
    spec: normalizeReportSpec(r.spec),
    recipients: r.recipients || "",
    ccTenantNotify: Boolean(r.cc_tenant_notify),
    scheduleKind: r.schedule_kind,
    scheduleHour: Number(r.schedule_hour) || 0,
    scheduleWeekday: Number(r.schedule_weekday) || 0,
    lastRunAt: r.last_run_at || null,
    lastError: r.last_error || "",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function scopeWhere(spec, params) {
  if (spec.scopeKind === "devices" && spec.scopeDeviceIds.length) {
    params.push(spec.scopeDeviceIds);
    return `AND d.id = ANY($${params.length}::uuid[])`;
  }
  if (spec.scopeKind === "group" && spec.scopeGroupId) {
    params.push(spec.scopeGroupId);
    return `AND EXISTS (
      SELECT 1 FROM tracker_device_group_members m
      WHERE m.device_id = d.id AND m.group_id = $${params.length}::uuid
    )`;
  }
  return "";
}

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function reportToCsv(headers, rows) {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) lines.push(row.map(csvEscape).join(","));
  return `${lines.join("\n")}\n`;
}

function columnLabel(id, grain) {
  const list = grain === "daily" ? REPORT_DAILY_COLUMNS : REPORT_FIX_COLUMNS;
  const hit = list.find((c) => c.id === id);
  if (hit) return hit.label;
  return id.startsWith("mapped.") ? id.slice(7) : id;
}

function pickFixValue(col, row) {
  switch (col) {
    case "device":
      return row.label || row.imei || "";
    case "imei":
      return row.imei || "";
    case "recorded_at":
      return row.recorded_at instanceof Date ? row.recorded_at.toISOString() : String(row.recorded_at || "");
    case "lat":
      return asNumber(row.lat);
    case "lon":
      return asNumber(row.lon);
    case "speed":
      return asNumber(row.speed);
    case "heading":
      return asNumber(row.heading);
    case "ignition":
      return row.ignition == null ? "" : row.ignition ? "on" : "off";
    case "odometer_km":
      return asNumber(row.odometer);
    case "altitude":
      return asNumber(row.altitude);
    case "protocol":
      return row.source_protocol || row.protocol || "";
    default:
      if (col.startsWith("mapped.")) {
        const mapped =
          row.mapped_attrs && typeof row.mapped_attrs === "object" && !Array.isArray(row.mapped_attrs)
            ? row.mapped_attrs
            : {};
        const v = mapped[col.slice(7)];
        return v == null ? "" : typeof v === "object" ? JSON.stringify(v) : v;
      }
      return "";
  }
}

function pickDailyValue(col, row) {
  switch (col) {
    case "device":
      return row.label || row.imei || "";
    case "imei":
      return row.imei || "";
    case "date":
      return row.date || "";
    case "fix_count":
      return Number(row.fix_count) || 0;
    case "avg_speed":
      return asNumber(row.avg_speed);
    case "max_speed":
      return asNumber(row.max_speed);
    case "first_at":
      return row.first_at instanceof Date ? row.first_at.toISOString() : String(row.first_at || "");
    case "last_at":
      return row.last_at instanceof Date ? row.last_at.toISOString() : String(row.last_at || "");
    case "odo_start":
      return asNumber(row.odo_start);
    case "odo_end":
      return asNumber(row.odo_end);
    case "ignition_on":
      return Number(row.ignition_on) || 0;
    default:
      return "";
  }
}

function rowSnap(row) {
  const mapped =
    row.mapped_attrs && typeof row.mapped_attrs === "object" && !Array.isArray(row.mapped_attrs)
      ? row.mapped_attrs
      : {};
  return {
    speed: asNumber(row.speed),
    heading: asNumber(row.heading),
    ignition: row.ignition == null ? null : Boolean(row.ignition),
    odometer_km: asNumber(row.odometer),
    mapped,
  };
}

export async function listReportColumnCatalog(tenantId, specLike = {}) {
  const spec = normalizeReportSpec(specLike);
  if (spec.grain === "daily") return { columns: REPORT_DAILY_COLUMNS };
  const params = [tenantId];
  const extra = scopeWhere(spec, params);
  const keys = await dbQuery(
    `SELECT DISTINCT jsonb_object_keys(COALESCE(lf.mapped_attrs, '{}'::jsonb)) AS key
     FROM tracker_devices d
     JOIN vehicle_last_fix lf ON lf.device_id = d.id
     WHERE d.tenant_id = $1 AND d.enabled = true
       ${extra}
     LIMIT 200`,
    params,
  );
  const mapped = [];
  const seen = new Set();
  for (const row of keys.rows) {
    const key = String(row.key || "").trim();
    if (!COL_ID_RE.test(key) || seen.has(key)) continue;
    seen.add(key);
    mapped.push({ id: `mapped.${key}`, label: key });
    if (mapped.length >= 80) break;
  }
  return { columns: [...REPORT_FIX_COLUMNS, ...mapped] };
}

export async function runFleetReport(tenantId, specLike, opts = {}) {
  const spec = normalizeReportSpec(specLike);
  const range = opts.range || resolveReportRange(spec);
  const startMs = Date.parse(`${range.from}T00:00:00${range.timezone}`);
  const endMs = Date.parse(`${range.to}T23:59:59.999${range.timezone}`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    const err = new Error("Invalid date range");
    err.status = 400;
    throw err;
  }
  const cap = Math.min(EXPORT_CAP, Math.max(1, Number(opts.limit) || PREVIEW_CAP));
  const fetchCap = spec.filters.length ? Math.min(EXPORT_CAP, cap * 2) : cap;
  const params = [tenantId, new Date(startMs).toISOString(), new Date(endMs).toISOString()];
  const extra = scopeWhere(spec, params);

  let rawRows;
  if (spec.grain === "daily") {
    params.push(range.timezone);
    const tzIdx = params.length;
    params.push(fetchCap);
    const limIdx = params.length;
    const dayExpr = `to_char((vf.recorded_at AT TIME ZONE 'UTC') + ($${tzIdx}::interval), 'YYYY-MM-DD')`;
    const q = await dbQuery(
      `SELECT d.label, d.imei,
              ${dayExpr} AS date,
              COUNT(*)::int AS fix_count,
              AVG(vf.speed) AS avg_speed,
              MAX(vf.speed) AS max_speed,
              MIN(vf.recorded_at) AS first_at,
              MAX(vf.recorded_at) AS last_at,
              MIN(vf.odometer) AS odo_start,
              MAX(vf.odometer) AS odo_end,
              COUNT(*) FILTER (WHERE vf.ignition = true)::int AS ignition_on
       FROM vehicle_fixes vf
       JOIN tracker_devices d ON d.id = vf.device_id AND d.tenant_id = vf.tenant_id
       WHERE vf.tenant_id = $1
         AND vf.recorded_at >= $2::timestamptz
         AND vf.recorded_at <= $3::timestamptz
         AND d.enabled = true
         ${extra}
       GROUP BY d.id, d.label, d.imei, ${dayExpr}
       ORDER BY date DESC, lower(d.label) ASC
       LIMIT $${limIdx}`,
      params,
    );
    rawRows = q.rows;
  } else {
    params.push(fetchCap);
    const q = await dbQuery(
      `SELECT d.label, d.imei, d.protocol,
              vf.lat, vf.lon, vf.speed, vf.heading, vf.ignition, vf.odometer, vf.altitude,
              vf.recorded_at, vf.source_protocol, vf.mapped_attrs
       FROM vehicle_fixes vf
       JOIN tracker_devices d ON d.id = vf.device_id AND d.tenant_id = vf.tenant_id
       WHERE vf.tenant_id = $1
         AND vf.recorded_at >= $2::timestamptz
         AND vf.recorded_at <= $3::timestamptz
         AND d.enabled = true
         ${extra}
       ORDER BY vf.recorded_at DESC
       LIMIT $${params.length}`,
      params,
    );
    rawRows = q.rows;
  }

  let filtered = rawRows;
  if (spec.filters.length && spec.grain !== "daily") {
    filtered = rawRows.filter((row) => evalFormula({ op: "and", conditions: spec.filters }, rowSnap(row)));
  }
  const truncated = filtered.length > cap || rawRows.length >= fetchCap;
  const sliced = filtered.slice(0, cap);
  const headers = spec.columns.map((id) => columnLabel(id, spec.grain));
  const rows = sliced.map((row) =>
    spec.columns.map((id) => (spec.grain === "daily" ? pickDailyValue(id, row) : pickFixValue(id, row))),
  );
  return {
    columns: spec.columns,
    headers,
    rows,
    rowCount: rows.length,
    truncated,
    range,
    grain: spec.grain,
  };
}

export async function listFleetReports(tenantId) {
  const rows = await dbQuery(
    `SELECT * FROM fleet_reports WHERE tenant_id = $1 ORDER BY lower(name) ASC`,
    [tenantId],
  );
  return rows.rows.map(mapReport);
}

export async function getFleetReport(tenantId, reportId) {
  const rows = await dbQuery(
    `SELECT * FROM fleet_reports WHERE tenant_id = $1 AND id = $2::uuid`,
    [tenantId, reportId],
  );
  return rows.rows[0] ? mapReport(rows.rows[0]) : null;
}

function scheduleFields(body, cur) {
  const kind = ["off", "daily", "weekly"].includes(body.scheduleKind)
    ? body.scheduleKind
    : cur?.scheduleKind || "off";
  const hour = Math.max(0, Math.min(23, Number(body.scheduleHour ?? cur?.scheduleHour ?? 7) || 0));
  const weekday = Math.max(0, Math.min(6, Number(body.scheduleWeekday ?? cur?.scheduleWeekday ?? 1) || 0));
  return { kind, hour, weekday };
}

export async function createFleetReport(tenantId, body) {
  const name = String(body.name || "").trim().slice(0, 120);
  if (!name) {
    const err = new Error("name required");
    err.status = 400;
    throw err;
  }
  const spec = normalizeReportSpec(body.spec);
  const sched = scheduleFields(body);
  const rows = await dbQuery(
    `INSERT INTO fleet_reports (
       tenant_id, name, enabled, source, spec, recipients, cc_tenant_notify,
       schedule_kind, schedule_hour, schedule_weekday
     ) VALUES ($1,$2,$3,'device',$4::jsonb,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      tenantId,
      name,
      body.enabled !== false,
      JSON.stringify(spec),
      String(body.recipients || "").trim().slice(0, 800),
      body.ccTenantNotify === true,
      sched.kind,
      sched.hour,
      sched.weekday,
    ],
  );
  return mapReport(rows.rows[0]);
}

export async function updateFleetReport(tenantId, reportId, body) {
  const cur = await getFleetReport(tenantId, reportId);
  if (!cur) {
    const err = new Error("Report not found");
    err.status = 404;
    throw err;
  }
  const name = body.name !== undefined ? String(body.name || "").trim().slice(0, 120) : cur.name;
  if (!name) {
    const err = new Error("name required");
    err.status = 400;
    throw err;
  }
  const spec = body.spec !== undefined ? normalizeReportSpec(body.spec) : cur.spec;
  const sched = scheduleFields(body, cur);
  const rows = await dbQuery(
    `UPDATE fleet_reports SET
       name = $3,
       enabled = $4,
       spec = $5::jsonb,
       recipients = $6,
       cc_tenant_notify = $7,
       schedule_kind = $8,
       schedule_hour = $9,
       schedule_weekday = $10,
       updated_at = now()
     WHERE tenant_id = $1 AND id = $2::uuid
     RETURNING *`,
    [
      tenantId,
      reportId,
      name,
      body.enabled !== undefined ? body.enabled === true : cur.enabled,
      JSON.stringify(spec),
      body.recipients !== undefined ? String(body.recipients || "").trim().slice(0, 800) : cur.recipients,
      body.ccTenantNotify !== undefined ? body.ccTenantNotify === true : cur.ccTenantNotify,
      sched.kind,
      sched.hour,
      sched.weekday,
    ],
  );
  return mapReport(rows.rows[0]);
}

export async function deleteFleetReport(tenantId, reportId) {
  const res = await dbQuery(
    `DELETE FROM fleet_reports WHERE tenant_id = $1 AND id = $2::uuid RETURNING id`,
    [tenantId, reportId],
  );
  return Boolean(res.rows[0]);
}

function localParts(ms, tz) {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(tz);
  const minutes = match
    ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
    : 0;
  const shifted = new Date(ms + minutes * 60_000);
  return {
    date: shifted.toISOString().slice(0, 10),
    hour: shifted.getUTCHours(),
    weekday: shifted.getUTCDay(),
  };
}

function isReportDue(report, nowMs) {
  if (!report.enabled || report.scheduleKind === "off") return false;
  const local = localParts(nowMs, report.spec.timezone);
  if (local.hour < report.scheduleHour) return false;
  if (report.scheduleKind === "weekly" && local.weekday !== report.scheduleWeekday) return false;
  if (report.lastRunAt) {
    const last = localParts(new Date(report.lastRunAt).getTime(), report.spec.timezone);
    if (last.date === local.date) return false;
  }
  return true;
}

async function markRun(tenantId, reportId, { status, rowCount, byteCount, error }) {
  await dbQuery(
    status === "ok"
      ? `UPDATE fleet_reports SET last_run_at = now(), last_error = '', updated_at = now()
         WHERE tenant_id = $1 AND id = $2::uuid`
      : `UPDATE fleet_reports SET last_error = $3, updated_at = now()
         WHERE tenant_id = $1 AND id = $2::uuid`,
    [tenantId, reportId, String(error || "").slice(0, 400)],
  );
  await dbQuery(
    `INSERT INTO fleet_report_runs (tenant_id, report_id, finished_at, row_count, byte_count, status, error)
     VALUES ($1,$2::uuid, now(), $3, $4, $5, $6)`,
    [tenantId, reportId, rowCount || 0, byteCount || 0, status, String(error || "").slice(0, 400)],
  );
}

async function deliverReport(tenantId, report) {
  const result = await runFleetReport(tenantId, report.spec, { limit: EXPORT_CAP });
  const csv = reportToCsv(result.headers, result.rows);
  const to = parseEmails(report.recipients);
  let cc = [];
  if (report.ccTenantNotify) {
    const t = await dbQuery(`SELECT notify_emails FROM tenants WHERE id = $1`, [tenantId]);
    cc = parseEmails(t.rows[0]?.notify_emails).slice(0, 8);
  }
  if (!to.length && !cc.length) throw new Error("No recipients");
  if (!smtpConfigured()) throw new Error("SMTP is not configured");
  const safe = report.name.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-") || "report";
  const filename = `${safe}-${result.range.from}-${result.range.to}.csv`;
  const sent = await sendSmtpMail({
    to: to.length ? to : cc,
    cc: to.length ? cc : [],
    subject: `Fleet report: ${report.name} (${result.range.from}–${result.range.to})`.slice(0, 180),
    text: `${report.name}\n${result.rowCount} rows${result.truncated ? " (truncated)" : ""}\n${result.range.from} to ${result.range.to}\n`,
    attachments: [{ filename, contentType: "text/csv; charset=utf-8", content: csv }],
  });
  if (sent?.skipped) throw new Error(sent.reason || "smtp skipped");
  return { rowCount: result.rowCount, byteCount: Buffer.byteLength(csv) };
}

export async function evaluateDueFleetReports() {
  const rows = await dbQuery(
    `SELECT * FROM fleet_reports
     WHERE enabled = true AND schedule_kind <> 'off'`,
  );
  const now = Date.now();
  let sent = 0;
  let failed = 0;
  for (const raw of rows.rows) {
    const report = mapReport(raw);
    if (!isReportDue(report, now)) continue;
    try {
      const out = await deliverReport(raw.tenant_id, report);
      await markRun(raw.tenant_id, report.id, { status: "ok", ...out, error: "" });
      sent += 1;
    } catch (err) {
      failed += 1;
      await markRun(raw.tenant_id, report.id, {
        status: "error",
        rowCount: 0,
        byteCount: 0,
        error: err instanceof Error ? err.message : String(err),
      }).catch(() => {});
      console.error("[fleet-reports] send", report.id, err instanceof Error ? err.message : err);
    }
  }
  return { sent, failed, tenants: new Set(rows.rows.map((r) => r.tenant_id)).size };
}
