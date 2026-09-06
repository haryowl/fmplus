import { useEffect, useMemo, useState, type FormEvent } from "react";
import { fetchGroups, fetchUsersForGroup, fetchUsersStatus, groupOptionLabel } from "../lib/api";
import { TIMEZONES } from "../lib/config";
import {
  createServiceEvent,
  deleteServiceEvent,
  downloadMaintenanceExcel,
  eventVehicleLabel,
  eventWhen,
  fetchMaintReminders,
  ackMaintReminder,
  evaluateMaintReminders,
  fetchScheduleSummary,
  fetchServiceEvents,
  formatServiceDuration,
  patchServiceEvent,
  scheduleLabel,
  SCHEDULE_HEALTH_LABELS,
  SERVICE_STATUS_LABELS,
  type MaintenanceReminder,
  type MaintenanceStatusFilter,
  type ScheduleDashboard,
  type ScheduleHealth,
  type ScheduleSummary,
  type ServiceEvent,
  type ServiceEventStatus,
} from "../lib/maintenance";
import { filterStatusRows, type LastStatusRow } from "../lib/lastStatus";
import { formatKm, formatSpeed } from "../lib/format";
import { fullHref, tripsHref, writeLocationSearch } from "../lib/routing";
import { useEmbedTenant } from "../lib/useEmbedTenant";
import type { Group, User } from "../lib/types";
import { BrandMark } from "../components/BrandMark";
import { MaintenanceCatalogPanel } from "../components/MaintenanceCatalogPanel";
import { MaintenanceCostDashboard } from "../components/MaintenanceCostDashboard";
import { MaintenanceEventDetail } from "../components/MaintenanceEventDetail";
import { MaintenanceScheduleCharts } from "../components/MaintenanceScheduleCharts";
import { ViewNav } from "../components/ViewNav";

const COMPLETED_PREVIEW = 1;

type VehicleGroup = {
  key: string;
  label: string;
  events: ServiceEvent[];
};

function vehicleGroupKey(ev: ServiceEvent): string {
  if (ev.armadaUserId != null) return `u:${ev.armadaUserId}`;
  return `n:${eventVehicleLabel(ev)}`;
}

function eventSortMs(ev: ServiceEvent): number {
  const raw = ev.endedAt || ev.updatedAt || ev.createdAt || "";
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

function groupEventsByVehicle(events: ServiceEvent[]): VehicleGroup[] {
  const map = new Map<string, VehicleGroup>();
  for (const ev of events) {
    const key = vehicleGroupKey(ev);
    let g = map.get(key);
    if (!g) {
      g = { key, label: eventVehicleLabel(ev), events: [] };
      map.set(key, g);
    }
    g.events.push(ev);
  }
  for (const g of map.values()) {
    g.events.sort((a, b) => eventSortMs(b) - eventSortMs(a));
  }
  return [...map.values()].sort((a, b) => {
    const au = Math.max(0, ...a.events.map((e) => e.scheduleUrgency ?? 0));
    const bu = Math.max(0, ...b.events.map((e) => e.scheduleUrgency ?? 0));
    if (bu !== au) return bu - au;
    return a.label.localeCompare(b.label);
  });
}

function groupNeedsAttention(g: VehicleGroup): boolean {
  return g.events.some(
    (e) =>
      e.status === "in_progress" ||
      e.scheduleHealth === "overdue" ||
      e.scheduleHealth === "due",
  );
}

function vehicleSearch(userId: number): string {
  const params = new URLSearchParams(window.location.search);
  params.set("userId", String(userId));
  params.delete("userIds");
  const q = params.toString();
  return q ? `?${q}` : "";
}

function defaultTitle(): string {
  return `Service · ${new Date().toISOString().slice(0, 10)}`;
}

const REMINDER_KIND_LABELS: Record<string, string> = {
  overdue: "Overdue",
  due_soon: "Due soon",
  next_due: "Next due",
  assigned: "Assigned",
};

const CHANNEL_LABELS: Record<string, string> = {
  platform: "Inbox",
  whatsapp: "WA",
  email: "Email",
};

export default function MaintenanceBoard() {
  const {
    query,
    ready,
    error: tenantError,
    entitlements,
    allowedUserIds,
    allowedGroupIds,
    allowsUser,
    allowsGroup,
  } = useEmbedTenant();
  const [timezone, setTimezone] = useState(query.tz);
  const [groupId, setGroupId] = useState(query.groupId);
  const [statusFilter, setStatusFilter] = useState<MaintenanceStatusFilter>("open");
  const [healthFilter, setHealthFilter] = useState<"" | "upcoming" | "due" | "overdue" | "completed">(
    "",
  );
  const [scheduleSummary, setScheduleSummary] = useState<ScheduleSummary | null>(null);
  const [scheduleDash, setScheduleDash] = useState<ScheduleDashboard | null>(null);
  const [events, setEvents] = useState<ServiceEvent[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [statusRows, setStatusRows] = useState<LastStatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [showCreate, setShowCreate] = useState(
    () => Boolean(query.userId) || new URLSearchParams(window.location.search).get("open") === "1",
  );
  const [title, setTitle] = useState(defaultTitle);
  const [notes, setNotes] = useState("");
  const [selectedUserId, setSelectedUserId] = useState(query.userId || "");
  const [vehicleQuery, setVehicleQuery] = useState("");
  const [remindDueAt, setRemindDueAt] = useState("");
  const [remindIntervalDays, setRemindIntervalDays] = useState("");
  const [remindIntervalKm, setRemindIntervalKm] = useState("");
  const [remindIntervalHours, setRemindIntervalHours] = useState("");
  const [remindBeforeDays, setRemindBeforeDays] = useState("");
  const [remindBeforeKm, setRemindBeforeKm] = useState("");
  const [remindBeforeHours, setRemindBeforeHours] = useState("");
  const [reminders, setReminders] = useState<MaintenanceReminder[]>([]);
  const [remindersOpen, setRemindersOpen] = useState(true);
  const [reminderKind, setReminderKind] = useState<"all" | "overdue" | "due_soon" | "next_due" | "assigned">(
    "all",
  );
  const [listQuery, setListQuery] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [historyExtra, setHistoryExtra] = useState<Record<string, number>>({});
  const [eventId, setEventId] = useState(
    () => new URLSearchParams(window.location.search).get("eventId") || "",
  );
  const [boardPanel, setBoardPanel] = useState<"jobs" | "catalog" | "costs">("jobs");

  const excelOk = entitlements.features.excel !== false;
  const deleteOk = entitlements.features.deleteMaintenance === true;
  const selectedGroup = groups.find((g) => String(g.id) === groupId);

  const statusById = useMemo(() => {
    const map = new Map<number, LastStatusRow>();
    for (const row of statusRows) map.set(row.id, row);
    return map;
  }, [statusRows]);

  const selectedStatus = selectedUserId ? statusById.get(Number(selectedUserId)) : undefined;
  const selectedUser = users.find((u) => String(u.id) === selectedUserId);

  const vehicleOptions = useMemo(() => {
    const q = vehicleQuery.trim().toLowerCase();
    const base =
      groupId && users.length
        ? users
        : statusRows.map((r) => ({ id: r.id, name: r.name, username: r.username }));
    const list = base.map((u) => {
      const st = statusById.get(u.id);
      return {
        id: u.id,
        name: st?.name || u.name || `User ${u.id}`,
        username: st?.username || u.username || "",
        status: st,
      };
    });
    if (!q) return list;
    return list.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.username.toLowerCase().includes(q) ||
        String(v.id).includes(q),
    );
  }, [groupId, users, statusRows, statusById, vehicleQuery]);

  const filteredReminders = useMemo(() => {
    if (reminderKind === "all") return reminders;
    return reminders.filter((r) => r.kind === reminderKind);
  }, [reminders, reminderKind]);

  const reminderCounts = useMemo(() => {
    const counts = { all: reminders.length, overdue: 0, due_soon: 0, next_due: 0, assigned: 0 };
    for (const r of reminders) {
      if (r.kind in counts) counts[r.kind as keyof typeof counts] += 1;
    }
    return counts;
  }, [reminders]);

  const filteredEvents = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    if (!q) return events;
    return events.filter((ev) => {
      const hay = [
        ev.title,
        eventVehicleLabel(ev),
        ev.armadaUsername,
        ev.notes,
        ev.scheduleHealth || "",
        ...(ev.scheduleBits || []),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [events, listQuery]);

  const isHistoryView =
    healthFilter === "completed" ||
    statusFilter === "done" ||
    statusFilter === "approved" ||
    statusFilter === "all" ||
    statusFilter === "skipped";

  const vehicleGroups = useMemo(() => groupEventsByVehicle(filteredEvents), [filteredEvents]);

  useEffect(() => {
    // Collapse quiet vehicle groups when the list is long (esp. Completed history).
    if (filteredEvents.length < 12) return;
    setCollapsedGroups((prev) => {
      const next = { ...prev };
      for (const g of vehicleGroups) {
        if (next[g.key] !== undefined) continue;
        next[g.key] = isHistoryView ? !groupNeedsAttention(g) : g.events.length > 3 && !groupNeedsAttention(g);
      }
      return next;
    });
  }, [vehicleGroups, filteredEvents.length, isHistoryView]);

  useEffect(() => {
    setHistoryExtra({});
  }, [statusFilter, healthFilter]);

  useEffect(() => {
    writeLocationSearch({
      groupId: groupId || null,
      tz: timezone || null,
      userId: selectedUserId || null,
      eventId: eventId || null,
    });
  }, [groupId, timezone, selectedUserId, eventId]);

  useEffect(() => {
    const onPop = () => {
      setEventId(new URLSearchParams(window.location.search).get("eventId") || "");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    document.title = "Maintenance · FM Plus";
  }, []);

  useEffect(() => {
    if (tenantError) setError(tenantError);
  }, [tenantError]);

  useEffect(() => {
    if (!ready) return;
    if (groupId && !allowsGroup(groupId)) {
      setGroupId(allowedGroupIds.length === 1 ? String(allowedGroupIds[0]) : "");
    }
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const ac = new AbortController();
    fetchGroups(ac.signal)
      .then((list) => {
        const next = allowedGroupIds.length ? list.filter((g) => allowsGroup(g.id)) : list;
        setGroups(next);
        if (!groupId && next.length === 1) setGroupId(String(next[0].id));
        if (allowedGroupIds.length === 1) setGroupId(String(allowedGroupIds[0]));
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message);
      });
    return () => ac.abort();
  }, [ready]);

  useEffect(() => {
    if (!selectedGroup) {
      setUsers([]);
      return;
    }
    const ac = new AbortController();
    fetchUsersForGroup(selectedGroup, ac.signal)
      .then((list) => {
        setUsers(allowedUserIds.length ? list.filter((u) => allowsUser(u.id)) : list);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message);
      });
    return () => ac.abort();
  }, [selectedGroup?.id]);

  useEffect(() => {
    if (!ready) return;
    const ac = new AbortController();
    const gid = Number(groupId);
    void fetchUsersStatus({
      groupId: Number.isFinite(gid) && gid > 0 ? gid : undefined,
      signal: ac.signal,
    })
      .then((rows) => {
        const scopeIds =
          groupId && users.length
            ? users.map((u) => u.id)
            : allowedUserIds.length
              ? allowedUserIds
              : undefined;
        setStatusRows(filterStatusRows(rows, scopeIds));
      })
      .catch(() => {
        /* optional enrichment */
      });
    return () => ac.abort();
  }, [ready, groupId, users, reload]);

  useEffect(() => {
    if (!ready) return;
    if (!query.tenantKey) {
      setError("Open this page with k= (embed tenant key) to load maintenance.");
      setLoading(false);
      setEvents([]);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError("");
    const status: MaintenanceStatusFilter =
      healthFilter === "completed" ? "completed" : healthFilter ? "open" : statusFilter;
    const health =
      healthFilter === "upcoming" || healthFilter === "due" || healthFilter === "overdue"
        ? healthFilter
        : undefined;
    void fetchServiceEvents(status, ac.signal, health ? { health } : undefined)
      .then(({ events: list }) => {
        setEvents(list);
        setNow(Date.now());
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [ready, query.tenantKey, statusFilter, healthFilter, reload]);

  useEffect(() => {
    if (!ready || !query.tenantKey) return;
    const ac = new AbortController();
    void fetchScheduleSummary(ac.signal)
      .then((dash) => {
        setScheduleDash(dash);
        setScheduleSummary(dash.summary);
      })
      .catch(() => {
        /* optional */
      });
    return () => ac.abort();
  }, [ready, query.tenantKey, reload]);

  useEffect(() => {
    if (!ready || !query.tenantKey) return;
    const ac = new AbortController();
    void fetchMaintReminders("open", ac.signal)
      .then(setReminders)
      .catch(() => {
        /* optional */
      });
    return () => ac.abort();
  }, [ready, query.tenantKey, reload]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!selectedUserId) {
      setError("Select a vehicle from the fleet list.");
      return;
    }
    setBusyId("create");
    setError("");
    try {
      const uid = Number(selectedUserId);
      const st = statusById.get(uid);
      const name = st?.name || selectedUser?.name || displayFallback(uid);
      const uname = st?.username || selectedUser?.username || "";
      const created = await createServiceEvent({
        title: title.trim() || defaultTitle(),
        notes: notes.trim() || undefined,
        userDisplayName: name,
        armadaUsername: uname || undefined,
        armadaUserId: uid,
        lat: st?.lat ?? null,
        lon: st?.lon ?? null,
        odometerKm: st?.odometerKm ?? null,
        remindDueAt: remindDueAt.trim()
          ? new Date(`${remindDueAt.trim()}T00:00:00`).toISOString()
          : null,
        remindIntervalDays: remindIntervalDays.trim() === "" ? null : Number(remindIntervalDays),
        remindIntervalKm: remindIntervalKm.trim() === "" ? null : Number(remindIntervalKm),
        remindIntervalHours: remindIntervalHours.trim() === "" ? null : Number(remindIntervalHours),
        remindBaselineOdometerKm: st?.odometerKm ?? null,
        remindBeforeDays: remindBeforeDays.trim() === "" ? null : Number(remindBeforeDays),
        remindBeforeKm: remindBeforeKm.trim() === "" ? null : Number(remindBeforeKm),
        remindBeforeHours: remindBeforeHours.trim() === "" ? null : Number(remindBeforeHours),
      });
      setNotes("");
      setTitle(defaultTitle());
      setRemindDueAt("");
      setRemindIntervalDays("");
      setRemindIntervalKm("");
      setRemindIntervalHours("");
      setRemindBeforeDays("");
      setRemindBeforeKm("");
      setRemindBeforeHours("");
      setShowCreate(false);
      setEventId(created.id);
      setReload((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusyId(null);
    }
  }

  function displayFallback(id: number): string {
    return `User ${id}`;
  }

  async function setStatus(id: string, status: ServiceEventStatus) {
    setBusyId(id);
    setError("");
    try {
      const { event: updated, nextEvent } = await patchServiceEvent(id, { status });
      setEvents((prev) => {
        let next = prev;
        if (statusFilter === "open" && (status === "done" || status === "skipped")) {
          next = prev.filter((x) => x.id !== id);
        } else if (statusFilter !== "all" && statusFilter !== "open" && statusFilter !== status) {
          next = prev.filter((x) => x.id !== id);
        } else {
          next = prev.map((x) => (x.id === id ? updated : x));
        }
        if (nextEvent && (statusFilter === "open" || statusFilter === "due" || statusFilter === "all")) {
          next = [nextEvent, ...next.filter((x) => x.id !== nextEvent.id)];
        }
        return next;
      });
      if (nextEvent) {
        setEventId(nextEvent.id);
        void fetchMaintReminders("open").then(setReminders).catch(() => {});
      }
      void fetchScheduleSummary()
        .then((dash) => {
          setScheduleDash(dash);
          setScheduleSummary(dash.summary);
        })
        .catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteJob(ev: ServiceEvent) {
    if (!deleteOk) return;
    const label = ev.title || "this job";
    if (
      !window.confirm(
        `Delete “${label}” permanently? This cannot be undone.${
          ev.status === "approved" || ev.status === "done" ? ` (status: ${ev.status})` : ""
        }`,
      )
    ) {
      return;
    }
    setBusyId(ev.id);
    setError("");
    try {
      await deleteServiceEvent(ev.id);
      setEvents((prev) => prev.filter((x) => x.id !== ev.id));
      if (eventId === ev.id) setEventId("");
      void fetchScheduleSummary()
        .then((dash) => {
          setScheduleDash(dash);
          setScheduleSummary(dash.summary);
        })
        .catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="app maintenance-page">
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <div>
            <h1>Maintenance</h1>
            <p>Due from Armada notifier, or open any fleet vehicle yourself</p>
          </div>
        </div>
        <div className="topbar-actions">
          <ViewNav current="maintenance" />
          <div className="vehicle-chip">{loading ? "Loading…" : `${events.length} events`}</div>
        </div>
      </header>

      <main className="shell">
        <section className="filters">
          <div className="field">
            <label htmlFor="maint-group">Group</label>
            <select id="maint-group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">{groups.length ? "All devices" : "Loading groups…"}</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {groupOptionLabel(group)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="maint-status">Workflow</label>
            <select
              id="maint-status"
              value={healthFilter ? "" : statusFilter}
              disabled={Boolean(healthFilter)}
              onChange={(e) => {
                setHealthFilter("");
                setStatusFilter(e.target.value as MaintenanceStatusFilter);
              }}
            >
              <option value="open">Open (due + in progress)</option>
              <option value="due">Due (workflow)</option>
              <option value="in_progress">In progress</option>
              <option value="done">Done (awaiting approve)</option>
              <option value="approved">Approved</option>
              <option value="skipped">Skipped</option>
              <option value="all">All</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="maint-panel">Panel</label>
            <select
              id="maint-panel"
              value={boardPanel}
              onChange={(e) => setBoardPanel(e.target.value as "jobs" | "catalog" | "costs")}
            >
              <option value="jobs">Jobs</option>
              <option value="catalog">Catalog</option>
              <option value="costs">Approved costs</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="maint-tz">Timezone</label>
            <select id="maint-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field field-actions">
            <label>&nbsp;</label>
            <button type="button" className="btn" disabled={loading} onClick={() => setReload((n) => n + 1)}>
              Refresh
            </button>
          </div>
          {excelOk && (
            <div className="field field-actions">
              <label>&nbsp;</label>
              <button
                type="button"
                className="btn-ghost"
                disabled={!events.length}
                onClick={() => downloadMaintenanceExcel(events)}
              >
                Excel
              </button>
            </div>
          )}
        </section>

        {!eventId && (
          <section className="maintenance-schedule-dash" aria-label="Schedule health">
            <button
              type="button"
              className={`maint-dash-tile${healthFilter === "" ? " is-active" : ""}`}
              onClick={() => {
                setHealthFilter("");
                setStatusFilter("open");
              }}
            >
              <span className="maint-dash-label">Open</span>
              <strong>{scheduleSummary?.open ?? "—"}</strong>
            </button>
            <button
              type="button"
              className={`maint-dash-tile maint-health-upcoming${healthFilter === "upcoming" ? " is-active" : ""}`}
              onClick={() => setHealthFilter("upcoming")}
            >
              <span className="maint-dash-label">Upcoming</span>
              <strong>{scheduleSummary?.upcoming ?? "—"}</strong>
            </button>
            <button
              type="button"
              className={`maint-dash-tile maint-health-due${healthFilter === "due" ? " is-active" : ""}`}
              onClick={() => setHealthFilter("due")}
            >
              <span className="maint-dash-label">Due</span>
              <strong>{scheduleSummary?.due ?? "—"}</strong>
            </button>
            <button
              type="button"
              className={`maint-dash-tile maint-health-overdue${healthFilter === "overdue" ? " is-active" : ""}`}
              onClick={() => setHealthFilter("overdue")}
            >
              <span className="maint-dash-label">Overdue</span>
              <strong>{scheduleSummary?.overdue ?? "—"}</strong>
            </button>
            <button
              type="button"
              className={`maint-dash-tile maint-health-completed${healthFilter === "completed" ? " is-active" : ""}`}
              onClick={() => {
                setBoardPanel("jobs");
                setHealthFilter("completed");
              }}
            >
              <span className="maint-dash-label">Completed</span>
              <strong>{scheduleSummary?.completed ?? "—"}</strong>
              <span className="muted maint-dash-sub">Awaiting approve</span>
            </button>
            <button
              type="button"
              className={`maint-dash-tile${
                boardPanel === "costs" || statusFilter === "approved" ? " is-active" : ""
              }`}
              onClick={() => {
                setBoardPanel("jobs");
                setHealthFilter("");
                setStatusFilter("approved");
              }}
            >
              <span className="maint-dash-label">Approved</span>
              <strong>{scheduleSummary?.approved ?? "—"}</strong>
              <span className="muted maint-dash-sub">Locked</span>
            </button>
            <div className="maint-dash-tile maint-dash-stat" title="Average Start→Done time (last 90 days)">
              <span className="maint-dash-label">Avg service</span>
              <strong>{formatServiceDuration(scheduleSummary?.avgServiceMinutes)}</strong>
              {scheduleSummary?.serviceTimeSamples ? (
                <span className="muted maint-dash-sub">{scheduleSummary.serviceTimeSamples} jobs</span>
              ) : (
                <span className="muted maint-dash-sub">Start→Done</span>
              )}
            </div>
          </section>
        )}

        {!eventId && boardPanel === "catalog" && (
          <MaintenanceCatalogPanel onClose={() => setBoardPanel("jobs")} />
        )}

        {!eventId && boardPanel === "costs" && (
          <MaintenanceCostDashboard
            onOpenEvent={(id) => {
              setEventId(id);
              setBoardPanel("jobs");
            }}
          />
        )}

        {!eventId && boardPanel === "jobs" && (scheduleSummary || scheduleDash) && (
          <MaintenanceScheduleCharts
            summary={scheduleSummary}
            healthBars={scheduleDash?.healthBars}
            timeline={scheduleDash?.timeline}
            onSelectHealth={(key) => {
              if (!key) {
                setHealthFilter("");
                setStatusFilter("open");
                return;
              }
              setHealthFilter(key);
            }}
          />
        )}

        {!eventId && boardPanel === "jobs" && (
        <div className="maintenance-toolbar">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setShowCreate(true);
              if (!title.trim()) setTitle(defaultTitle());
            }}
          >
            Open for vehicle
          </button>
          <button type="button" className="btn-secondary" onClick={() => setBoardPanel("catalog")}>
            Catalog
          </button>
          <button type="button" className="btn-secondary" onClick={() => setBoardPanel("costs")}>
            Cost dashboard
          </button>
          {showCreate && (
            <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>
              Cancel
            </button>
          )}
        </div>
        )}

        {!eventId && boardPanel === "jobs" && showCreate && (
          <form className="maintenance-create" onSubmit={(e) => void onCreate(e)}>
            <label className="span-2">
              Search vehicle
              <input
                value={vehicleQuery}
                onChange={(e) => setVehicleQuery(e.target.value)}
                placeholder="Name, username, or id"
              />
            </label>
            <label className="span-2">
              Vehicle
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                required
                size={Math.min(8, Math.max(4, vehicleOptions.length || 4))}
              >
                <option value="">Select a vehicle…</option>
                {vehicleOptions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.username ? ` (${v.username})` : ""} · #{v.id}
                    {v.status?.odometerKm != null ? ` · ${formatKm(v.status.odometerKm)} km` : ""}
                  </option>
                ))}
              </select>
            </label>
            {selectedStatus && (
              <p className="span-2 muted maintenance-hint">
                Last status: {selectedStatus.ignition === true ? "Ign on" : selectedStatus.ignition === false ? "Ign off" : "Ign —"}
                {selectedStatus.speedKmh != null ? ` · ${formatSpeed(selectedStatus.speedKmh)} km/h` : ""}
                {selectedStatus.odometerKm != null ? ` · odo ${formatKm(selectedStatus.odometerKm)} km` : ""}
                {selectedStatus.lat != null && selectedStatus.lon != null
                  ? ` · ${selectedStatus.lat.toFixed(5)}, ${selectedStatus.lon.toFixed(5)}`
                  : " · no fix"}
                {" — name, odo, and position are saved on create."}
              </p>
            )}
            <label className="span-2">
              Title
              <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
            </label>
            <label className="span-2">
              Notes (optional)
              <input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            <fieldset className="span-2 maintenance-schedule">
              <legend>Schedule / remind (optional)</legend>
              <div className="maintenance-schedule-grid">
                <label>
                  Due date
                  <input type="date" value={remindDueAt} onChange={(e) => setRemindDueAt(e.target.value)} />
                </label>
                <label>
                  Interval (days)
                  <input
                    type="number"
                    min={1}
                    step={1}
                    placeholder="e.g. 90"
                    value={remindIntervalDays}
                    onChange={(e) => setRemindIntervalDays(e.target.value)}
                  />
                </label>
                <label>
                  Interval (km)
                  <input
                    type="number"
                    min={1}
                    step="any"
                    placeholder="e.g. 5000"
                    value={remindIntervalKm}
                    onChange={(e) => setRemindIntervalKm(e.target.value)}
                  />
                </label>
                <label>
                  Interval (hours, ign-on)
                  <input
                    type="number"
                    min={1}
                    step="any"
                    placeholder="e.g. 250"
                    value={remindIntervalHours}
                    onChange={(e) => setRemindIntervalHours(e.target.value)}
                  />
                </label>
                <label>
                  Remind before (days)
                  <input
                    type="number"
                    min={0}
                    step={1}
                    placeholder="7"
                    value={remindBeforeDays}
                    onChange={(e) => setRemindBeforeDays(e.target.value)}
                  />
                </label>
                <label>
                  Remind before (km)
                  <input
                    type="number"
                    min={0}
                    step="any"
                    placeholder="500"
                    value={remindBeforeKm}
                    onChange={(e) => setRemindBeforeKm(e.target.value)}
                  />
                </label>
                <label>
                  Remind before (hours)
                  <input
                    type="number"
                    min={0}
                    step="any"
                    placeholder="auto"
                    value={remindBeforeHours}
                    onChange={(e) => setRemindBeforeHours(e.target.value)}
                  />
                </label>
              </div>
              <p className="muted maintenance-hint">
                Baseline odo for km interval is taken from the vehicle’s last status when you create.
                Detail re-checks live `/usersstatus` odometer for accrued km. Hour intervals accrue
                ignition-on track time from create (lookback capped at 90 days).
              </p>
            </fieldset>
            <div className="span-2">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={busyId === "create" || !selectedUserId || !title.trim()}
              >
                Create due event
              </button>
            </div>
          </form>
        )}

        {error && <div className="banner error">{error}</div>}

        {!eventId && boardPanel === "jobs" && (
          <section className={`maintenance-inbox${remindersOpen ? " is-open" : ""}`}>
            <div className="maintenance-inbox-head">
              <button
                type="button"
                className="maintenance-inbox-toggle"
                onClick={() => setRemindersOpen((o) => !o)}
                aria-expanded={remindersOpen}
              >
                <span className="maintenance-inbox-title">
                  Inbox
                  <span className="maint-count">{reminders.length}</span>
                </span>
                <span className="muted">{remindersOpen ? "Hide" : "Show"}</span>
              </button>
              <div className="maintenance-inbox-tools">
                {reminders.length > 0 && (
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => {
                      const ids = filteredReminders.map((r) => r.id);
                      void Promise.all(ids.map((id) => ackMaintReminder(id)))
                        .then(() => setReminders((prev) => prev.filter((r) => !ids.includes(r.id))))
                        .catch((err) => setError(err instanceof Error ? err.message : "Ack failed"));
                    }}
                  >
                    Ack shown
                  </button>
                )}
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    void evaluateMaintReminders()
                      .then(() => setReload((n) => n + 1))
                      .catch((err) => setError(err instanceof Error ? err.message : "Evaluate failed"));
                  }}
                >
                  Check
                </button>
              </div>
            </div>

            {remindersOpen && (
              <>
                <div className="maintenance-inbox-filters">
                  {(
                    [
                      ["all", "All"],
                      ["overdue", "Overdue"],
                      ["due_soon", "Due soon"],
                      ["next_due", "Next due"],
                      ["assigned", "Assigned"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      className={`maint-filter-chip${reminderKind === key ? " is-active" : ""}${
                        key !== "all" ? ` kind-${key}` : ""
                      }`}
                      onClick={() => setReminderKind(key)}
                    >
                      {label}
                      <span>{reminderCounts[key]}</span>
                    </button>
                  ))}
                </div>
                {filteredReminders.length === 0 ? (
                  <p className="muted maintenance-inbox-empty">
                    {reminders.length === 0
                      ? "No open reminders. Check to evaluate schedules."
                      : "No reminders in this filter."}
                  </p>
                ) : (
                  <div className="maintenance-inbox-scroll">
                    <table className="maintenance-inbox-table">
                      <thead>
                        <tr>
                          <th>Kind</th>
                          <th>Alert</th>
                          <th>Channel</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {filteredReminders.map((r) => (
                          <tr key={r.id} className={`kind-${r.kind}`}>
                            <td>
                              <span className={`maint-kind kind-${r.kind}`}>
                                {REMINDER_KIND_LABELS[r.kind] || r.kind}
                              </span>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="maintenance-inbox-alert"
                                onClick={() => r.eventId && setEventId(r.eventId)}
                                disabled={!r.eventId}
                              >
                                <strong>{r.title}</strong>
                                <span className="muted">{r.body}</span>
                              </button>
                            </td>
                            <td>
                              <span className="maint-channel">
                                {CHANNEL_LABELS[r.channel] || r.channel}
                                {r.recipient ? ` · ${r.recipient}` : ""}
                              </span>
                            </td>
                            <td className="maintenance-inbox-actions">
                              {r.eventId ? (
                                <button type="button" className="btn-link" onClick={() => setEventId(r.eventId!)}>
                                  Open
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className="btn-ghost"
                                onClick={() =>
                                  void ackMaintReminder(r.id)
                                    .then(() => setReminders((prev) => prev.filter((x) => x.id !== r.id)))
                                    .catch((err) =>
                                      setError(err instanceof Error ? err.message : "Ack failed"),
                                    )
                                }
                              >
                                Ack
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {eventId ? (
          <MaintenanceEventDetail
            eventId={eventId}
            canDelete={deleteOk}
            onClose={() => setEventId("")}
            onOpenEvent={(id) => setEventId(id)}
            onDeleted={(id) => {
              setEvents((prev) => prev.filter((x) => x.id !== id));
              setEventId("");
              void fetchScheduleSummary()
                .then((dash) => {
                  setScheduleDash(dash);
                  setScheduleSummary(dash.summary);
                })
                .catch(() => {});
            }}
            onSaved={(updated) => {
              setEvents((prev) => {
                const exists = prev.some((x) => x.id === updated.id);
                if (!exists) {
                  if (
                    statusFilter === "open" ||
                    statusFilter === "due" ||
                    statusFilter === "all" ||
                    (healthFilter === "completed" && updated.status === "done") ||
                    (statusFilter === "approved" && updated.status === "approved")
                  ) {
                    return [updated, ...prev];
                  }
                  return prev;
                }
                if (
                  statusFilter === "open" &&
                  (updated.status === "done" ||
                    updated.status === "skipped" ||
                    updated.status === "approved")
                ) {
                  return prev.filter((x) => x.id !== updated.id);
                }
                if (healthFilter === "completed" && updated.status !== "done") {
                  return prev.filter((x) => x.id !== updated.id);
                }
                if (
                  statusFilter !== "all" &&
                  statusFilter !== "open" &&
                  statusFilter !== updated.status &&
                  healthFilter !== "completed"
                ) {
                  return prev.filter((x) => x.id !== updated.id);
                }
                return prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x));
              });
              void fetchMaintReminders("open").then(setReminders).catch(() => {});
              void fetchScheduleSummary()
                .then((dash) => {
                  setScheduleDash(dash);
                  setScheduleSummary(dash.summary);
                })
                .catch(() => {});
            }}
          />
        ) : boardPanel === "jobs" ? (
        <>
        <div className="maintenance-list-toolbar">
          <label className="maintenance-list-search">
            <span className="visually-hidden">Filter jobs</span>
            <input
              value={listQuery}
              onChange={(e) => setListQuery(e.target.value)}
              placeholder="Filter by vehicle, title, schedule…"
            />
          </label>
          <span className="muted maintenance-list-count">
            {filteredEvents.length} jobs · {vehicleGroups.length} vehicles
          </span>
          {vehicleGroups.length > 1 ? (
            <div className="maintenance-list-fold">
              <button
                type="button"
                className="btn-ghost btn-compact"
                onClick={() => {
                  const next: Record<string, boolean> = {};
                  for (const g of vehicleGroups) next[g.key] = false;
                  setCollapsedGroups(next);
                }}
              >
                Expand all
              </button>
              <button
                type="button"
                className="btn-ghost btn-compact"
                onClick={() => {
                  const next: Record<string, boolean> = {};
                  for (const g of vehicleGroups) next[g.key] = true;
                  setCollapsedGroups(next);
                }}
              >
                Collapse all
              </button>
            </div>
          ) : null}
        </div>
        {filteredEvents.length === 0 && !loading ? (
          <p className="muted maintenance-empty">
            {query.tenantKey
              ? listQuery.trim()
                ? "No jobs match this filter."
                : healthFilter === "completed" || statusFilter === "done"
                  ? "No completed jobs yet. When a technician presses Done on /m, the job appears here with parts, photos, and service time."
                  : "No open jobs. Field completions are under Completed. Unassigned next-cycle jobs stay hidden until you assign them."
              : "Add k= to the URL."}
          </p>
        ) : (
          <div className="maintenance-vehicle-list">
            {vehicleGroups.map((group) => {
              const collapsed = Boolean(collapsedGroups[group.key]);
              const preview =
                isHistoryView
                  ? COMPLETED_PREVIEW + (historyExtra[group.key] || 0)
                  : group.events.length;
              const visible = collapsed ? [] : group.events.slice(0, preview);
              const hiddenCount = collapsed ? group.events.length : Math.max(0, group.events.length - preview);
              const openCount = group.events.filter((e) => e.status === "due" || e.status === "in_progress").length;
              const doneCount = group.events.filter((e) => e.status === "done").length;
              return (
                <section key={group.key} className="maint-vehicle-group">
                  <button
                    type="button"
                    className="maint-vehicle-head"
                    aria-expanded={!collapsed}
                    onClick={() =>
                      setCollapsedGroups((prev) => ({ ...prev, [group.key]: !collapsed }))
                    }
                  >
                    <span className="maint-vehicle-chevron" aria-hidden>
                      {collapsed ? "›" : "▾"}
                    </span>
                    <strong>{group.label}</strong>
                    <span className="muted">
                      {group.events.length} job{group.events.length === 1 ? "" : "s"}
                      {openCount ? ` · ${openCount} open` : ""}
                      {doneCount ? ` · ${doneCount} done` : ""}
                    </span>
                  </button>
                  {!collapsed ? (
                    <ul className="maintenance-list">
                      {visible.map((ev) => {
                        const search = ev.armadaUserId ? vehicleSearch(ev.armadaUserId) : "";
                        const health =
                          ev.scheduleHealth &&
                          ev.scheduleHealth !== "none" &&
                          ev.scheduleHealth !== "completed"
                            ? ev.scheduleHealth
                            : "";
                        const scheduleText =
                          ev.scheduleBits && ev.scheduleBits.length > 0
                            ? ev.scheduleBits.join("; ")
                            : scheduleLabel(ev) || "";
                        return (
                          <li
                            key={ev.id}
                            className={`maint-row maint-row-compact maint-status-${ev.status}${
                              health ? ` maint-health-${health}` : ""
                            }`}
                          >
                            <div className={`maint-row-rail${health ? ` is-${health}` : ""}`} aria-hidden />
                            <button
                              type="button"
                              className="maint-row-main maintenance-row-title"
                              onClick={() => setEventId(ev.id)}
                            >
                              <strong>{ev.title}</strong>
                              <span className="maint-row-meta muted">
                                <span className={`maint-badge maint-status-${ev.status}`}>
                                  {SERVICE_STATUS_LABELS[ev.status]}
                                </span>
                                {ev.parentEventId ? <span className="maint-badge">Follow-up</span> : null}
                                {health ? (
                                  <span className={`maint-badge maint-health-${health}`}>
                                    {SCHEDULE_HEALTH_LABELS[health as ScheduleHealth]}
                                  </span>
                                ) : null}
                                <span>{eventWhen(ev, now)}</span>
                                {ev.odometerKm != null ? <span>{formatKm(ev.odometerKm)} km</span> : null}
                                {ev.serviceDurationMinutes != null ? (
                                  <span>{formatServiceDuration(ev.serviceDurationMinutes)}</span>
                                ) : null}
                                {scheduleText ? <span title={scheduleText}>{scheduleText}</span> : null}
                              </span>
                            </button>
                            <div className="maintenance-row-actions">
                              {ev.armadaUserId ? (
                                <span className="maint-row-links">
                                  <a className="btn-link" href={tripsHref(search)}>
                                    Trips
                                  </a>
                                  <a className="btn-link" href={fullHref(search)}>
                                    Full
                                  </a>
                                </span>
                              ) : null}
                              {ev.status === "due" && (
                                <button
                                  type="button"
                                  className="btn btn-primary btn-compact"
                                  disabled={busyId === ev.id}
                                  onClick={() => void setStatus(ev.id, "in_progress")}
                                >
                                  Start
                                </button>
                              )}
                              {ev.status === "in_progress" && (
                                <button
                                  type="button"
                                  className="btn btn-primary btn-compact"
                                  disabled={busyId === ev.id}
                                  onClick={() => void setStatus(ev.id, "done")}
                                >
                                  Done
                                </button>
                              )}
                              {(ev.status === "due" || ev.status === "in_progress") && (
                                <button
                                  type="button"
                                  className="btn-ghost btn-compact"
                                  disabled={busyId === ev.id}
                                  onClick={() => void setStatus(ev.id, "skipped")}
                                >
                                  Skip
                                </button>
                              )}
                              {(ev.status === "done" || ev.status === "skipped") && (
                                <button
                                  type="button"
                                  className="btn-secondary btn-compact"
                                  disabled={busyId === ev.id}
                                  onClick={() => void setStatus(ev.id, "due")}
                                >
                                  Reopen
                                </button>
                              )}
                              {deleteOk ? (
                                <button
                                  type="button"
                                  className="btn-ghost btn-compact"
                                  disabled={busyId === ev.id}
                                  onClick={() => void deleteJob(ev)}
                                >
                                  Delete
                                </button>
                              ) : null}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                  {hiddenCount > 0 ? (
                    <button
                      type="button"
                      className="maint-vehicle-more"
                      onClick={() => {
                        if (collapsed) {
                          setCollapsedGroups((prev) => ({ ...prev, [group.key]: false }));
                          return;
                        }
                        setHistoryExtra((prev) => ({
                          ...prev,
                          [group.key]: (prev[group.key] || 0) + 5,
                        }));
                      }}
                    >
                      {collapsed ? `Show ${hiddenCount} jobs` : `Show ${Math.min(5, hiddenCount)} older… (${hiddenCount} hidden)`}
                    </button>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
        </>
        ) : null}
      </main>
    </div>
  );
}
