import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  defaultEntitlements,
  FEATURE_LABELS,
  MODULE_LABELS,
  type Entitlements,
} from "../lib/entitlements";

type AdminTenant = {
  id: string;
  key: string;
  appId: number;
  displayName: string;
  enabled: boolean;
  userIds: number[];
  groupIds: number[];
  entitlements: Entitlements;
  hasWebhookSecret: boolean;
  hasToken: boolean;
  notifierUrlTemplate: string;
  updatedAt?: string;
};

type Draft = {
  key: string;
  appId: string;
  displayName: string;
  token: string;
  webhookSecret: string;
  userIds: string;
  groupIds: string;
  enabled: boolean;
  entitlements: Entitlements;
};

function emptyDraft(): Draft {
  return {
    key: "",
    appId: "36",
    displayName: "",
    token: "",
    webhookSecret: "",
    userIds: "",
    groupIds: "",
    enabled: true,
    entitlements: defaultEntitlements(),
  };
}

function draftFromTenant(t: AdminTenant): Draft {
  return {
    key: t.key,
    appId: String(t.appId),
    displayName: t.displayName || "",
    token: "",
    webhookSecret: "",
    userIds: t.userIds.join(", "),
    groupIds: t.groupIds.join(", "),
    enabled: t.enabled,
    entitlements: t.entitlements,
  };
}

function parseIdList(text: string): number[] {
  return [
    ...new Set(
      text
        .split(/[,\s]+/)
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  ];
}

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

function ToggleGrid({
  title,
  labels,
  values,
  onChange,
}: {
  title: string;
  labels: Record<string, string>;
  values: Record<string, boolean>;
  onChange: (key: string, next: boolean) => void;
}) {
  return (
    <fieldset className="admin-fieldset">
      <legend>{title}</legend>
      <div className="admin-toggle-grid">
        {Object.keys(labels).map((key) => (
          <label key={key} className="admin-toggle">
            <input
              type="checkbox"
              checked={values[key] === true}
              onChange={(e) => onChange(key, e.target.checked)}
            />
            <span>{labels[key] || key}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function AdminConsole() {
  const [username, setUsername] = useState<string | null>(null);
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [tenants, setTenants] = useState<AdminTenant[]>([]);
  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const refreshMe = useCallback(async () => {
    try {
      const me = await api<{ username: string }>("/api/admin/me");
      setUsername(me.username);
      return true;
    } catch {
      setUsername(null);
      return false;
    }
  }, []);

  const loadTenants = useCallback(async () => {
    const data = await api<{ tenants: AdminTenant[] }>("/api/admin/tenants");
    setTenants(data.tenants);
  }, []);

  useEffect(() => {
    document.title = "Admin · FM Plus";
    void refreshMe().then((ok) => {
      if (ok) void loadTenants().catch((err: Error) => setError(err.message));
    });
  }, [refreshMe, loadTenants]);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ username: loginUser, password: loginPass }),
      });
      setLoginPass("");
      await refreshMe();
      await loadTenants();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    try {
      await api("/api/admin/logout", { method: "POST", body: "{}" });
      setUsername(null);
      setTenants([]);
      setSelectedId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Logout failed");
    } finally {
      setBusy(false);
    }
  }

  function selectNew() {
    setSelectedId("new");
    setDraft(emptyDraft());
    setNotice("");
    setError("");
  }

  function selectTenant(t: AdminTenant) {
    setSelectedId(t.id);
    setDraft(draftFromTenant(t));
    setNotice("");
    setError("");
  }

  async function saveDraft() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const payload = {
        key: draft.key.trim(),
        appId: Number(draft.appId),
        displayName: draft.displayName.trim(),
        userIds: parseIdList(draft.userIds),
        groupIds: parseIdList(draft.groupIds),
        enabled: draft.enabled,
        entitlements: draft.entitlements,
        ...(draft.token.trim() ? { token: draft.token.trim() } : {}),
        ...(draft.webhookSecret.trim() ? { webhookSecret: draft.webhookSecret.trim() } : {}),
      };
      if (selectedId === "new") {
        if (!payload.token) throw new Error("Armada token is required for new tenants");
        const created = await api<{ tenant: AdminTenant }>("/api/admin/tenants", {
          method: "POST",
          body: JSON.stringify({ ...payload, token: draft.token.trim(), webhookSecret: draft.webhookSecret.trim() }),
        });
        setNotice(`Created tenant ${created.tenant.key}`);
        await loadTenants();
        selectTenant(created.tenant);
      } else if (selectedId) {
        const updated = await api<{ tenant: AdminTenant }>(`/api/admin/tenants/${selectedId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        setNotice("Saved");
        setDraft(draftFromTenant(updated.tenant));
        await loadTenants();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function disableTenant() {
    if (!selectedId || selectedId === "new") return;
    if (!window.confirm("Disable this tenant? Embed k= will stop resolving from the database.")) return;
    setBusy(true);
    try {
      await api(`/api/admin/tenants/${selectedId}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      });
      setNotice("Tenant disabled");
      await loadTenants();
      setDraft((d) => ({ ...d, enabled: false }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disable failed");
    } finally {
      setBusy(false);
    }
  }

  if (!username) {
    return (
      <div className="admin-app">
        <form className="admin-login" onSubmit={handleLogin}>
          <h1>FM Plus Admin</h1>
          <p className="muted">Control plane for tenants, tokens, and embed entitlements.</p>
          {error && <p className="admin-error">{error}</p>}
          <label>
            Username
            <input value={loginUser} onChange={(e) => setLoginUser(e.target.value)} autoComplete="username" />
          </label>
          <label>
            Password
            <input
              type="password"
              value={loginPass}
              onChange={(e) => setLoginPass(e.target.value)}
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

  const selected = tenants.find((t) => t.id === selectedId);

  return (
    <div className="admin-app">
      <header className="admin-header">
        <div>
          <h1>FM Plus Admin</h1>
          <p className="muted">Signed in as {username}</p>
        </div>
        <button type="button" className="btn-ghost" onClick={() => void handleLogout()} disabled={busy}>
          Sign out
        </button>
      </header>

      {(error || notice) && (
        <div className="admin-banner">
          {error && <p className="admin-error">{error}</p>}
          {notice && <p className="admin-notice">{notice}</p>}
        </div>
      )}

      <div className="admin-layout">
        <aside className="admin-sidebar">
          <button type="button" className="btn" onClick={selectNew}>
            + New tenant
          </button>
          <ul className="admin-tenant-list">
            {tenants.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className={selectedId === t.id ? "active" : ""}
                  onClick={() => selectTenant(t)}
                >
                  <strong>{t.key}</strong>
                  <span>
                    app {t.appId}
                    {!t.enabled ? " · disabled" : ""}
                  </span>
                </button>
              </li>
            ))}
            {tenants.length === 0 && <li className="muted">No database tenants yet.</li>}
          </ul>
        </aside>

        <main className="admin-main">
          {selectedId ? (
            <>
              <h2>{selectedId === "new" ? "New tenant" : `Edit ${draft.key}`}</h2>
              <div className="admin-form-grid">
                <label>
                  Embed key (k=)
                  <input
                    value={draft.key}
                    onChange={(e) => setDraft({ ...draft, key: e.target.value })}
                    disabled={selectedId !== "new"}
                  />
                </label>
                <label>
                  App ID
                  <input
                    value={draft.appId}
                    onChange={(e) => setDraft({ ...draft, appId: e.target.value })}
                    inputMode="numeric"
                  />
                </label>
                <label>
                  Display name
                  <input
                    value={draft.displayName}
                    onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
                  />
                </label>
                <label className="admin-toggle">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                  />
                  <span>Enabled</span>
                </label>
                <label className="span-2">
                  Armada token {selectedId !== "new" ? "(leave blank to keep)" : ""}
                  <input
                    type="password"
                    value={draft.token}
                    onChange={(e) => setDraft({ ...draft, token: e.target.value })}
                    autoComplete="off"
                    placeholder={selected?.hasToken ? "•••••••• (set)" : ""}
                  />
                </label>
                <label className="span-2">
                  Webhook secret {selectedId !== "new" ? "(leave blank to keep / clear with space+save later)" : ""}
                  <input
                    type="password"
                    value={draft.webhookSecret}
                    onChange={(e) => setDraft({ ...draft, webhookSecret: e.target.value })}
                    autoComplete="off"
                    placeholder={selected?.hasWebhookSecret ? "•••••••• (set)" : ""}
                  />
                </label>
                <label>
                  Allowed user IDs
                  <input
                    value={draft.userIds}
                    onChange={(e) => setDraft({ ...draft, userIds: e.target.value })}
                    placeholder="empty = all"
                  />
                </label>
                <label>
                  Allowed group IDs
                  <input
                    value={draft.groupIds}
                    onChange={(e) => setDraft({ ...draft, groupIds: e.target.value })}
                    placeholder="empty = all"
                  />
                </label>
              </div>

              <ToggleGrid
                title="Modules visible in embed"
                labels={MODULE_LABELS}
                values={draft.entitlements.modules}
                onChange={(key, next) =>
                  setDraft({
                    ...draft,
                    entitlements: {
                      ...draft.entitlements,
                      modules: { ...draft.entitlements.modules, [key]: next },
                    },
                  })
                }
              />
              <ToggleGrid
                title="Features"
                labels={FEATURE_LABELS}
                values={draft.entitlements.features}
                onChange={(key, next) =>
                  setDraft({
                    ...draft,
                    entitlements: {
                      ...draft.entitlements,
                      features: { ...draft.entitlements.features, [key]: next },
                    },
                  })
                }
              />
              <ToggleGrid
                title="Mobile apps"
                labels={{ maintenance: "Maintenance PWA", dispatch: "Dispatch PWA" }}
                values={draft.entitlements.mobile}
                onChange={(key, next) =>
                  setDraft({
                    ...draft,
                    entitlements: {
                      ...draft.entitlements,
                      mobile: { ...draft.entitlements.mobile, [key]: next },
                    },
                  })
                }
              />

              {selected && (
                <p className="admin-notifier muted">
                  Notifier URL template: <code>{selected.notifierUrlTemplate}</code>
                </p>
              )}

              <div className="admin-actions">
                <button type="button" className="btn" disabled={busy} onClick={() => void saveDraft()}>
                  Save
                </button>
                {selectedId !== "new" && (
                  <button type="button" className="btn-ghost" disabled={busy} onClick={() => void disableTenant()}>
                    Disable
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="muted">Select a tenant or create a new one.</p>
          )}
        </main>
      </div>
    </div>
  );
}
