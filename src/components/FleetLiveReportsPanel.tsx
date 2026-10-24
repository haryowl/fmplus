import { useEffect, useMemo, useState } from "react";
import { downloadCsv, toCsv } from "../lib/csvImport";
import { exportTablePdf } from "../lib/exportPdf";
import {
  DEFAULT_REPORT_SPEC,
  deleteFleetReport,
  fetchFleetReports,
  fetchReportColumns,
  runFleetReport,
  saveFleetReport,
  type FleetReport,
  type ReportColumn,
  type ReportRangeKind,
  type ReportRunResult,
  type ReportSpec,
} from "../lib/fleetReports";
import { downloadXlsx, excelFilename } from "../lib/xlsxDownload";
import type { TrackerDeviceGroup } from "../lib/trackerDevices";
import { FleetLiveSectionHead } from "./FleetLiveSectionHead";
import type { FleetTripDeviceOption } from "./FleetLiveTripsPanel";
import { IcoCalendar, IcoDevice, IcoMail, IcoRules } from "./fleetLiveIcons";

type Props = {
  devices: FleetTripDeviceOption[];
  groups?: TrackerDeviceGroup[];
  groupId: string;
  timezone: string;
  canManage?: boolean;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function emptySpec(timezone: string, groupId: string): ReportSpec {
  return {
    ...DEFAULT_REPORT_SPEC,
    timezone,
    scopeKind: groupId ? "group" : "all",
    scopeGroupId: groupId || null,
  };
}

export function FleetLiveReportsPanel({
  devices,
  groups = [],
  groupId,
  timezone,
  canManage = true,
}: Props) {
  const [reports, setReports] = useState<FleetReport[]>([]);
  const [columns, setColumns] = useState<ReportColumn[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("Device fixes");
  const [draftSpec, setDraftSpec] = useState<ReportSpec>(() => emptySpec(timezone, groupId));
  const [draftRecipients, setDraftRecipients] = useState("");
  const [draftCc, setDraftCc] = useState(false);
  const [draftSched, setDraftSched] = useState<"off" | "daily" | "weekly">("off");
  const [draftHour, setDraftHour] = useState(7);
  const [draftWeekday, setDraftWeekday] = useState(1);
  const [preview, setPreview] = useState<ReportRunResult | null>(null);

  const patchSpec = (partial: Partial<ReportSpec>) => setDraftSpec((s) => ({ ...s, ...partial }));

  const reload = () => {
    setLoading(true);
    return fetchFleetReports()
      .then(setReports)
      .catch((err: Error) => setError(err.message || "Failed to load reports"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setError("");
    void reload();
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void fetchReportColumns(draftSpec, ac.signal)
      .then(setColumns)
      .catch((err: Error) => {
        if (err.name !== "AbortError") setColumns([]);
      });
    return () => ac.abort();
  }, [
    draftSpec.grain,
    draftSpec.scopeKind,
    draftSpec.scopeGroupId,
    draftSpec.scopeDeviceIds.join(","),
  ]);

  const selectedCols = useMemo(() => new Set(draftSpec.columns), [draftSpec.columns]);

  const startEdit = (report: FleetReport) => {
    setEditId(report.id);
    setDraftName(report.name);
    setDraftSpec({ ...report.spec, timezone: report.spec.timezone || timezone });
    setDraftRecipients(report.recipients);
    setDraftCc(report.ccTenantNotify);
    setDraftSched(report.scheduleKind);
    setDraftHour(report.scheduleHour);
    setDraftWeekday(report.scheduleWeekday);
    setPreview(null);
  };

  const resetDraft = () => {
    setEditId(null);
    setDraftName("Device fixes");
    setDraftSpec(emptySpec(timezone, groupId));
    setDraftRecipients("");
    setDraftCc(false);
    setDraftSched("off");
    setDraftHour(7);
    setDraftWeekday(1);
    setPreview(null);
  };

  const onSave = async () => {
    if (!canManage) {
      setError("Missing desk privilege: viewFleetLive");
      return;
    }
    if (draftSpec.scopeKind === "group" && !draftSpec.scopeGroupId) {
      setError("Select a device group");
      return;
    }
    if (draftSpec.scopeKind === "devices" && draftSpec.scopeDeviceIds.length === 0) {
      setError("Select at least one device");
      return;
    }
    if (!draftSpec.columns.length) {
      setError("Pick at least one column");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await saveFleetReport(
        {
          name: draftName,
          enabled: true,
          spec: { ...draftSpec, timezone },
          recipients: draftRecipients,
          ccTenantNotify: draftCc,
          scheduleKind: draftSched,
          scheduleHour: draftHour,
          scheduleWeekday: draftWeekday,
        },
        editId || undefined,
      );
      resetDraft();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const onRun = async (limit = 5000) => {
    setRunning(true);
    setError("");
    try {
      const result = await runFleetReport({ ...draftSpec, timezone }, { limit });
      setPreview(result);
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : "Run failed");
    } finally {
      setRunning(false);
    }
  };

  const exportName = `${draftName.replace(/[^\w.-]+/g, "-") || "report"}-${preview?.range.from || ""}-${preview?.range.to || ""}`;

  return (
    <div className="fleet-sec fleet-reports">
      <FleetLiveSectionHead
        section="reports"
        title="Reports"
        badge="DEVICE"
        subtitle={loading ? "Loading…" : "Pick columns from Device Source, export, or email on a schedule"}
      />

      {error ? <div className="banner error fleet-cc-banner">{error}</div> : null}

      {canManage ? (
        <section className="fleet-dash-card fleet-rules-editor">
          <h3>
            <IcoRules /> {editId ? "Edit report" : "New report"}
          </h3>
          <div className="fleet-rules-grid">
            <label className="fleet-cc-field">
              <span>Name</span>
              <input value={draftName} onChange={(e) => setDraftName(e.target.value)} />
            </label>
            <label className="fleet-cc-field">
              <span>Grain</span>
              <select
                value={draftSpec.grain}
                onChange={(e) => {
                  const grain = e.target.value === "daily" ? "daily" : "fixes";
                  patchSpec({
                    grain,
                    columns:
                      grain === "daily"
                        ? ["device", "date", "fix_count", "max_speed"]
                        : DEFAULT_REPORT_SPEC.columns,
                  });
                  setPreview(null);
                }}
              >
                <option value="fixes">Fixes (raw rows)</option>
                <option value="daily">Daily totals</option>
              </select>
            </label>
            <label className="fleet-cc-field">
              <span>Range</span>
              <select
                value={draftSpec.rangeKind}
                onChange={(e) => patchSpec({ rangeKind: e.target.value as ReportRangeKind })}
              >
                <option value="today">Today</option>
                <option value="last7">Last 7 days</option>
                <option value="last30">Last 30 days</option>
                <option value="custom">Custom dates</option>
              </select>
            </label>
            {draftSpec.rangeKind === "custom" ? (
              <>
                <label className="fleet-cc-field fleet-cc-field-ico">
                  <span>
                    <IcoCalendar /> From
                  </span>
                  <input
                    type="date"
                    value={draftSpec.dateFrom}
                    onChange={(e) => patchSpec({ dateFrom: e.target.value })}
                  />
                </label>
                <label className="fleet-cc-field fleet-cc-field-ico">
                  <span>
                    <IcoCalendar /> To
                  </span>
                  <input
                    type="date"
                    value={draftSpec.dateTo}
                    onChange={(e) => patchSpec({ dateTo: e.target.value })}
                  />
                </label>
              </>
            ) : null}
            <label className="fleet-cc-field">
              <span>Scope</span>
              <select
                value={draftSpec.scopeKind}
                onChange={(e) =>
                  patchSpec({ scopeKind: e.target.value as ReportSpec["scopeKind"] })
                }
              >
                <option value="all">All devices</option>
                <option value="group">Device group</option>
                <option value="devices">Selected devices</option>
              </select>
            </label>
            {draftSpec.scopeKind === "group" ? (
              <label className="fleet-cc-field">
                <span>Group</span>
                <select
                  value={draftSpec.scopeGroupId || ""}
                  onChange={(e) => patchSpec({ scopeGroupId: e.target.value || null })}
                >
                  <option value="">Select group…</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {draftSpec.scopeKind === "devices" ? (
              <label className="fleet-cc-field fleet-rules-devices">
                <span>
                  <IcoDevice /> Devices ({draftSpec.scopeDeviceIds.length})
                </span>
                <select
                  multiple
                  value={draftSpec.scopeDeviceIds}
                  onChange={(e) =>
                    patchSpec({
                      scopeDeviceIds: Array.from(e.target.selectedOptions).map((o) => o.value),
                    })
                  }
                >
                  {devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          <div className="fleet-reports-cols">
            <h4>Columns</h4>
            <div className="fleet-reports-col-grid">
              {columns.map((c) => (
                <label key={c.id} className="fleet-rules-check">
                  <input
                    type="checkbox"
                    checked={selectedCols.has(c.id)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...draftSpec.columns, c.id]
                        : draftSpec.columns.filter((id) => id !== c.id);
                      patchSpec({ columns: next });
                    }}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </div>

          <div className="fleet-rules-grid">
            <label className="fleet-cc-field fleet-rules-devices">
              <span>
                <IcoMail /> Recipients
              </span>
              <input
                value={draftRecipients}
                onChange={(e) => setDraftRecipients(e.target.value)}
                placeholder="ops@example.com, night@example.com"
              />
            </label>
            <label className="fleet-rules-check">
              <input
                type="checkbox"
                checked={draftCc}
                onChange={(e) => setDraftCc(e.target.checked)}
              />
              Also CC tenant notify-emails
            </label>
            <label className="fleet-cc-field">
              <span>Schedule</span>
              <select
                value={draftSched}
                onChange={(e) =>
                  setDraftSched(e.target.value as "off" | "daily" | "weekly")
                }
              >
                <option value="off">Off</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </label>
            {draftSched !== "off" ? (
              <label className="fleet-cc-field">
                <span>Hour</span>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={draftHour}
                  onChange={(e) => setDraftHour(Math.max(0, Math.min(23, Number(e.target.value) || 0)))}
                />
              </label>
            ) : null}
            {draftSched === "weekly" ? (
              <label className="fleet-cc-field">
                <span>Weekday</span>
                <select
                  value={String(draftWeekday)}
                  onChange={(e) => setDraftWeekday(Number(e.target.value))}
                >
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          <div className="fleet-rules-actions">
            <button
              type="button"
              className="btn btn-primary btn-compact"
              disabled={running}
              onClick={() => void onRun(5000)}
            >
              {running ? "Running…" : "Preview"}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-compact"
              disabled={saving}
              onClick={() => void onSave()}
            >
              {saving ? "Saving…" : editId ? "Update report" : "Save report"}
            </button>
            {editId ? (
              <button type="button" className="fleet-cc-icon-btn" onClick={resetDraft}>
                Cancel edit
              </button>
            ) : null}
          </div>
        </section>
      ) : (
        <p className="muted fleet-dash-empty">Reports are view-only for this desk account.</p>
      )}

      {preview ? (
        <section className="fleet-dash-card">
          <header className="fleet-dash-card-head">
            <h3>
              Preview · {preview.rowCount} rows
              {preview.truncated ? " (truncated)" : ""}
            </h3>
            <div className="fleet-rules-actions">
              <button
                type="button"
                className="fleet-cc-icon-btn"
                onClick={() =>
                  downloadCsv(
                    `${exportName}.csv`,
                    toCsv(
                      preview.headers,
                      preview.rows.map((row) => row.map((c) => (c == null ? "" : c))),
                    ),
                  )
                }
              >
                CSV
              </button>
              <button
                type="button"
                className="fleet-cc-icon-btn"
                onClick={() =>
                  downloadXlsx(excelFilename(exportName), draftName, [preview.headers, ...preview.rows])
                }
              >
                Excel
              </button>
              <button
                type="button"
                className="fleet-cc-icon-btn"
                onClick={() =>
                  exportTablePdf({
                    title: draftName,
                    subtitle: `${preview.range.from} → ${preview.range.to} · ${preview.range.timezone}`,
                    filename: exportName,
                    headers: preview.headers,
                    rows: preview.rows,
                  })
                }
              >
                PDF
              </button>
              <button
                type="button"
                className="fleet-cc-icon-btn"
                disabled={running}
                onClick={() => void onRun(20000)}
              >
                Load more
              </button>
            </div>
          </header>
          <div className="fleet-reports-table-wrap">
            <table className="fleet-reports-table">
              <thead>
                <tr>
                  {preview.headers.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 200).map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j}>{cell == null ? "" : String(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.rows.length > 200 ? (
            <p className="muted">Showing first 200 of {preview.rowCount} rows. Export includes the full preview.</p>
          ) : null}
        </section>
      ) : null}

      <section className="fleet-dash-card">
        <header className="fleet-dash-card-head">
          <h3>Saved reports</h3>
          <em className="fleet-dash-pill">{reports.length}</em>
        </header>
        {reports.length === 0 ? (
          <p className="muted fleet-dash-empty">
            {canManage ? "No reports yet. Build one above." : "No reports configured."}
          </p>
        ) : (
          <ul className="fleet-rules-list">
            {reports.map((r) => (
              <li key={r.id} className={!r.enabled ? "is-off" : ""}>
                <div>
                  <strong>{r.name}</strong>
                  <span className="fleet-rules-flags muted">
                    <span className="fleet-dash-pill">{r.spec.grain}</span>
                    <span className="fleet-dash-pill">{r.spec.rangeKind}</span>
                    {r.scheduleKind !== "off" ? (
                      <span className="fleet-dash-pill">
                        {r.scheduleKind} {String(r.scheduleHour).padStart(2, "0")}:00
                      </span>
                    ) : null}
                  </span>
                  <div className="muted">
                    {r.spec.columns.join(", ")}
                    {r.lastRunAt ? ` · last send ${r.lastRunAt.slice(0, 16).replace("T", " ")}` : ""}
                    {r.lastError ? ` · ${r.lastError}` : ""}
                  </div>
                </div>
                {canManage ? (
                  <div className="fleet-rules-row-actions">
                    <button type="button" className="fleet-cc-icon-btn" onClick={() => startEdit(r)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="fleet-cc-icon-btn"
                      onClick={() =>
                        void saveFleetReport({ ...r, name: r.name, spec: r.spec, enabled: !r.enabled }, r.id)
                          .then(reload)
                          .catch((err: Error) => setError(err.message))
                      }
                    >
                      {r.enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      type="button"
                      className="fleet-cc-icon-btn"
                      onClick={() =>
                        void deleteFleetReport(r.id)
                          .then(() => {
                            if (editId === r.id) resetDraft();
                            return reload();
                          })
                          .catch((err: Error) => setError(err.message))
                      }
                    >
                      Delete
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
