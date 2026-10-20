import { useEffect, useMemo, useState } from "react";
import { addDays, todayKeyInOffset, zonedEndMs, zonedStartMs } from "../lib/time";
import {
  alarmLabel,
  fetchFleetAlerts,
  type FleetMediaEvent,
} from "../lib/fleetMedia";
import {
  ackRuleEvent,
  deleteAlertRule,
  fetchAlertRules,
  fetchRuleEvents,
  RULE_CMPS,
  RULE_FIELDS,
  saveAlertRule,
  type AlertCondition,
  type FleetAlertRule,
  type FleetRuleEvent,
} from "../lib/fleetAlertRules";
import type { FleetTripDeviceOption } from "./FleetLiveTripsPanel";
import type { TrackerDeviceGroup } from "../lib/trackerDevices";
import { FleetLiveSectionHead } from "./FleetLiveSectionHead";
import {
  IcoAlerts,
  IcoCalendar,
  IcoDevice,
  IcoMail,
  IcoRules,
  IcoWhatsApp,
} from "./fleetLiveIcons";

type Props = {
  devices: FleetTripDeviceOption[];
  groups?: TrackerDeviceGroup[];
  groupId: string;
  timezone: string;
  initialDeviceId?: string;
  canViewRules?: boolean;
  canManageRules?: boolean;
  canAckAlerts?: boolean;
};

function formatWhen(iso: string, tz: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone:
        tz === "+07:00"
          ? "Asia/Jakarta"
          : tz === "+08:00"
            ? "Asia/Makassar"
            : tz === "+09:00"
              ? "Asia/Jayapura"
              : "UTC",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleTimeString();
  }
}

const emptyCondition = (): AlertCondition => ({
  field: "speed",
  cmp: ">",
  value: 80,
});

export function FleetLiveAlertsPanel({
  devices,
  groups = [],
  groupId,
  timezone,
  initialDeviceId,
  canViewRules = true,
  canManageRules = true,
  canAckAlerts = true,
}: Props) {
  const [sub, setSub] = useState<"events" | "rules">("events");
  const [deviceId, setDeviceId] = useState(() => initialDeviceId || "");
  const [dateFrom, setDateFrom] = useState(() => addDays(todayKeyInOffset(timezone), -1));
  const [dateTo, setDateTo] = useState(() => todayKeyInOffset(timezone));
  const [minLevel, setMinLevel] = useState(0);
  const [safety, setSafety] = useState<FleetMediaEvent[]>([]);
  const [ruleEvents, setRuleEvents] = useState<FleetRuleEvent[]>([]);
  const [rules, setRules] = useState<FleetAlertRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [draftName, setDraftName] = useState("Speeding");
  const [draftSeverity, setDraftSeverity] = useState<"info" | "warning" | "critical">("warning");
  const [draftScope, setDraftScope] = useState<"all" | "group" | "devices">("all");
  const [draftGroupId, setDraftGroupId] = useState(groupId || "");
  const [draftDeviceIds, setDraftDeviceIds] = useState<string[]>([]);
  const [draftDurationMin, setDraftDurationMin] = useState(0);
  const [draftCooldownMin, setDraftCooldownMin] = useState(5);
  const [draftEmail, setDraftEmail] = useState(false);
  const [draftWa, setDraftWa] = useState(false);
  const [draftOp, setDraftOp] = useState<"and" | "or">("and");
  const [draftConditions, setDraftConditions] = useState<AlertCondition[]>([emptyCondition()]);
  const [editId, setEditId] = useState<string | null>(null);

  const reloadRules = () =>
    fetchAlertRules()
      .then(setRules)
      .catch((err: Error) => setError(err.message || "Failed to load rules"));

  useEffect(() => {
    if (sub !== "events") return;
    const ac = new AbortController();
    setLoading(true);
    setError("");
    const from = new Date(zonedStartMs(dateFrom, timezone)).toISOString();
    const to = new Date(zonedEndMs(dateTo, timezone)).toISOString();
    Promise.all([
      fetchFleetAlerts(
        {
          deviceId: deviceId || undefined,
          groupId: groupId || undefined,
          from,
          to,
          limit: 100,
        },
        ac.signal,
      ),
      fetchRuleEvents({ limit: 80 }, ac.signal).catch(() => [] as FleetRuleEvent[]),
    ])
      .then(([s, r]) => {
        setSafety(s);
        setRuleEvents(r);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") {
          setSafety([]);
          setRuleEvents([]);
          setError(err.message || "Failed to load alerts");
        }
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [sub, deviceId, groupId, dateFrom, dateTo, timezone]);

  useEffect(() => {
    if (!canViewRules && sub === "rules") setSub("events");
  }, [canViewRules, sub]);

  useEffect(() => {
    if (sub !== "rules" || !canViewRules) return;
    setError("");
    void reloadRules();
  }, [sub, canViewRules]);

  const filteredSafety = useMemo(
    () => safety.filter((e) => (e.alarmLevel || 0) >= minLevel),
    [safety, minLevel],
  );

  const startEdit = (rule: FleetAlertRule) => {
    setEditId(rule.id);
    setDraftName(rule.name);
    setDraftSeverity(rule.severity);
    setDraftScope(
      rule.scopeKind === "group" || rule.scopeKind === "devices" ? rule.scopeKind : "all",
    );
    setDraftGroupId(rule.scopeGroupId || groupId || "");
    setDraftDeviceIds(Array.isArray(rule.scopeDeviceIds) ? [...rule.scopeDeviceIds] : []);
    setDraftDurationMin(Math.round((rule.formula.durationSec || 0) / 60));
    setDraftCooldownMin(Math.max(1, Math.round((rule.cooldownSec || 300) / 60)));
    setDraftEmail(rule.notifyEmail);
    setDraftWa(rule.notifyWhatsapp);
    setDraftOp(rule.formula.op === "or" ? "or" : "and");
    setDraftConditions(
      rule.formula.conditions.length ? rule.formula.conditions.map((c) => ({ ...c })) : [emptyCondition()],
    );
  };

  const resetDraft = () => {
    setEditId(null);
    setDraftName("Speeding");
    setDraftSeverity("warning");
    setDraftScope("all");
    setDraftGroupId(groupId || "");
    setDraftDeviceIds([]);
    setDraftDurationMin(0);
    setDraftCooldownMin(5);
    setDraftEmail(false);
    setDraftWa(false);
    setDraftOp("and");
    setDraftConditions([emptyCondition()]);
  };

  const onSaveRule = async () => {
    if (!canManageRules) {
      setError("Missing desk privilege: manageFleetRules");
      return;
    }
    if (draftScope === "devices" && draftDeviceIds.length === 0) {
      setError("Select at least one device for device scope");
      return;
    }
    if (draftScope === "group" && !draftGroupId) {
      setError("Select a device group");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await saveAlertRule(
        {
          name: draftName,
          enabled: true,
          severity: draftSeverity,
          scopeKind: draftScope,
          scopeGroupId: draftScope === "group" ? draftGroupId || null : null,
          scopeDeviceIds: draftScope === "devices" ? draftDeviceIds : [],
          formula: {
            op: draftOp,
            conditions: draftConditions.map((c) => {
              let value: string | number | boolean = c.value;
              if (c.field === "ignition") {
                value = String(c.value) === "true" || c.value === true;
              } else if (typeof c.value === "string" && c.value.trim() !== "" && !Number.isNaN(Number(c.value))) {
                value = Number(c.value);
              }
              return { field: c.field, cmp: c.cmp, value };
            }),
            durationSec: Math.max(0, draftDurationMin) * 60,
          },
          notifyEmail: draftEmail,
          notifyWhatsapp: draftWa,
          cooldownSec: Math.max(60, Math.min(86400, draftCooldownMin * 60)),
        },
        editId || undefined,
      );
      resetDraft();
      await reloadRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fleet-sec fleet-alerts">
      <FleetLiveSectionHead
        section="alerts"
        title="Alerts"
        badge={sub === "rules" ? "RULES" : "FEED"}
        subtitle={loading ? "Loading…" : "Safety feed & telematics rules"}
        actions={
          <div className="fleet-ico-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              className={sub === "events" ? "is-active" : ""}
              aria-selected={sub === "events"}
              title="Events"
              onClick={() => setSub("events")}
            >
              <IcoAlerts />
              <span>Events</span>
            </button>
            {canViewRules ? (
              <button
                type="button"
                role="tab"
                className={sub === "rules" ? "is-active" : ""}
                aria-selected={sub === "rules"}
                title="Rules"
                onClick={() => setSub("rules")}
              >
                <IcoRules />
                <span>Rules</span>
              </button>
            ) : null}
          </div>
        }
      />

      {error ? <div className="banner error fleet-cc-banner">{error}</div> : null}

      {sub === "rules" && canViewRules ? (
        <div className="fleet-rules">
          {canManageRules ? (
          <section className="fleet-dash-card fleet-rules-editor">
            <h3>
              <IcoRules /> {editId ? "Edit rule" : "New rule"}
            </h3>
            <div className="fleet-rules-grid">
              <label className="fleet-cc-field">
                <span>Name</span>
                <input value={draftName} onChange={(e) => setDraftName(e.target.value)} />
              </label>
              <label className="fleet-cc-field">
                <span>Severity</span>
                <select
                  value={draftSeverity}
                  onChange={(e) =>
                    setDraftSeverity(e.target.value as "info" | "warning" | "critical")
                  }
                >
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="critical">Critical</option>
                </select>
              </label>
              <label className="fleet-cc-field">
                <span>Scope</span>
                <select
                  value={draftScope}
                  onChange={(e) =>
                    setDraftScope(e.target.value as "all" | "group" | "devices")
                  }
                >
                  <option value="all">All devices</option>
                  <option value="group">Device group</option>
                  <option value="devices">Selected devices</option>
                </select>
              </label>
              {draftScope === "group" ? (
                <label className="fleet-cc-field">
                  <span>Group</span>
                  <select value={draftGroupId} onChange={(e) => setDraftGroupId(e.target.value)}>
                    <option value="">Select group…</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {draftScope === "devices" ? (
                <label className="fleet-cc-field fleet-rules-devices">
                  <span>Devices ({draftDeviceIds.length})</span>
                  <select
                    multiple
                    value={draftDeviceIds}
                    onChange={(e) =>
                      setDraftDeviceIds(
                        Array.from(e.target.selectedOptions).map((o) => o.value),
                      )
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
              <label className="fleet-cc-field">
                <span>Hold (minutes)</span>
                <input
                  type="number"
                  min={0}
                  value={draftDurationMin}
                  onChange={(e) => setDraftDurationMin(Number(e.target.value) || 0)}
                />
              </label>
              <label className="fleet-cc-field">
                <span>Cooldown (minutes)</span>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={draftCooldownMin}
                  onChange={(e) => setDraftCooldownMin(Math.max(1, Number(e.target.value) || 1))}
                />
              </label>
            </div>

            <div className="fleet-rules-conditions">
              <div className="fleet-rules-op-row">
                <h4>{draftOp === "or" ? "When any of these are true" : "When all of these are true"}</h4>
                <label className="fleet-cc-field fleet-rules-op">
                  <span>Match</span>
                  <select
                    value={draftOp}
                    onChange={(e) => setDraftOp(e.target.value === "or" ? "or" : "and")}
                  >
                    <option value="and">All (AND)</option>
                    <option value="or">Any (OR)</option>
                  </select>
                </label>
              </div>
              {draftConditions.map((c, idx) => (
                <div key={idx} className="fleet-rules-cond-row">
                  <select
                    value={c.field}
                    onChange={(e) => {
                      const next = [...draftConditions];
                      next[idx] = { ...c, field: e.target.value };
                      setDraftConditions(next);
                    }}
                  >
                    {RULE_FIELDS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={c.cmp}
                    onChange={(e) => {
                      const next = [...draftConditions];
                      next[idx] = { ...c, cmp: e.target.value };
                      setDraftConditions(next);
                    }}
                  >
                    {RULE_CMPS.map((cmp) => (
                      <option key={cmp} value={cmp}>
                        {cmp}
                      </option>
                    ))}
                  </select>
                  {c.field === "ignition" ? (
                    <select
                      value={String(c.value)}
                      onChange={(e) => {
                        const next = [...draftConditions];
                        next[idx] = { ...c, value: e.target.value };
                        setDraftConditions(next);
                      }}
                    >
                      <option value="true">On</option>
                      <option value="false">Off</option>
                    </select>
                  ) : (
                    <input
                      value={String(c.value)}
                      onChange={(e) => {
                        const next = [...draftConditions];
                        next[idx] = { ...c, value: e.target.value };
                        setDraftConditions(next);
                      }}
                    />
                  )}
                  <button
                    type="button"
                    className="fleet-cc-icon-btn"
                    disabled={draftConditions.length <= 1}
                    onClick={() =>
                      setDraftConditions(draftConditions.filter((_, i) => i !== idx))
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="fleet-cc-icon-btn"
                onClick={() => setDraftConditions([...draftConditions, emptyCondition()])}
              >
                Add condition
              </button>
            </div>

            <div className="fleet-rules-actions">
              <label className="fleet-rules-check" title="Email notify">
                <input
                  type="checkbox"
                  checked={draftEmail}
                  onChange={(e) => setDraftEmail(e.target.checked)}
                />
                <IcoMail /> Email
              </label>
              <label className="fleet-rules-check" title="WhatsApp notify">
                <input
                  type="checkbox"
                  checked={draftWa}
                  onChange={(e) => setDraftWa(e.target.checked)}
                />
                <IcoWhatsApp /> WhatsApp
              </label>
              <button
                type="button"
                className="btn btn-primary btn-compact"
                disabled={saving}
                onClick={() => void onSaveRule()}
              >
                {saving ? "Saving…" : editId ? "Update rule" : "Create rule"}
              </button>
              {editId ? (
                <button type="button" className="fleet-cc-icon-btn" onClick={resetDraft}>
                  Cancel edit
                </button>
              ) : null}
            </div>
          </section>
          ) : (
            <p className="muted fleet-dash-empty">
              Rules are view-only. Your desk account needs “Fleet Live · manage rules” to edit.
            </p>
          )}

          <section className="fleet-dash-card">
            <header className="fleet-dash-card-head">
              <h3>
                <IcoRules /> Rules
              </h3>
              <em className="fleet-dash-pill">{rules.length}</em>
            </header>
            {rules.length === 0 ? (
              <p className="muted fleet-dash-empty">
                {canManageRules ? "No rules yet. Create one above." : "No rules configured."}
              </p>
            ) : (
              <ul className="fleet-rules-list">
                {rules.map((r) => (
                  <li key={r.id} className={!r.enabled ? "is-off" : ""}>
                    <div>
                      <strong>{r.name}</strong>
                      <span className="fleet-rules-flags muted">
                        <span className={`fleet-sev is-${r.severity}`}>{r.severity}</span>
                        <span className="fleet-dash-pill">
                          {r.scopeKind === "devices"
                            ? `${r.scopeDeviceIds?.length || 0} devices`
                            : r.scopeKind}
                        </span>
                        {!r.enabled ? <span className="fleet-sev is-off">off</span> : null}
                        {r.notifyEmail ? (
                          <span title="Email">
                            <IcoMail />
                          </span>
                        ) : null}
                        {r.notifyWhatsapp ? (
                          <span title="WhatsApp">
                            <IcoWhatsApp />
                          </span>
                        ) : null}
                      </span>
                      <div className="muted">
                        {r.formula.conditions
                          .map((c) => `${c.field} ${c.cmp} ${JSON.stringify(c.value)}`)
                          .join(r.formula.op === "or" ? " OR " : " AND ")}
                        {r.formula.durationSec
                          ? ` · hold ${Math.round(r.formula.durationSec / 60)}m`
                          : ""}
                        {r.cooldownSec ? ` · cd ${Math.round(r.cooldownSec / 60)}m` : ""}
                      </div>
                    </div>
                    {canManageRules ? (
                      <div className="fleet-rules-row-actions">
                        <button type="button" className="fleet-cc-icon-btn" onClick={() => startEdit(r)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="fleet-cc-icon-btn"
                          onClick={() =>
                            void saveAlertRule(
                              { ...r, name: r.name, formula: r.formula, enabled: !r.enabled },
                              r.id,
                            )
                              .then(reloadRules)
                              .catch((err: Error) => setError(err.message))
                          }
                        >
                          {r.enabled ? "Disable" : "Enable"}
                        </button>
                        <button
                          type="button"
                          className="fleet-cc-icon-btn"
                          onClick={() =>
                            void deleteAlertRule(r.id)
                              .then(reloadRules)
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
      ) : (
        <>
          <div className="fleet-alerts-toolbar">
            <div className="fleet-trips-filters">
              <label className="fleet-cc-field fleet-cc-field-ico">
                <span>
                  <IcoDevice /> Device
                </span>
                <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                  <option value="">All devices</option>
                  {devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="fleet-cc-field fleet-cc-field-ico">
                <span>
                  <IcoCalendar /> From
                </span>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </label>
              <label className="fleet-cc-field fleet-cc-field-ico">
                <span>
                  <IcoCalendar /> To
                </span>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </label>
              <label className="fleet-cc-field fleet-cc-field-ico">
                <span>
                  <IcoAlerts /> Level
                </span>
                <select
                  value={String(minLevel)}
                  onChange={(e) => setMinLevel(Number(e.target.value) || 0)}
                >
                  <option value="0">All</option>
                  <option value="1">≥ 1</option>
                  <option value="2">≥ 2</option>
                  <option value="3">≥ 3</option>
                </select>
              </label>
            </div>
            <div className="fleet-sec-summary">
              <span title="Safety events">
                <IcoAlerts /> <strong>{filteredSafety.length}</strong>
              </span>
              <span title="Rule fires">
                <IcoRules /> <strong>{ruleEvents.length}</strong>
              </span>
              <span title="Open rules">
                <em className="fleet-dash-pill is-ok">
                  {ruleEvents.filter((e) => e.status === "open").length} open
                </em>
              </span>
            </div>
          </div>

          <div className="fleet-alerts-body">
            <section className="fleet-dash-card">
              <header className="fleet-dash-card-head">
                <h3>
                  <IcoAlerts /> Safety
                </h3>
                <em className="fleet-dash-pill">{filteredSafety.length}</em>
              </header>
              {filteredSafety.length === 0 ? (
                <p className="muted fleet-dash-empty">
                  {loading ? "Loading…" : "No safety events in this range."}
                </p>
              ) : (
                <ul className="fleet-alerts-list">
                  {filteredSafety.map((e) => (
                    <li key={e.id} className="fleet-alerts-card">
                      <span
                        className={`fleet-cc-alert-lvl is-l${Math.min(3, Math.max(0, e.alarmLevel || 0))}`}
                      />
                      <div>
                        <strong>{alarmLabel(e.alarmType)}</strong>
                        <span className="muted">
                          {" "}
                          · {e.deviceLabel || e.imei || e.deviceId.slice(0, 8)}
                        </span>
                        <div className="muted">{formatWhen(e.recordedAt, timezone)}</div>
                      </div>
                      <em className="fleet-cc-active-pill">L{e.alarmLevel || 0}</em>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="fleet-dash-card">
              <header className="fleet-dash-card-head">
                <h3>
                  <IcoRules /> Rule fires
                </h3>
                <em className="fleet-dash-pill">{ruleEvents.length}</em>
              </header>
              {ruleEvents.length === 0 ? (
                <p className="muted fleet-dash-empty">No rule events yet.</p>
              ) : (
                <ul className="fleet-alerts-list">
                  {ruleEvents.map((e) => (
                    <li key={e.id} className="fleet-alerts-card">
                      <span
                        className={`fleet-cc-alert-lvl is-l${
                          e.severity === "critical" ? 3 : e.severity === "warning" ? 2 : 1
                        }`}
                      />
                      <div>
                        <strong>{e.title}</strong>
                        <span className="muted">
                          {" "}
                          · {e.deviceLabel || "device"} · {e.status}
                        </span>
                        <div className="muted">{e.detail}</div>
                        <div className="muted">{formatWhen(e.firedAt, timezone)}</div>
                      </div>
                      {e.status === "open" && canAckAlerts ? (
                        <button
                          type="button"
                          className="btn btn-primary btn-compact"
                          onClick={() =>
                            void ackRuleEvent(e.id)
                              .then(() =>
                                setRuleEvents((prev) =>
                                  prev.map((x) => (x.id === e.id ? { ...x, status: "acked" } : x)),
                                ),
                              )
                              .catch((err: Error) => setError(err.message))
                          }
                        >
                          Ack
                        </button>
                      ) : (
                        <em className={`fleet-sev is-${e.severity}`}>{e.severity}</em>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
