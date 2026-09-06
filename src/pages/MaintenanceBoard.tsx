import { useEffect, useMemo, useState, type FormEvent } from "react";
import { fetchGroups, fetchUsersForGroup, fetchUsersStatus, groupOptionLabel } from "../lib/api";
import { TIMEZONES } from "../lib/config";
import {
  createServiceEvent,
  downloadMaintenanceExcel,
  eventVehicleLabel,
  eventWhen,
  fetchMaintReminders,
  ackMaintReminder,
  evaluateMaintReminders,
  fetchScheduleSummary,
  fetchServiceEvents,
  patchServiceEvent,
  scheduleLabel,
  SCHEDULE_HEALTH_LABELS,
  SERVICE_STATUS_LABELS,
  type MaintenanceReminder,
  type MaintenanceStatusFilter,
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
import { MaintenanceEventDetail } from "../components/MaintenanceEventDetail";
import { ViewNav } from "../components/ViewNav";

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
  const [eventId, setEventId] = useState(
    () => new URLSearchParams(window.location.search).get("eventId") || "",
  );

  const excelOk = entitlements.features.excel !== false;
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
      healthFilter === "completed" ? "done" : healthFilter ? "open" : statusFilter;
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
      .then(setScheduleSummary)
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
      void fetchScheduleSummary().then(setScheduleSummary).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
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
              <option value="done">Done</option>
              <option value="skipped">Skipped</option>
              <option value="all">All</option>
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
              onClick={() => setHealthFilter("completed")}
            >
              <span className="maint-dash-label">Completed</span>
              <strong>{scheduleSummary?.completed ?? "—"}</strong>
            </button>
          </section>
        )}

        {!eventId && (
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
          {showCreate && (
            <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>
              Cancel
            </button>
          )}
        </div>
        )}

        {!eventId && showCreate && (
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

        {!eventId && reminders.length > 0 && (
          <section className="maintenance-reminders">
            <div className="maintenance-reminders-head">
              <h2>Reminders</h2>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  void evaluateMaintReminders()
                    .then((r) => {
                      setReload((n) => n + 1);
                      if (r.emitted === 0) setError("");
                    })
                    .catch((err) => setError(err instanceof Error ? err.message : "Evaluate failed"));
                }}
              >
                Check reminders
              </button>
            </div>
            <ul className="maintenance-reminder-list">
              {reminders.map((r) => (
                <li key={r.id}>
                  <div>
                    <strong>{r.title}</strong>
                    <span className="muted">
                      {r.kind} · {r.channel}
                      {r.recipient ? ` · ${r.recipient}` : ""}
                    </span>
                    <span className="muted">{r.body}</span>
                  </div>
                  <div className="maintenance-row-actions">
                    {r.eventId ? (
                      <button type="button" className="btn-link" onClick={() => setEventId(r.eventId!)}>
                        Open
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() =>
                        void ackMaintReminder(r.id)
                          .then(() => setReminders((prev) => prev.filter((x) => x.id !== r.id)))
                          .catch((err) => setError(err instanceof Error ? err.message : "Ack failed"))
                      }
                    >
                      Ack
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {eventId ? (
          <MaintenanceEventDetail
            eventId={eventId}
            onClose={() => setEventId("")}
            onOpenEvent={(id) => setEventId(id)}
            onSaved={(updated) => {
              setEvents((prev) => {
                const exists = prev.some((x) => x.id === updated.id);
                if (!exists) {
                  if (
                    statusFilter === "open" ||
                    statusFilter === "due" ||
                    statusFilter === "all"
                  ) {
                    return [updated, ...prev];
                  }
                  return prev;
                }
                if (statusFilter === "open" && (updated.status === "done" || updated.status === "skipped")) {
                  return prev.filter((x) => x.id !== updated.id);
                }
                if (
                  statusFilter !== "all" &&
                  statusFilter !== "open" &&
                  statusFilter !== updated.status
                ) {
                  return prev.filter((x) => x.id !== updated.id);
                }
                return prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x));
              });
              void fetchMaintReminders("open").then(setReminders).catch(() => {});
            }}
          />
        ) : (
        <ul className="maintenance-list">
          {events.length === 0 && !loading && (
            <li className="muted maintenance-empty">
              {query.tenantKey
                ? "No service events yet. Open for a fleet vehicle above, or wire Armada Maintenance Schedule (kind=maintenance)."
                : "Add k= to the URL."}
            </li>
          )}
          {events.map((ev) => {
            const search = ev.armadaUserId ? vehicleSearch(ev.armadaUserId) : "";
            return (
              <li key={ev.id} className={`maint-status-${ev.status}`}>
                <div className="maintenance-row-main">
                  <button type="button" className="maintenance-row-title" onClick={() => setEventId(ev.id)}>
                    <strong>{ev.title}</strong>
                  </button>
                  <span className="maintenance-row-badges">
                    <span className={`maint-badge maint-status-${ev.status}`}>
                      {SERVICE_STATUS_LABELS[ev.status]}
                    </span>
                    {ev.scheduleHealth &&
                    ev.scheduleHealth !== "none" &&
                    ev.scheduleHealth !== "completed" ? (
                      <span className={`maint-badge maint-health-${ev.scheduleHealth}`}>
                        {SCHEDULE_HEALTH_LABELS[ev.scheduleHealth as ScheduleHealth]}
                      </span>
                    ) : null}
                  </span>
                  <span className="muted">
                    {eventWhen(ev, now)} · {eventVehicleLabel(ev)}
                    {ev.notificationId ? " · from notifier" : " · manual"}
                    {ev.odometerKm != null ? ` · ${formatKm(ev.odometerKm)} km` : ""}
                    {ev.servicePointName ? ` · ${ev.servicePointName}` : ""}
                  </span>
                  {ev.scheduleBits && ev.scheduleBits.length > 0 ? (
                    <span className="muted">Schedule: {ev.scheduleBits.join("; ")}</span>
                  ) : scheduleLabel(ev) ? (
                    <span className="muted">Remind: {scheduleLabel(ev)}</span>
                  ) : null}
                  {ev.notes ? <span className="muted">{ev.notes}</span> : null}
                </div>
                <div className="maintenance-row-actions">
                  <button type="button" className="btn-secondary" onClick={() => setEventId(ev.id)}>
                    Detail
                  </button>
                  {ev.armadaUserId ? (
                    <>
                      <a className="btn-link" href={tripsHref(search)}>
                        Trips
                      </a>
                      <a className="btn-link" href={fullHref(search)}>
                        Full
                      </a>
                    </>
                  ) : null}
                  {ev.status === "due" && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busyId === ev.id}
                      onClick={() => void setStatus(ev.id, "in_progress")}
                    >
                      Start
                    </button>
                  )}
                  {(ev.status === "due" || ev.status === "in_progress") && (
                    <>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={busyId === ev.id}
                        onClick={() => void setStatus(ev.id, "done")}
                      >
                        Done
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={busyId === ev.id}
                        onClick={() => void setStatus(ev.id, "skipped")}
                      >
                        Skip
                      </button>
                    </>
                  )}
                  {(ev.status === "done" || ev.status === "skipped") && (
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={busyId === ev.id}
                      onClick={() => void setStatus(ev.id, "due")}
                    >
                      Reopen
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        )}
      </main>
    </div>
  );
}
