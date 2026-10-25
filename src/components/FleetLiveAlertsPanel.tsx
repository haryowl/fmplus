import { useEffect, useMemo, useState } from "react";
import { addDays, todayKeyInOffset, zonedEndMs, zonedStartMs } from "../lib/time";
import { classifyAlarmType, eventClassLabel, type EventClass } from "../lib/eventClass";
import {
  eventDisplayTitle,
  fetchFleetAlerts,
  type FleetMediaEvent,
} from "../lib/fleetMedia";
import {
  ackRuleEvent,
  deleteAlertRule,
  fetchAlertRules,
  fetchRuleEvents,
  fetchRuleHolds,
  formatHoldClock,
  formatAlertFormula,
  isMappedField,
  previewAlertRule,
  resolveRuleEvent,
  RULE_CMPS,
  RULE_FIELDS,
  saveAlertRule,
  type AlertActionBranch,
  type AlertCondition,
  type AlertFormula,
  type FleetAlertRule,
  type FleetRuleEvent,
  type FleetRuleHold,
} from "../lib/fleetAlertRules";
import type { FleetTripDeviceOption } from "./FleetLiveTripsPanel";
import type { TrackerDeviceGroup } from "../lib/trackerDevices";
import { FleetLiveSectionHead } from "./FleetLiveSectionHead";
import {
  IcoAlerts,
  IcoAttention,
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

const emptyGroup = (): AlertFormula => ({
  op: "and",
  conditions: [emptyCondition()],
});

type ElseDraft = {
  op: "and" | "or";
  conditions: AlertCondition[];
  severity: "info" | "warning" | "critical";
  notifyEmail: boolean;
  notifyWhatsapp: boolean;
};

const emptyElse = (): ElseDraft => ({
  op: "and",
  conditions: [emptyCondition()],
  severity: "warning",
  notifyEmail: true,
  notifyWhatsapp: false,
});

function coerceSavedCondition(c: AlertCondition): AlertCondition {
  let value: string | number | boolean = c.value;
  if (c.field === "ignition") {
    value = String(c.value) === "true" || c.value === true;
  } else if (
    c.cmp !== "in" &&
    c.cmp !== "contains" &&
    typeof c.value === "string" &&
    c.value.trim() !== "" &&
    !Number.isNaN(Number(c.value))
  ) {
    value = Number(c.value);
  }
  return { field: c.field, cmp: c.cmp, value };
}

function ConditionList({
  conditions,
  onChange,
  min = 0,
}: {
  conditions: AlertCondition[];
  onChange: (next: AlertCondition[]) => void;
  min?: number;
}) {
  return (
    <>
      {conditions.map((c, idx) => (
        <div key={idx} className="fleet-rules-cond-row">
          <select
            value={isMappedField(c.field) ? "__mapped__" : c.field}
            onChange={(e) => {
              const next = [...conditions];
              const v = e.target.value;
              if (v === "__mapped__") {
                next[idx] = {
                  ...c,
                  field: isMappedField(c.field) ? c.field : "mapped.",
                  cmp: c.cmp === "in" || c.cmp === "contains" ? c.cmp : "==",
                };
              } else {
                next[idx] = {
                  ...c,
                  field: v,
                  value: v === "ignition" ? "true" : c.value,
                };
              }
              onChange(next);
            }}
          >
            {RULE_FIELDS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
            <option value="__mapped__">Mapped attr…</option>
          </select>
          {isMappedField(c.field) ? (
            <input
              className="fleet-rules-mapped-key"
              placeholder="attr key (e.g. alarm)"
              value={c.field.slice("mapped.".length)}
              onChange={(e) => {
                const key = e.target.value.replace(/^mapped\./i, "").trim();
                const next = [...conditions];
                next[idx] = { ...c, field: `mapped.${key}` };
                onChange(next);
              }}
            />
          ) : null}
          <select
            value={c.cmp}
            onChange={(e) => {
              const next = [...conditions];
              next[idx] = { ...c, cmp: e.target.value };
              onChange(next);
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
                const next = [...conditions];
                next[idx] = { ...c, value: e.target.value };
                onChange(next);
              }}
            >
              <option value="true">On</option>
              <option value="false">Off</option>
            </select>
          ) : (
            <input
              value={String(c.value)}
              placeholder={c.cmp === "in" ? "a, b, c" : c.cmp === "contains" ? "text" : ""}
              onChange={(e) => {
                const next = [...conditions];
                next[idx] = { ...c, value: e.target.value };
                onChange(next);
              }}
            />
          )}
          <button
            type="button"
            className="fleet-cc-icon-btn"
            disabled={conditions.length <= min}
            onClick={() => onChange(conditions.filter((_, i) => i !== idx))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="fleet-cc-icon-btn"
        onClick={() => onChange([...conditions, emptyCondition()])}
      >
        Add condition
      </button>
    </>
  );
}

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
  const [classTab, setClassTab] = useState<Exclude<EventClass, "none">>("safety");
  const [deviceId, setDeviceId] = useState(() => initialDeviceId || "");
  const [dateFrom, setDateFrom] = useState(() => addDays(todayKeyInOffset(timezone), -1));
  const [dateTo, setDateTo] = useState(() => todayKeyInOffset(timezone));
  const [minLevel, setMinLevel] = useState(0);
  const [safety, setSafety] = useState<FleetMediaEvent[]>([]);
  const [ruleEvents, setRuleEvents] = useState<FleetRuleEvent[]>([]);
  const [rules, setRules] = useState<FleetAlertRule[]>([]);
  const [holds, setHolds] = useState<FleetRuleHold[]>([]);
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
  const [draftGroups, setDraftGroups] = useState<AlertFormula[]>([]);
  const [draftElse, setDraftElse] = useState<ElseDraft[]>([]);
  const [previewDeviceId, setPreviewDeviceId] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [previewText, setPreviewText] = useState("");
  const [editId, setEditId] = useState<string | null>(null);

  const reloadRules = () =>
    Promise.all([
      fetchAlertRules(),
      fetchRuleHolds({ limit: 40 }).catch(() => [] as FleetRuleHold[]),
    ])
      .then(([list, holdList]) => {
        setRules(list);
        setHolds(holdList);
      })
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
      fetchRuleHolds({ limit: 20 }, ac.signal).catch(() => [] as FleetRuleHold[]),
    ])
      .then(([s, r, h]) => {
        setSafety(s);
        setRuleEvents(r);
        setHolds(h);
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
    () =>
      safety.filter((e) => {
        if ((e.alarmLevel || 0) < minLevel) return false;
        const cls = e.eventClass || classifyAlarmType(e.alarmType).eventClass;
        if (cls === "none") return false;
        return cls === classTab;
      }),
    [safety, minLevel, classTab],
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
      rule.formula.conditions.length ? rule.formula.conditions.map((c) => ({ ...c })) : [],
    );
    setDraftGroups(
      Array.isArray(rule.formula.groups)
        ? rule.formula.groups.map((g) => ({
            op: g.op === "or" ? "or" : "and",
            conditions: g.conditions?.length ? g.conditions.map((c) => ({ ...c })) : [emptyCondition()],
          }))
        : [],
    );
    const branches = Array.isArray(rule.formula.branches) ? rule.formula.branches : [];
    if (branches.length) {
      const first = branches[0];
      setDraftOp(first.formula.op === "or" ? "or" : "and");
      setDraftConditions(
        first.formula.conditions?.length ? first.formula.conditions.map((c) => ({ ...c })) : [emptyCondition()],
      );
      setDraftGroups(
        Array.isArray(first.formula.groups)
          ? first.formula.groups.map((g) => ({
              op: g.op === "or" ? "or" : "and",
              conditions: g.conditions?.length ? g.conditions.map((c) => ({ ...c })) : [emptyCondition()],
            }))
          : [],
      );
      setDraftSeverity(first.severity);
      setDraftEmail(first.notifyEmail);
      setDraftWa(first.notifyWhatsapp);
      setDraftElse(
        branches.slice(1).map((b) => ({
          op: b.formula.op === "or" ? "or" : "and",
          conditions: b.formula.conditions?.length
            ? b.formula.conditions.map((c) => ({ ...c }))
            : [emptyCondition()],
          severity: b.severity,
          notifyEmail: b.notifyEmail,
          notifyWhatsapp: b.notifyWhatsapp,
        })),
      );
    } else {
      setDraftElse([]);
    }
    setPreviewText("");
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
    setDraftGroups([]);
    setDraftElse([]);
    setPreviewText("");
  };

  const packDraftFormula = (): AlertFormula => {
    const when: AlertFormula = {
      op: draftOp,
      conditions: draftConditions.map(coerceSavedCondition),
      groups: draftGroups.map((g) => ({
        op: g.op === "or" ? "or" : "and",
        conditions: (g.conditions || []).map(coerceSavedCondition),
      })),
      durationSec: Math.max(0, draftDurationMin) * 60,
    };
    if (!draftElse.length) return when;
    const branches: AlertActionBranch[] = [
      {
        label: "When",
        formula: { op: when.op, conditions: when.conditions, groups: when.groups },
        severity: draftSeverity,
        notifyEmail: draftEmail,
        notifyWhatsapp: draftWa,
      },
      ...draftElse.map((b, i) => ({
        label: `Else when ${i + 1}`,
        formula: {
          op: b.op,
          conditions: b.conditions.map(coerceSavedCondition),
        },
        severity: b.severity,
        notifyEmail: b.notifyEmail,
        notifyWhatsapp: b.notifyWhatsapp,
      })),
    ];
    return { ...when, branches };
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
    const allConds = [
      ...draftConditions,
      ...draftGroups.flatMap((g) => g.conditions || []),
    ];
    if (allConds.some((c) => isMappedField(c.field) && c.field === "mapped.")) {
      setError("Enter a mapped attribute key");
      return;
    }
    if (!draftConditions.length && !draftGroups.length) {
      setError("Add at least one condition or group");
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
          formula: packDraftFormula(),
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
        title="Events"
        badge={sub === "rules" ? "RULES" : classTab.toUpperCase()}
        subtitle={loading ? "Loading…" : "Safety, warning, and asset events"}
        actions={
          <div className="fleet-ico-tabs" role="tablist">
            {(["safety", "warning", "asset"] as const).map((cls) => (
              <button
                key={cls}
                type="button"
                role="tab"
                className={sub === "events" && classTab === cls ? "is-active" : ""}
                aria-selected={sub === "events" && classTab === cls}
                title={eventClassLabel(cls)}
                onClick={() => {
                  setSub("events");
                  setClassTab(cls);
                }}
              >
                <IcoAlerts />
                <span>{eventClassLabel(cls)}</span>
              </button>
            ))}
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
              <ConditionList
                conditions={draftConditions}
                onChange={setDraftConditions}
                min={draftGroups.length ? 0 : 1}
              />
              {draftGroups.map((g, gi) => (
                <div key={gi} className="fleet-rules-group">
                  <div className="fleet-rules-op-row">
                    <h4>Group {gi + 1}</h4>
                    <label className="fleet-cc-field fleet-rules-op">
                      <span>Match</span>
                      <select
                        value={g.op}
                        onChange={(e) => {
                          const next = [...draftGroups];
                          next[gi] = { ...g, op: e.target.value === "or" ? "or" : "and" };
                          setDraftGroups(next);
                        }}
                      >
                        <option value="and">All (AND)</option>
                        <option value="or">Any (OR)</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="fleet-cc-icon-btn"
                      onClick={() => setDraftGroups(draftGroups.filter((_, i) => i !== gi))}
                    >
                      Remove group
                    </button>
                  </div>
                  <ConditionList
                    conditions={g.conditions || []}
                    min={1}
                    onChange={(conditions) => {
                      const next = [...draftGroups];
                      next[gi] = { ...g, conditions };
                      setDraftGroups(next);
                    }}
                  />
                </div>
              ))}
              <button
                type="button"
                className="fleet-cc-icon-btn"
                onClick={() => setDraftGroups([...draftGroups, emptyGroup()])}
              >
                Add group
              </button>
              {draftElse.map((b, bi) => (
                <div key={bi} className="fleet-rules-group">
                  <div className="fleet-rules-op-row">
                    <h4>Else when {bi + 1}</h4>
                    <label className="fleet-cc-field fleet-rules-op">
                      <span>Match</span>
                      <select
                        value={b.op}
                        onChange={(e) => {
                          const next = [...draftElse];
                          next[bi] = { ...b, op: e.target.value === "or" ? "or" : "and" };
                          setDraftElse(next);
                        }}
                      >
                        <option value="and">All (AND)</option>
                        <option value="or">Any (OR)</option>
                      </select>
                    </label>
                    <label className="fleet-cc-field fleet-rules-op">
                      <span>Then</span>
                      <select
                        value={b.severity}
                        onChange={(e) => {
                          const next = [...draftElse];
                          next[bi] = {
                            ...b,
                            severity: e.target.value as ElseDraft["severity"],
                          };
                          setDraftElse(next);
                        }}
                      >
                        <option value="info">info</option>
                        <option value="warning">warning</option>
                        <option value="critical">critical</option>
                      </select>
                    </label>
                    <label className="fleet-rules-check">
                      <input
                        type="checkbox"
                        checked={b.notifyEmail}
                        onChange={(e) => {
                          const next = [...draftElse];
                          next[bi] = { ...b, notifyEmail: e.target.checked };
                          setDraftElse(next);
                        }}
                      />
                      Email
                    </label>
                    <label className="fleet-rules-check">
                      <input
                        type="checkbox"
                        checked={b.notifyWhatsapp}
                        onChange={(e) => {
                          const next = [...draftElse];
                          next[bi] = { ...b, notifyWhatsapp: e.target.checked };
                          setDraftElse(next);
                        }}
                      />
                      WhatsApp
                    </label>
                    <button
                      type="button"
                      className="fleet-cc-icon-btn"
                      onClick={() => setDraftElse(draftElse.filter((_, i) => i !== bi))}
                    >
                      Remove
                    </button>
                  </div>
                  <ConditionList
                    conditions={b.conditions}
                    min={1}
                    onChange={(conditions) => {
                      const next = [...draftElse];
                      next[bi] = { ...b, conditions };
                      setDraftElse(next);
                    }}
                  />
                </div>
              ))}
              <button
                type="button"
                className="fleet-cc-icon-btn"
                onClick={() => setDraftElse([...draftElse, emptyElse()])}
              >
                Add else-when
              </button>
            </div>

            <div className="fleet-rules-preview">
              <label className="fleet-cc-field">
                <span>Preview last fix</span>
                <select
                  value={previewDeviceId}
                  onChange={(e) => setPreviewDeviceId(e.target.value)}
                >
                  <option value="">Select device…</option>
                  {devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="fleet-cc-icon-btn"
                disabled={previewing || !previewDeviceId}
                onClick={() => {
                  setPreviewing(true);
                  setPreviewText("");
                  void previewAlertRule({
                    deviceId: previewDeviceId,
                    formula: packDraftFormula(),
                  })
                    .then((p) => {
                      const bits = [
                        `speed=${p.snap.speed ?? "—"}`,
                        `ign=${p.snap.ignition ?? "—"}`,
                        `age=${p.snap.age_sec ?? "—"}s`,
                      ];
                      const branch = p.branch ? ` · ${p.branch}` : "";
                      setPreviewText(
                        `${p.result ? "MATCH" : "no match"}${branch} on ${p.label} · ${bits.join(" · ")}`,
                      );
                    })
                    .catch((err: Error) => setPreviewText(err.message || "Preview failed"))
                    .finally(() => setPreviewing(false));
                }}
              >
                {previewing ? "Testing…" : "Test last fix"}
              </button>
              {previewText ? <p className="muted fleet-rules-preview-out">{previewText}</p> : null}
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
                <IcoAttention /> Holding now
              </h3>
              <em className="fleet-dash-pill">{holds.length}</em>
            </header>
            {holds.length === 0 ? (
              <p className="muted fleet-dash-empty">No active duration holds.</p>
            ) : (
              <ul className="fleet-holds-list">
                {holds.map((h) => (
                  <li key={`${h.ruleId}:${h.deviceId}`}>
                    <div>
                      <strong>{h.ruleName}</strong>
                      <span className="muted">
                        {" "}
                        · {h.deviceLabel || "device"}
                      </span>
                      <div className="fleet-hold-bar" aria-hidden>
                        <span style={{ width: `${h.progress}%` }} />
                      </div>
                      <div className="muted">
                        {formatHoldClock(h.heldSec)} / {formatHoldClock(h.durationSec)}
                        {h.phase === "holding"
                          ? " · accumulating"
                          : h.phase === "cooldown"
                            ? " · cooldown"
                            : " · ready to fire"}
                      </div>
                    </div>
                    <em className={`fleet-dash-pill is-${h.phase === "holding" ? "warn" : h.phase === "ready" ? "bad" : "ok"}`}>
                      {h.phase}
                    </em>
                  </li>
                ))}
              </ul>
            )}
          </section>

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
                        {formatAlertFormula(r.formula)}
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
              {holds.length ? (
                <span title="Active holds">
                  <IcoAttention /> <strong>{holds.length}</strong> holding
                </span>
              ) : null}
            </div>
          </div>

          {holds.length ? (
            <section className="fleet-dash-card fleet-holds-compact">
              <header className="fleet-dash-card-head">
                <h3>
                  <IcoAttention /> Holding
                </h3>
                <em className="fleet-dash-pill is-warn">{holds.length}</em>
              </header>
              <ul className="fleet-holds-list">
                {holds.slice(0, 6).map((h) => (
                  <li key={`${h.ruleId}:${h.deviceId}`}>
                    <div>
                      <strong>{h.ruleName}</strong>
                      <span className="muted"> · {h.deviceLabel || "device"}</span>
                      <div className="fleet-hold-bar" aria-hidden>
                        <span style={{ width: `${h.progress}%` }} />
                      </div>
                      <div className="muted">
                        {formatHoldClock(h.heldSec)} / {formatHoldClock(h.durationSec)} · {h.phase}
                      </div>
                    </div>
                    <em className={`fleet-dash-pill is-${h.phase === "holding" ? "warn" : "ok"}`}>
                      {h.progress}%
                    </em>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="fleet-alerts-body">
            <section className="fleet-dash-card">
              <header className="fleet-dash-card-head">
                <h3>
                  <IcoAlerts /> {eventClassLabel(classTab)}
                </h3>
                <em className="fleet-dash-pill">{filteredSafety.length}</em>
              </header>
              {filteredSafety.length === 0 ? (
                <p className="muted fleet-dash-empty">
                  {loading ? "Loading…" : `No ${eventClassLabel(classTab).toLowerCase()} events in this range.`}
                </p>
              ) : (
                <ul className="fleet-alerts-list">
                  {filteredSafety.map((e) => (
                    <li key={e.id} className="fleet-alerts-card">
                      <span
                        className={`fleet-cc-alert-lvl is-l${Math.min(3, Math.max(0, e.alarmLevel || 0))}`}
                      />
                      <div>
                        <strong>{eventDisplayTitle(e.alarmType, e.rawAttrs, e.mappedAttrs)}</strong>
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
                        <div className="muted fleet-rules-notify-flags">
                          {formatWhen(e.firedAt, timezone)}
                          {e.notifyEmailSent ? (
                            <span title="Email sent">
                              <IcoMail /> sent
                            </span>
                          ) : null}
                          {e.notifyWhatsappSent ? (
                            <span title="WhatsApp sent">
                              <IcoWhatsApp /> sent
                            </span>
                          ) : null}
                        </div>
                      </div>
                      {canAckAlerts && (e.status === "open" || e.status === "acked") ? (
                        <div className="fleet-rules-row-actions">
                          {e.status === "open" ? (
                            <button
                              type="button"
                              className="fleet-cc-icon-btn"
                              onClick={() =>
                                void ackRuleEvent(e.id)
                                  .then(() =>
                                    setRuleEvents((prev) =>
                                      prev.map((x) =>
                                        x.id === e.id ? { ...x, status: "acked" } : x,
                                      ),
                                    ),
                                  )
                                  .catch((err: Error) => setError(err.message))
                              }
                            >
                              Ack
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn-primary btn-compact"
                            onClick={() =>
                              void resolveRuleEvent(e.id)
                                .then(() =>
                                  setRuleEvents((prev) =>
                                    prev.map((x) =>
                                      x.id === e.id ? { ...x, status: "resolved" } : x,
                                    ),
                                  ),
                                )
                                .catch((err: Error) => setError(err.message))
                            }
                          >
                            Resolve
                          </button>
                        </div>
                      ) : (
                        <em className={`fleet-sev is-${e.severity}`}>
                          {e.status === "resolved" ? "resolved" : e.severity}
                        </em>
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
