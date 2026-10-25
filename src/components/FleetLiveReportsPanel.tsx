import { useEffect, useMemo, useRef, useState } from "react";
import { downloadCsv, toCsv } from "../lib/csvImport";
import { exportTablePdf } from "../lib/exportPdf";
import {
  categorizeReportColumn,
  DEFAULT_REPORT_SPEC,
  deleteFleetReport,
  ESSENTIAL_FIX_IDS,
  estimateFleetReport,
  fetchFleetReports,
  fetchReportColumns,
  formatReportBytes,
  parseReportEmails,
  REPORT_COL_CATEGORIES,
  reportColumnKey,
  runFleetReport,
  saveFleetReport,
  type FleetReport,
  type ReportColCategory,
  type ReportColumn,
  type ReportEstimate,
  type ReportFilter,
  type ReportRangeKind,
  type ReportRunResult,
  type ReportSpec,
} from "../lib/fleetReports";
import { RULE_CMPS, RULE_FIELDS } from "../lib/fleetAlertRules";
import { downloadXlsx, excelFilename } from "../lib/xlsxDownload";
import type { TrackerDeviceGroup } from "../lib/trackerDevices";
import { FleetLiveSectionHead } from "./FleetLiveSectionHead";
import type { FleetTripDeviceOption } from "./FleetLiveTripsPanel";
import { IcoCalendar, IcoClose, IcoDevice, IcoEye, IcoMail, IcoSearch } from "./fleetLiveIcons";

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

function rangeLabel(kind: ReportRangeKind, from: string, to: string): string {
  if (kind === "today") return "Today";
  if (kind === "last7") return "Last 7 days";
  if (kind === "last30") return "Last 30 days";
  if (from && to) return `${from} → ${to}`;
  return "Custom";
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function FleetLiveReportsPanel({
  devices,
  groups = [],
  groupId,
  timezone,
  canManage = true,
}: Props) {
  const searchRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const saveRef = useRef<() => void>(() => {});
  const runRef = useRef<() => void>(() => {});
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
  const [emailDraft, setEmailDraft] = useState("");
  const [preview, setPreview] = useState<ReportRunResult | null>(null);
  const [category, setCategory] = useState<ReportColCategory | "all">("location");
  const [colQuery, setColQuery] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<ReportEstimate | null>(null);
  const [estimateReady, setEstimateReady] = useState(false);

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

  useEffect(() => {
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      void estimateFleetReport({ ...draftSpec, timezone }, ac.signal)
        .then((e) => {
          setEstimate(e);
          setEstimateReady(true);
        })
        .catch((err: Error) => {
          if (err.name !== "AbortError") {
            setEstimate(null);
            setEstimateReady(true);
          }
        });
    }, 280);
    return () => {
      window.clearTimeout(t);
      ac.abort();
    };
  }, [
    draftSpec.grain,
    draftSpec.rangeKind,
    draftSpec.dateFrom,
    draftSpec.dateTo,
    draftSpec.scopeKind,
    draftSpec.scopeGroupId,
    draftSpec.scopeDeviceIds.join(","),
    draftSpec.columns.join(","),
    timezone,
  ]);

  const categorized = useMemo(
    () =>
      columns.map((c) => ({
        ...c,
        category: categorizeReportColumn(c.id, draftSpec.grain),
        key: reportColumnKey(c.id),
      })),
    [columns, draftSpec.grain],
  );

  const counts = useMemo(() => {
    const next: Record<string, number> = { all: categorized.length };
    for (const cat of REPORT_COL_CATEGORIES) {
      if (cat.id === "all") continue;
      next[cat.id] = categorized.filter((c) => c.category === cat.id).length;
    }
    return next;
  }, [categorized]);

  const selectedCols = useMemo(() => new Set(draftSpec.columns), [draftSpec.columns]);
  const emails = useMemo(() => parseReportEmails(draftRecipients), [draftRecipients]);

  const visibleCols = useMemo(() => {
    const q = colQuery.trim().toLowerCase();
    return categorized.filter((c) => {
      if (category !== "all" && c.category !== category) return false;
      if (!q) return true;
      return c.label.toLowerCase().includes(q) || c.key.toLowerCase().includes(q) || c.id.toLowerCase().includes(q);
    });
  }, [categorized, category, colQuery]);

  const selectedMeta = useMemo(
    () =>
      draftSpec.columns
        .map((id) => categorized.find((c) => c.id === id) || { id, label: reportColumnKey(id), key: reportColumnKey(id) })
        .filter(Boolean),
    [draftSpec.columns, categorized],
  );

  const setColumnsOrder = (ids: string[]) => patchSpec({ columns: ids.slice(0, 24) });

  const toggleCol = (id: string, on?: boolean) => {
    const nextOn = on ?? !selectedCols.has(id);
    if (nextOn) {
      if (selectedCols.has(id) || draftSpec.columns.length >= 24) return;
      setColumnsOrder([...draftSpec.columns, id]);
    } else {
      setColumnsOrder(draftSpec.columns.filter((c) => c !== id));
    }
  };

  const selectIds = (ids: string[]) => {
    const keep = draftSpec.columns.filter((id) => !ids.includes(id));
    setColumnsOrder([...keep, ...ids.filter((id) => !keep.includes(id))]);
  };

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
    setCategory("location");
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
    setEmailDraft("");
    setPreview(null);
    setCategory("location");
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
          recipients: emails.join(", "),
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

  const addEmail = (raw: string) => {
    const found = parseReportEmails(raw);
    if (!found.length) return false;
    const next = [...emails];
    for (const e of found) if (!next.includes(e)) next.push(e);
    setDraftRecipients(next.join(", "));
    setEmailDraft("");
    return true;
  };

  saveRef.current = () => {
    void onSave();
  };
  runRef.current = () => {
    void onRun(5000);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setPreview(null);
        return;
      }
      if (e.key === "/" && !isTypingTarget(e.target)) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if ((e.key === "s" || e.key === "S") && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        if (canManage) saveRef.current();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        if (canManage) saveRef.current();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        runRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canManage]);

  const exportName = `${draftName.replace(/[^\w.-]+/g, "-") || "report"}-${preview?.range.from || ""}-${preview?.range.to || ""}`;
  const locationIds = categorized.filter((c) => c.category === "location").map((c) => c.id);
  const essentialIds =
    draftSpec.grain === "daily"
      ? categorized.filter((c) => c.category === "essential").map((c) => c.id)
      : ESSENTIAL_FIX_IDS.filter((id) => categorized.some((c) => c.id === id));

  return (
    <div className="fleet-sec fleet-reports">
      <FleetLiveSectionHead
        section="reports"
        title="Reports"
        badge="DEVICE"
        subtitle={loading ? "Loading…" : "Device Source columns, export, and scheduled email"}
      />

      {error ? <div className="banner error fleet-cc-banner">{error}</div> : null}

      {canManage ? (
        <section className="fleet-rpt-builder" aria-label="Report builder">
          <header className="fleet-rpt-head">
            <div className="fleet-rpt-head-title">
              <h3>{editId ? "Edit report" : "New report"}</h3>
              <em className="fleet-rpt-draft">
                {editId ? "Saved" : "Draft"} · {draftSpec.columns.length} cols
              </em>
            </div>
            <p className="muted fleet-rpt-keys">S to save · Enter to preview</p>
          </header>

          <div className="fleet-rpt-fields">
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
                        : [...ESSENTIAL_FIX_IDS.filter((id) => id !== "imei")],
                  });
                  setPreview(null);
                  setCategory(grain === "daily" ? "all" : "location");
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
            <label className="fleet-cc-field">
              <span>Group</span>
              <select
                value={draftSpec.scopeGroupId || ""}
                disabled={draftSpec.scopeKind !== "group"}
                onChange={(e) => patchSpec({ scopeGroupId: e.target.value || null })}
              >
                <option value="">
                  {draftSpec.scopeKind === "group" ? "Select group…" : "—"}
                </option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
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
          </div>

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

          {draftSpec.grain === "fixes" ? (
            <div className="fleet-rules-conditions">
              <div className="fleet-rules-op-row">
                <h4>Filters (optional)</h4>
                <button
                  type="button"
                  className="fleet-cc-icon-btn"
                  onClick={() =>
                    patchSpec({
                      filters: [
                        ...draftSpec.filters,
                        { field: "speed", cmp: ">", value: 80 } satisfies ReportFilter,
                      ],
                    })
                  }
                >
                  Add filter
                </button>
              </div>
              {draftSpec.filters.map((f, idx) => (
                <div key={idx} className="fleet-rules-cond-row">
                  <select
                    value={f.field}
                    onChange={(e) => {
                      const filters = [...draftSpec.filters];
                      filters[idx] = { ...f, field: e.target.value };
                      patchSpec({ filters });
                    }}
                  >
                    {RULE_FIELDS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                    <option value="mapped.alarm">mapped.alarm</option>
                  </select>
                  <select
                    value={f.cmp}
                    onChange={(e) => {
                      const filters = [...draftSpec.filters];
                      filters[idx] = { ...f, cmp: e.target.value };
                      patchSpec({ filters });
                    }}
                  >
                    {RULE_CMPS.map((cmp) => (
                      <option key={cmp} value={cmp}>
                        {cmp}
                      </option>
                    ))}
                  </select>
                  <input
                    value={String(f.value ?? "")}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const num = Number(raw);
                      const filters = [...draftSpec.filters];
                      filters[idx] = {
                        ...f,
                        value: raw !== "" && !Number.isNaN(num) ? num : raw,
                      };
                      patchSpec({ filters });
                    }}
                  />
                  <button
                    type="button"
                    className="fleet-cc-icon-btn"
                    onClick={() =>
                      patchSpec({ filters: draftSpec.filters.filter((_, i) => i !== idx) })
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              <p className="muted">Device Source only. Filters apply to fix rows before export.</p>
            </div>
          ) : (
            <p className="muted">Device Source daily totals — no Armada source.</p>
          )}

          <div className="fleet-rpt-cols">
            <header className="fleet-rpt-cols-head">
              <div className="fleet-rpt-cols-title">
                <strong>Columns</strong>
                <em className="fleet-rpt-draft">
                  {draftSpec.columns.length} of {categorized.length} selected
                </em>
                <span className="muted">Drag chips to reorder</span>
              </div>
              <div className="fleet-rpt-col-actions">
                <button type="button" className="fleet-rpt-pill" onClick={() => selectIds([...essentialIds])}>
                  Select essential
                </button>
                <button type="button" className="fleet-rpt-pill" onClick={() => selectIds(locationIds)}>
                  Select all location
                </button>
                <button type="button" className="fleet-rpt-pill" onClick={() => setColumnsOrder([])}>
                  Clear
                </button>
              </div>
            </header>

            <div className="fleet-rpt-cols-body">
              <aside className="fleet-rpt-cats" aria-label="Column categories">
                <h4>Categories</h4>
                {REPORT_COL_CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    className={category === cat.id ? "is-active" : ""}
                    onClick={() => setCategory(cat.id)}
                  >
                    <span>{cat.label}</span>
                    <em>{counts[cat.id] || 0}</em>
                  </button>
                ))}
                <p className="muted fleet-rpt-tip">
                  Double-click a row to quick-add. Search supports raw keys like din13. Press / to
                  focus search.
                </p>
              </aside>

              <div className="fleet-rpt-picker">
                <label className="fleet-rpt-search">
                  <IcoSearch />
                  <input
                    ref={searchRef}
                    value={colQuery}
                    onChange={(e) => setColQuery(e.target.value)}
                    placeholder="Search columns — e.g. din, voltage, lat…"
                  />
                  <kbd>/</kbd>
                </label>

                {selectedMeta.length ? (
                  <ul className="fleet-rpt-chips">
                    {selectedMeta.map((c) => (
                      <li
                        key={c.id}
                        draggable
                        onDragStart={() => setDragId(c.id)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          if (!dragId || dragId === c.id) return;
                          const ids = draftSpec.columns.filter((id) => id !== dragId);
                          const at = ids.indexOf(c.id);
                          ids.splice(at, 0, dragId);
                          setColumnsOrder(ids);
                        }}
                        onDragEnd={() => setDragId(null)}
                        className={dragId === c.id ? "is-dragging" : ""}
                      >
                        <span className="fleet-rpt-grip" aria-hidden />
                        <strong>{c.label}</strong>
                        <code>[{c.key}]</code>
                        <button
                          type="button"
                          className="fleet-rpt-chip-x"
                          aria-label={`Remove ${c.label}`}
                          onClick={() => toggleCol(c.id, false)}
                        >
                          <IcoClose />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted fleet-rpt-empty-sel">No columns selected yet.</p>
                )}

                <div className="fleet-rpt-cat-title">
                  <strong>
                    {REPORT_COL_CATEGORIES.find((c) => c.id === category)?.label || "Columns"}
                  </strong>
                  <span className="muted">{visibleCols.length} columns</span>
                </div>
                <ul className="fleet-rpt-checks">
                  {visibleCols.map((c) => (
                    <li key={c.id}>
                      <label
                        onDoubleClick={(e) => {
                          e.preventDefault();
                          toggleCol(c.id, true);
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedCols.has(c.id)}
                          onChange={(e) => toggleCol(c.id, e.target.checked)}
                        />
                        <span>{c.label}</span>
                        <code>[{c.key}]</code>
                      </label>
                    </li>
                  ))}
                </ul>
                {visibleCols.length === 0 ? (
                  <p className="muted">No columns match this filter.</p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="fleet-rpt-mail">
            <label className="fleet-cc-field fleet-rpt-recip">
              <span>
                <IcoMail /> Recipients
              </span>
              <div
                className="fleet-rpt-tokens"
                onClick={() => emailRef.current?.focus()}
              >
                {emails.map((e) => (
                  <em key={e} className="fleet-rpt-token">
                    {e}
                    <button
                      type="button"
                      aria-label={`Remove ${e}`}
                      onClick={() =>
                        setDraftRecipients(emails.filter((x) => x !== e).join(", "))
                      }
                    >
                      <IcoClose />
                    </button>
                  </em>
                ))}
                <input
                  ref={emailRef}
                  value={emailDraft}
                  placeholder={emails.length ? "" : "ops@example.com"}
                  onChange={(e) => setEmailDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
                      if (emailDraft.trim()) {
                        e.preventDefault();
                        if (!addEmail(emailDraft)) setError("Enter a valid email address");
                      }
                    } else if (e.key === "Backspace" && !emailDraft && emails.length) {
                      setDraftRecipients(emails.slice(0, -1).join(", "));
                    }
                  }}
                  onBlur={() => {
                    if (emailDraft.trim()) addEmail(emailDraft);
                  }}
                />
              </div>
            </label>
            <label className="fleet-cc-field">
              <span>Schedule</span>
              <select
                value={draftSched}
                onChange={(e) => setDraftSched(e.target.value as "off" | "daily" | "weekly")}
              >
                <option value="off">Off</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </label>
            <label className="fleet-cc-field">
              <span>Format</span>
              <select
                value={draftSpec.format}
                onChange={(e) =>
                  patchSpec({ format: e.target.value === "xlsx" ? "xlsx" : "csv" })
                }
              >
                <option value="csv">CSV</option>
                <option value="xlsx">Excel</option>
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
                  onChange={(e) =>
                    setDraftHour(Math.max(0, Math.min(23, Number(e.target.value) || 0)))
                  }
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

          <div className="fleet-rpt-meta">
            <label className="fleet-rules-check">
              <input
                type="checkbox"
                checked={draftCc}
                onChange={(e) => setDraftCc(e.target.checked)}
              />
              Also CC tenant notify-emails
              {emails.length ? (
                <span className="muted"> · {emails.length} address{emails.length === 1 ? "" : "es"}</span>
              ) : null}
            </label>
            <p className="fleet-rpt-estimate">
              {rangeLabel(draftSpec.rangeKind, draftSpec.dateFrom, draftSpec.dateTo)}
              {estimate
                ? ` · ~${estimate.rows.toLocaleString("en-US")} rows estimated · ${formatReportBytes(estimate.bytes)}`
                : estimateReady
                  ? " · estimate unavailable"
                  : " · estimating…"}
            </p>
          </div>

          <footer className="fleet-rpt-foot">
            <p className="muted">
              {preview
                ? "Preview open · Press Esc to close"
                : "Ready to preview · Press Esc to close preview"}
            </p>
            <div className="fleet-rpt-foot-actions">
              {editId ? (
                <button type="button" className="fleet-cc-icon-btn" onClick={resetDraft}>
                  Cancel
                </button>
              ) : null}
              <button
                type="button"
                className="fleet-rpt-save"
                disabled={saving}
                onClick={() => void onSave()}
              >
                {saving ? "Saving…" : "Save report"}
              </button>
              <button
                type="button"
                className="fleet-rpt-preview-btn"
                disabled={running}
                onClick={() => void onRun(5000)}
              >
                <IcoEye />
                {running ? "Running…" : "Preview"}
              </button>
            </div>
          </footer>
        </section>
      ) : (
        <p className="muted fleet-dash-empty">Reports are view-only for this desk account.</p>
      )}

      {preview ? (
        <section className="fleet-dash-card fleet-rpt-preview" aria-label="Report preview">
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
              <button type="button" className="fleet-cc-icon-btn" onClick={() => setPreview(null)}>
                <IcoClose /> Close
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
