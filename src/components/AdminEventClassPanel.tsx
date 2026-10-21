import { useEffect, useState, type FormEvent } from "react";
import { EVENT_CLASS_LABELS, type EventClass, type EventEmitOn } from "../lib/eventClass";

type CatalogRow = {
  alarmType: string;
  label: string;
  eventClass: EventClass;
  raiseAlert: boolean;
  emitOn: EventEmitOn;
};

type MapRow = CatalogRow & {
  id: string;
  deviceId?: string | null;
  profileId?: string | null;
};

type Props = {
  tenantId: string;
  profileId?: string;
  deviceId?: string;
  busy?: boolean;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { accept: "application/json", "content-type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export function AdminEventClassPanel({ tenantId, profileId, deviceId, busy }: Props) {
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [maps, setMaps] = useState<MapRow[]>([]);
  const [alarmType, setAlarmType] = useState("ignition");
  const [eventClass, setEventClass] = useState<EventClass>("asset");
  const [raiseAlert, setRaiseAlert] = useState(false);
  const [emitOn, setEmitOn] = useState<EventEmitOn>("change");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function reload() {
    const q = new URLSearchParams();
    if (deviceId) q.set("deviceId", deviceId);
    else if (profileId) q.set("profileId", profileId);
    const data = await api<{ catalog: CatalogRow[]; maps: MapRow[] }>(
      `/api/admin/tenants/${tenantId}/tracker-event-maps?${q}`,
    );
    setCatalog(data.catalog || []);
    setMaps(data.maps || []);
  }

  useEffect(() => {
    if (!tenantId) return;
    void reload().catch((err: Error) => setError(err.message || "Failed to load event classes"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, profileId, deviceId]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(`/api/admin/tenants/${tenantId}/tracker-event-maps`, {
        method: "POST",
        body: JSON.stringify({
          alarmType,
          eventClass,
          raiseAlert,
          emitOn,
          ...(deviceId ? { deviceId } : profileId ? { profileId } : {}),
        }),
      });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm("Remove this event class override?")) return;
    setSaving(true);
    try {
      await api(`/api/admin/tenants/${tenantId}/tracker-event-maps/${id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="admin-dm-fold" open>
      <summary>Event classes</summary>
      <p className="muted">
        Classify device events as Safety, Warning, or Asset. Asset events (ignition, movement) stay
        off the alert drawer unless Raise alert is on.
      </p>
      {error ? <p className="admin-notice">{error}</p> : null}
      <form className="admin-form-grid" onSubmit={(e) => void onSave(e)}>
        <label>
          Event type
          <input
            list="event-type-catalog"
            value={alarmType}
            onChange={(e) => {
              const next = e.target.value;
              setAlarmType(next);
              const hit = catalog.find((c) => c.alarmType === next);
              if (hit) {
                setEventClass(hit.eventClass);
                setRaiseAlert(hit.raiseAlert);
                setEmitOn(hit.emitOn);
              }
            }}
          />
          <datalist id="event-type-catalog">
            {catalog.map((c) => (
              <option key={c.alarmType} value={c.alarmType}>
                {c.label}
              </option>
            ))}
          </datalist>
        </label>
        <label>
          Class
          <select value={eventClass} onChange={(e) => setEventClass(e.target.value as EventClass)}>
            {(Object.keys(EVENT_CLASS_LABELS) as EventClass[]).map((k) => (
              <option key={k} value={k}>
                {EVENT_CLASS_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Emit on
          <select value={emitOn} onChange={(e) => setEmitOn(e.target.value as EventEmitOn)}>
            <option value="event">Protocol event</option>
            <option value="change">Value change</option>
            <option value="rising">Rising edge</option>
            <option value="falling">Falling edge</option>
            <option value="none">Do not emit</option>
          </select>
        </label>
        <label className="fleet-dev-check">
          <input
            type="checkbox"
            checked={raiseAlert}
            onChange={(e) => setRaiseAlert(e.target.checked)}
          />
          Raise alert
        </label>
        <div className="span-2 admin-actions">
          <button type="submit" className="btn btn-primary" disabled={busy || saving}>
            Save class
          </button>
        </div>
      </form>
      {maps.length ? (
        <ul className="admin-field-list">
          {maps.map((m) => (
            <li key={m.id}>
              <span>
                <strong>{m.alarmType}</strong> · {EVENT_CLASS_LABELS[m.eventClass]} · emit {m.emitOn}
                {m.raiseAlert ? " · alert" : ""}
              </span>
              <button type="button" className="btn btn-ghost" onClick={() => void onDelete(m.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Using seeded defaults until you save an override.</p>
      )}
    </details>
  );
}
