import { useEffect, useState, type FormEvent } from "react";
import { TIMEZONES } from "../lib/config";
import {
  createServiceEvent,
  downloadMaintenanceExcel,
  eventVehicleLabel,
  eventWhen,
  fetchServiceEvents,
  patchServiceEvent,
  SERVICE_STATUS_LABELS,
  type MaintenanceStatusFilter,
  type ServiceEvent,
  type ServiceEventStatus,
} from "../lib/maintenance";
import { fullHref, tripsHref, writeLocationSearch } from "../lib/routing";
import { useEmbedTenant } from "../lib/useEmbedTenant";
import { BrandMark } from "../components/BrandMark";
import { ViewNav } from "../components/ViewNav";

function vehicleSearch(userId: number): string {
  const params = new URLSearchParams(window.location.search);
  params.set("userId", String(userId));
  params.delete("userIds");
  const q = params.toString();
  return q ? `?${q}` : "";
}

export default function MaintenanceBoard() {
  const { query, ready, error: tenantError, entitlements } = useEmbedTenant();
  const [timezone, setTimezone] = useState(query.tz);
  const [statusFilter, setStatusFilter] = useState<MaintenanceStatusFilter>("open");
  const [events, setEvents] = useState<ServiceEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [userId, setUserId] = useState("");

  const excelOk = entitlements.features.excel !== false;

  useEffect(() => {
    writeLocationSearch({ tz: timezone || null });
  }, [timezone]);

  useEffect(() => {
    document.title = "Maintenance · FM Plus";
  }, []);

  useEffect(() => {
    if (tenantError) setError(tenantError);
  }, [tenantError]);

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
    void fetchServiceEvents(statusFilter, ac.signal)
      .then((list) => {
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
  }, [ready, query.tenantKey, statusFilter, reload]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusyId("create");
    setError("");
    try {
      const uid = Number(userId);
      await createServiceEvent({
        title: title.trim(),
        notes: notes.trim() || undefined,
        userDisplayName: displayName.trim() || undefined,
        armadaUsername: username.trim() || undefined,
        armadaUserId: Number.isInteger(uid) && uid > 0 ? uid : null,
      });
      setTitle("");
      setNotes("");
      setDisplayName("");
      setUsername("");
      setUserId("");
      setShowCreate(false);
      setReload((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusyId(null);
    }
  }

  async function setStatus(id: string, status: ServiceEventStatus) {
    setBusyId(id);
    setError("");
    try {
      const updated = await patchServiceEvent(id, { status });
      setEvents((prev) => {
        if (statusFilter === "open" && (status === "done" || status === "skipped")) {
          return prev.filter((x) => x.id !== id);
        }
        if (statusFilter !== "all" && statusFilter !== "open" && statusFilter !== status) {
          return prev.filter((x) => x.id !== id);
        }
        return prev.map((x) => (x.id === id ? updated : x));
      });
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
            <p>Due board from Armada notifier + manual open</p>
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
            <label htmlFor="maint-status">Status</label>
            <select
              id="maint-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as MaintenanceStatusFilter)}
            >
              <option value="open">Open (due + in progress)</option>
              <option value="due">Due</option>
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

        <div className="maintenance-toolbar">
          <button type="button" className="btn-ghost" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? "Hide form" : "Open service event"}
          </button>
        </div>

        {showCreate && (
          <form className="maintenance-create" onSubmit={(e) => void onCreate(e)}>
            <label>
              Title
              <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
            </label>
            <label>
              Vehicle display name
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </label>
            <label>
              Armada username
              <input value={username} onChange={(e) => setUsername(e.target.value)} />
            </label>
            <label>
              Armada user ID
              <input value={userId} onChange={(e) => setUserId(e.target.value)} inputMode="numeric" />
            </label>
            <label className="span-2">
              Notes
              <input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            <div className="span-2">
              <button type="submit" className="btn" disabled={busyId === "create" || !title.trim()}>
                Create due event
              </button>
            </div>
          </form>
        )}

        {error && <div className="banner error">{error}</div>}

        <ul className="maintenance-list">
          {events.length === 0 && !loading && (
            <li className="muted maintenance-empty">
              {query.tenantKey
                ? "No service events. Wire Armada Maintenance Schedule notifier (kind=maintenance) or open one manually."
                : "Add k= to the URL."}
            </li>
          )}
          {events.map((ev) => {
            const search = ev.armadaUserId ? vehicleSearch(ev.armadaUserId) : "";
            return (
              <li key={ev.id} className={`maint-status-${ev.status}`}>
                <div className="maintenance-row-main">
                  <strong>{ev.title}</strong>
                  <span className="muted">
                    {SERVICE_STATUS_LABELS[ev.status]} · {eventWhen(ev, now)} · {eventVehicleLabel(ev)}
                    {ev.notificationId ? " · from notifier" : " · manual"}
                  </span>
                  {ev.notes ? <span className="muted">{ev.notes}</span> : null}
                </div>
                <div className="maintenance-row-actions">
                  {ev.armadaUserId ? (
                    <>
                      <a className="btn-ghost" href={tripsHref(search)}>
                        Trips
                      </a>
                      <a className="btn-ghost" href={fullHref(search)}>
                        Full
                      </a>
                    </>
                  ) : null}
                  {ev.status === "due" && (
                    <button
                      type="button"
                      className="btn"
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
                        className="btn"
                        disabled={busyId === ev.id}
                        onClick={() => void setStatus(ev.id, "done")}
                      >
                        Done
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
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
                      className="btn-ghost"
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
      </main>
    </div>
  );
}
