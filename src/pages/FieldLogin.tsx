import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import {
  eventVehicleLabel,
  SERVICE_STATUS_LABELS,
  type ServiceEvent,
  type ServiceEventStatus,
  type ServicePhoto,
} from "../lib/maintenance";

type FieldUser = {
  id: string;
  username: string;
  role: string;
  displayName: string;
  tenantKey: string;
  appId: number;
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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export default function FieldLogin() {
  const [user, setUser] = useState<FieldUser | null>(null);
  const [mobileMaintenance, setMobileMaintenance] = useState(false);
  const [tenantKey, setTenantKey] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    return q.get("k") || "";
  });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<ServiceEvent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ServiceEvent | null>(null);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [notes, setNotes] = useState("");

  const refreshMe = useCallback(async () => {
    try {
      const me = await api<{ user: FieldUser; mobileMaintenance?: boolean }>("/api/field/me");
      setUser(me.user);
      setMobileMaintenance(Boolean(me.mobileMaintenance));
      return true;
    } catch {
      setUser(null);
      setMobileMaintenance(false);
      return false;
    }
  }, []);

  const loadJobs = useCallback(async () => {
    if (!mobileMaintenance) {
      setJobs([]);
      return;
    }
    setLoadingJobs(true);
    setError("");
    try {
      const data = await api<{ events: ServiceEvent[] }>("/api/field/maintenance/events");
      setJobs(data.events || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load jobs");
      setJobs([]);
    } finally {
      setLoadingJobs(false);
    }
  }, [mobileMaintenance]);

  useEffect(() => {
    document.title = "Maintenance · FM Plus";
    void refreshMe();
  }, [refreshMe]);

  useEffect(() => {
    if (user && mobileMaintenance) void loadJobs();
  }, [user, mobileMaintenance, loadJobs]);

  useEffect(() => {
    if (!selectedId || !mobileMaintenance) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    void api<{ event: ServiceEvent }>(`/api/field/maintenance/events/${selectedId}`)
      .then((data) => {
        if (cancelled) return;
        setDetail(data.event);
        setNotes(data.event.notes || "");
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, mobileMaintenance]);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data = await api<{ user: FieldUser; mobileMaintenance?: boolean }>("/api/field/login", {
        method: "POST",
        body: JSON.stringify({ tenantKey: tenantKey.trim(), username, password }),
      });
      setPassword("");
      setUser(data.user);
      setMobileMaintenance(Boolean(data.mobileMaintenance));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    try {
      await api("/api/field/logout", { method: "POST", body: "{}" });
      setUser(null);
      setJobs([]);
      setSelectedId(null);
      setDetail(null);
      setMobileMaintenance(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Logout failed");
    } finally {
      setBusy(false);
    }
  }

  async function patchJob(status: ServiceEventStatus) {
    if (!selectedId) return;
    setBusy(true);
    setError("");
    try {
      const data = await api<{ event: ServiceEvent }>(`/api/field/maintenance/events/${selectedId}`, {
        method: "PATCH",
        body: JSON.stringify({ status, notes: notes.trim() }),
      });
      setDetail(data.event);
      if (status === "done" || status === "skipped") {
        setSelectedId(null);
        setDetail(null);
        await loadJobs();
      } else {
        setJobs((prev) => prev.map((j) => (j.id === data.event.id ? { ...j, ...data.event } : j)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !selectedId) return;
    setBusy(true);
    setError("");
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const data = await api<{ photo: ServicePhoto }>(
        `/api/field/maintenance/events/${selectedId}/photos`,
        {
          method: "POST",
          body: JSON.stringify({ dataUrl }),
        },
      );
      setDetail((prev) =>
        prev
          ? { ...prev, photos: [...(prev.photos || []), data.photo] }
          : prev,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  if (user) {
    return (
      <div className="field-app">
        <header className="field-top">
          <div>
            <h1>Maintenance jobs</h1>
            <p className="muted">
              {user.displayName || user.username} · {user.tenantKey}
            </p>
          </div>
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => void handleLogout()}>
            Sign out
          </button>
        </header>

        {error && <p className="admin-error field-error">{error}</p>}

        {!mobileMaintenance ? (
          <div className="field-card">
            <p>
              Signed in, but <strong>Maintenance PWA</strong> is off for this tenant. Ask an admin to enable{" "}
              <em>Mobile apps → Maintenance PWA</em>.
            </p>
          </div>
        ) : selectedId && detail ? (
          <div className="field-job-detail">
            <button type="button" className="btn-ghost" onClick={() => setSelectedId(null)}>
              ← Jobs
            </button>
            <h2>{detail.title}</h2>
            <p className="muted">
              {SERVICE_STATUS_LABELS[detail.status as ServiceEventStatus]} · {eventVehicleLabel(detail)}
              {detail.servicePointName ? ` · ${detail.servicePointName}` : ""}
            </p>
            {detail.servicePointLat != null && detail.servicePointLon != null ? (
              <p>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${detail.servicePointLat},${detail.servicePointLon}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open map pin
                </a>
              </p>
            ) : detail.lat != null && detail.lon != null ? (
              <p>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${detail.lat},${detail.lon}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Vehicle last fix
                </a>
              </p>
            ) : null}

            <label>
              Notes
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </label>

            <div className="field-photo-block">
              <h3>Proof photos</h3>
              <label className="btn field-photo-btn">
                Take / upload photo
                <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onPhoto(e)} />
              </label>
              <ul className="field-photo-grid">
                {(detail.photos || []).map((p) => (
                  <li key={p.id}>
                    <img src={p.url} alt={p.caption || "PoM"} />
                  </li>
                ))}
              </ul>
            </div>

            <div className="field-job-actions">
              {detail.status === "due" && (
                <button type="button" className="btn" disabled={busy} onClick={() => void patchJob("in_progress")}>
                  Start
                </button>
              )}
              <button type="button" className="btn" disabled={busy} onClick={() => void patchJob("done")}>
                Done
              </button>
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => void patchJob("skipped")}>
                Skip
              </button>
            </div>
          </div>
        ) : (
          <div className="field-jobs">
            <div className="field-jobs-toolbar">
              <button type="button" className="btn-ghost" disabled={loadingJobs} onClick={() => void loadJobs()}>
                Refresh
              </button>
            </div>
            {loadingJobs && <p className="muted">Loading…</p>}
            {!loadingJobs && jobs.length === 0 && (
              <div className="field-card">
                <p className="muted">No open maintenance jobs for you right now.</p>
              </div>
            )}
            <ul className="field-job-list">
              {jobs.map((job) => (
                <li key={job.id}>
                  <button type="button" className="field-job-row" onClick={() => setSelectedId(job.id)}>
                    <strong>{job.title}</strong>
                    <span className="muted">
                      {SERVICE_STATUS_LABELS[job.status]} · {eventVehicleLabel(job)}
                      {job.assignedFieldUserId ? " · assigned" : " · open"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="field-app">
      <form className="field-card" onSubmit={handleLogin}>
        <h1>FM Plus Field</h1>
        <p className="muted">Sign in for Maintenance jobs (/m).</p>
        {error && <p className="admin-error">{error}</p>}
        <label>
          Tenant key (k)
          <input value={tenantKey} onChange={(e) => setTenantKey(e.target.value)} autoComplete="organization" />
        </label>
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        <button type="submit" className="btn" disabled={busy}>
          Sign in
        </button>
      </form>
    </div>
  );
}
