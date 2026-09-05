import { useCallback, useEffect, useState, type FormEvent } from "react";

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

export default function FieldLogin() {
  const [user, setUser] = useState<FieldUser | null>(null);
  const [tenantKey, setTenantKey] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    return q.get("k") || "";
  });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refreshMe = useCallback(async () => {
    try {
      const me = await api<{ user: FieldUser }>("/api/field/me");
      setUser(me.user);
      return true;
    } catch {
      setUser(null);
      return false;
    }
  }, []);

  useEffect(() => {
    document.title = "Maintenance · FM Plus";
    void refreshMe();
  }, [refreshMe]);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data = await api<{ user: FieldUser }>("/api/field/login", {
        method: "POST",
        body: JSON.stringify({ tenantKey: tenantKey.trim(), username, password }),
      });
      setPassword("");
      setUser(data.user);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Logout failed");
    } finally {
      setBusy(false);
    }
  }

  if (user) {
    return (
      <div className="field-app">
        <div className="field-card">
          <h1>FM Plus Field</h1>
          <p className="muted">Maintenance / Dispatch (coming soon)</p>
          <p>
            Signed in as <strong>{user.displayName || user.username}</strong>
          </p>
          <p className="muted">
            Role: {user.role} · Tenant: {user.tenantKey} · App {user.appId}
          </p>
          {error && <p className="admin-error">{error}</p>}
          <button type="button" className="btn" disabled={busy} onClick={() => void handleLogout()}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="field-app">
      <form className="field-card" onSubmit={handleLogin}>
        <h1>FM Plus Field</h1>
        <p className="muted">Sign in for Maintenance or Dispatch mobile access.</p>
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
