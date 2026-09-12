import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  defaultEntitlements,
  FEATURE_LABELS,
  MODULE_LABELS,
  type Entitlements,
} from "../lib/entitlements";
import { BrandMark } from "../components/BrandMark";

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
  notifyEmails?: string;
  notifyWhatsapp?: string;
  wablasBaseUrl?: string;
  hasWablasToken?: boolean;
  hasWablasSecret?: boolean;
  notifierUrlTemplate: string;
  notifierUrlMaintenance?: string;
  updatedAt?: string;
};

type FieldUserRow = {
  id: string;
  username: string;
  role: string;
  displayName: string;
  phone?: string;
  email?: string;
  enabled: boolean;
};

type Draft = {
  key: string;
  appId: string;
  displayName: string;
  token: string;
  webhookSecret: string;
  userIds: string;
  groupIds: string;
  notifyEmails: string;
  notifyWhatsapp: string;
  wablasBaseUrl: string;
  wablasToken: string;
  wablasSecret: string;
  enabled: boolean;
  entitlements: Entitlements;
};

const FIELD_ROLE_OPTIONS = [
  { value: "operator", label: "Operator" },
  { value: "driver", label: "Driver" },
  { value: "dispatcher", label: "Dispatcher" },
  { value: "manager", label: "Manager" },
];

function emptyDraft(): Draft {
  return {
    key: "",
    appId: "36",
    displayName: "",
    token: "",
    webhookSecret: "",
    userIds: "",
    groupIds: "",
    notifyEmails: "",
    notifyWhatsapp: "",
    wablasBaseUrl: "https://wablas.com",
    wablasToken: "",
    wablasSecret: "",
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
    notifyEmails: t.notifyEmails || "",
    notifyWhatsapp: t.notifyWhatsapp || "",
    wablasBaseUrl: t.wablasBaseUrl || "https://wablas.com",
    wablasToken: "",
    wablasSecret: "",
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

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

function ToggleGrid({
  title,
  hint,
  labels,
  values,
  onChange,
}: {
  title: string;
  hint?: string;
  labels: Record<string, string>;
  values: Record<string, boolean>;
  onChange: (key: string, next: boolean) => void;
}) {
  return (
    <fieldset className="admin-fieldset">
      <legend>{title}</legend>
      {hint ? <p className="admin-section-hint muted">{hint}</p> : null}
      <div className="admin-toggle-grid">
        {Object.keys(labels).map((key) => {
          const on = values[key] === true;
          return (
            <label key={key} className={`admin-chip-toggle${on ? " is-on" : ""}`}>
              <input
                type="checkbox"
                checked={on}
                onChange={(e) => onChange(key, e.target.checked)}
              />
              <span>{labels[key] || key}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`admin-pill${ok ? " is-ok" : " is-off"}`}>{label}</span>;
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
  const [tenantQuery, setTenantQuery] = useState("");
  const [fieldUsers, setFieldUsers] = useState<FieldUserRow[]>([]);
  const [fuUsername, setFuUsername] = useState("");
  const [fuPassword, setFuPassword] = useState("");
  const [fuRole, setFuRole] = useState("operator");
  const [fuDisplayName, setFuDisplayName] = useState("");
  const [fuPhone, setFuPhone] = useState("");
  const [fuEmail, setFuEmail] = useState("");
  const [fuResetPass, setFuResetPass] = useState<Record<string, string>>({});

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

  const loadFieldUsers = useCallback(async (tenantId: string) => {
    const data = await api<{ users: FieldUserRow[] }>(`/api/admin/tenants/${tenantId}/field-users`);
    setFieldUsers(data.users);
  }, []);

  useEffect(() => {
    document.title = "Admin · ARMADA M.1";
    void refreshMe().then((ok) => {
      if (ok) void loadTenants().catch((err: Error) => setError(err.message));
    });
  }, [refreshMe, loadTenants]);

  useEffect(() => {
    if (!selectedId || selectedId === "new") {
      setFieldUsers([]);
      return;
    }
    void loadFieldUsers(selectedId).catch((err: Error) => setError(err.message));
  }, [selectedId, loadFieldUsers]);

  const filteredTenants = useMemo(() => {
    const q = tenantQuery.trim().toLowerCase();
    if (!q) return tenants;
    return tenants.filter(
      (t) =>
        t.key.toLowerCase().includes(q) ||
        (t.displayName || "").toLowerCase().includes(q) ||
        String(t.appId).includes(q),
    );
  }, [tenants, tenantQuery]);

  const stats = useMemo(() => {
    const enabled = tenants.filter((t) => t.enabled).length;
    const withNotify = tenants.filter(
      (t) => (t.notifyEmails || "").trim() || (t.notifyWhatsapp || "").trim(),
    ).length;
    const withWablas = tenants.filter((t) => t.hasWablasToken && t.hasWablasSecret).length;
    return { total: tenants.length, enabled, withNotify, withWablas };
  }, [tenants]);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
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
      await api("/api/admin/logout", { method: "POST" });
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
        notifyEmails: draft.notifyEmails.trim(),
        notifyWhatsapp: draft.notifyWhatsapp.trim(),
        wablasBaseUrl: draft.wablasBaseUrl.trim(),
        ...(draft.token.trim() ? { token: draft.token.trim() } : {}),
        ...(draft.webhookSecret.trim() ? { webhookSecret: draft.webhookSecret.trim() } : {}),
        ...(draft.wablasToken.trim() ? { wablasToken: draft.wablasToken.trim() } : {}),
        ...(draft.wablasSecret.trim() ? { wablasSecret: draft.wablasSecret.trim() } : {}),
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
        setNotice(`Saved ${updated.tenant.key}`);
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
    setBusy(true);
    setError("");
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

  async function createFieldUser(e: FormEvent) {
    e.preventDefault();
    if (!selectedId || selectedId === "new") return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`/api/admin/tenants/${selectedId}/field-users`, {
        method: "POST",
        body: JSON.stringify({
          username: fuUsername.trim(),
          password: fuPassword,
          role: fuRole,
          displayName: fuDisplayName.trim(),
          phone: fuPhone.trim(),
          email: fuEmail.trim(),
        }),
      });
      setFuUsername("");
      setFuPassword("");
      setFuDisplayName("");
      setFuPhone("");
      setFuEmail("");
      setFuRole("operator");
      setNotice("Field user created");
      await loadFieldUsers(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create field user failed");
    } finally {
      setBusy(false);
    }
  }

  async function patchFieldUser(userId: string, body: Record<string, unknown>) {
    if (!selectedId || selectedId === "new") return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/tenants/${selectedId}/field-users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setNotice("Field user updated");
      await loadFieldUsers(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function deleteFieldUser(userId: string, uname: string) {
    if (!selectedId || selectedId === "new") return;
    if (!window.confirm(`Delete field user “${uname}”?`)) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/tenants/${selectedId}/field-users/${userId}`, { method: "DELETE" });
      setNotice("Field user deleted");
      await loadFieldUsers(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  if (!username) {
    return (
      <div className="admin-app admin-app-login">
        <div className="admin-login-shell auth-login-shell">
          <div className="admin-login-brand auth-login-brand">
            <div className="auth-login-brand-top">
              <BrandMark size={28} />
              <p className="admin-kicker">ARMADA M.1</p>
            </div>
            <div className="auth-login-brand-copy">
              <h1>Control plane</h1>
              <p className="muted">
                Tenants, Armada tokens, entitlements, and notify channels — one place to run the
                embed.
              </p>
            </div>
            <ul className="auth-login-points" aria-hidden="true">
              <li>Tenant keys &amp; tokens</li>
              <li>Module entitlements</li>
              <li>Notify / WhatsApp channels</li>
            </ul>
          </div>
          <form className="admin-login auth-login-form" onSubmit={(e) => void handleLogin(e)}>
            <header className="auth-login-form-head">
              <h2>Sign in</h2>
              <p className="muted">Admin access for this ARMADA M.1 server</p>
            </header>
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
            <button type="submit" className="btn btn-primary auth-login-submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const selected = tenants.find((t) => t.id === selectedId);

  return (
    <div className="admin-app">
      <header className="admin-topbar">
        <div className="admin-brand">
          <BrandMark size={22} />
          <div>
            <p className="admin-kicker">ARMADA M.1</p>
            <h1>Admin</h1>
          </div>
        </div>
        <div className="admin-topbar-meta">
          <span className="admin-user-chip">{username}</span>
          <button type="button" className="btn-ghost" onClick={() => void handleLogout()} disabled={busy}>
            Sign out
          </button>
        </div>
      </header>

      <section className="admin-stats" aria-label="Tenant overview">
        <div className="admin-stat">
          <span className="admin-stat-label">Tenants</span>
          <strong>{stats.total}</strong>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-label">Enabled</span>
          <strong>{stats.enabled}</strong>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-label">Notify set</span>
          <strong>{stats.withNotify}</strong>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-label">Wablas ready</span>
          <strong>{stats.withWablas}</strong>
        </div>
      </section>

      {(error || notice) && (
        <div className="admin-banner">
          {error && <p className="admin-error">{error}</p>}
          {notice && <p className="admin-notice">{notice}</p>}
        </div>
      )}

      <div className="admin-layout">
        <aside className="admin-sidebar">
          <div className="admin-sidebar-head">
            <h2>Tenants</h2>
            <button type="button" className="btn btn-primary" onClick={selectNew}>
              New
            </button>
          </div>
          <label className="admin-search">
            <span className="visually-hidden">Search tenants</span>
            <input
              value={tenantQuery}
              onChange={(e) => setTenantQuery(e.target.value)}
              placeholder="Search key, name, app…"
            />
          </label>
          <ul className="admin-tenant-list">
            {filteredTenants.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className={selectedId === t.id ? "active" : ""}
                  onClick={() => selectTenant(t)}
                >
                  <span className="admin-tenant-row">
                    <strong>{t.displayName || t.key}</strong>
                    <span className={`admin-dot${t.enabled ? " is-on" : ""}`} title={t.enabled ? "Enabled" : "Disabled"} />
                  </span>
                  <span className="admin-tenant-meta">
                    <code>{t.key}</code> · app {t.appId}
                  </span>
                </button>
              </li>
            ))}
            {filteredTenants.length === 0 && (
              <li className="muted admin-empty">{tenants.length ? "No match." : "No database tenants yet."}</li>
            )}
          </ul>
        </aside>

        <main className="admin-main">
          {selectedId ? (
            <>
              <div className="admin-main-head">
                <div>
                  <p className="admin-kicker">{selectedId === "new" ? "Create" : "Edit tenant"}</p>
                  <h2>{selectedId === "new" ? "New tenant" : draft.displayName || draft.key}</h2>
                </div>
                {selected && (
                  <div className="admin-status-row">
                    <StatusPill ok={selected.enabled} label={selected.enabled ? "Enabled" : "Disabled"} />
                    <StatusPill ok={selected.hasToken} label={selected.hasToken ? "Token set" : "No token"} />
                    <StatusPill
                      ok={selected.hasWebhookSecret}
                      label={selected.hasWebhookSecret ? "Webhook set" : "No webhook"}
                    />
                    <StatusPill
                      ok={Boolean(selected.hasWablasToken && selected.hasWablasSecret)}
                      label={
                        selected.hasWablasToken && selected.hasWablasSecret ? "Wablas set" : "No Wablas"
                      }
                    />
                  </div>
                )}
              </div>

              <section className="admin-panel">
                <header className="admin-panel-head">
                  <h3>Identity</h3>
                  <p className="muted">Embed key and Armada application binding</p>
                </header>
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
                  <label className="admin-toggle admin-toggle-inline">
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                    />
                    <span>Tenant enabled</span>
                  </label>
                </div>
              </section>

              <section className="admin-panel">
                <header className="admin-panel-head">
                  <h3>Access & secrets</h3>
                  <p className="muted">Armada token, webhook, and fleet scope</p>
                </header>
                <div className="admin-form-grid">
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
                    Webhook secret {selectedId !== "new" ? "(leave blank to keep)" : ""}
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
              </section>

              <section className="admin-panel">
                <header className="admin-panel-head">
                  <h3>Notifications</h3>
                  <p className="muted">
                    Recipients for maintenance reminders. SMTP is set on the server (`.env.local`); Wablas
                    secrets are stored encrypted here.
                  </p>
                </header>
                <div className="admin-form-grid">
                  <label className="span-2">
                    Notify emails
                    <input
                      value={draft.notifyEmails}
                      onChange={(e) => setDraft({ ...draft, notifyEmails: e.target.value })}
                      placeholder="ops@company.com, manager@…"
                    />
                  </label>
                  <label className="span-2">
                    Notify WhatsApp numbers
                    <input
                      value={draft.notifyWhatsapp}
                      onChange={(e) => setDraft({ ...draft, notifyWhatsapp: e.target.value })}
                      placeholder="62812…, 62813…"
                    />
                  </label>
                  <label className="span-2">
                    Wablas API base URL
                    <input
                      value={draft.wablasBaseUrl}
                      onChange={(e) => setDraft({ ...draft, wablasBaseUrl: e.target.value })}
                      placeholder="https://wablas.com or https://pati.wablas.com"
                    />
                  </label>
                  <label>
                    Wablas token {selectedId !== "new" ? "(leave blank to keep)" : ""}
                    <input
                      type="password"
                      value={draft.wablasToken}
                      onChange={(e) => setDraft({ ...draft, wablasToken: e.target.value })}
                      autoComplete="off"
                      placeholder={selected?.hasWablasToken ? "•••••••• (set)" : ""}
                    />
                  </label>
                  <label>
                    Wablas secret key {selectedId !== "new" ? "(leave blank to keep)" : ""}
                    <input
                      type="password"
                      value={draft.wablasSecret}
                      onChange={(e) => setDraft({ ...draft, wablasSecret: e.target.value })}
                      autoComplete="off"
                      placeholder={selected?.hasWablasSecret ? "•••••••• (set)" : ""}
                    />
                  </label>
                </div>
              </section>

              <section className="admin-panel">
                <header className="admin-panel-head">
                  <h3>Entitlements</h3>
                  <p className="muted">What this tenant can see in the embed and mobile apps</p>
                </header>
                <ToggleGrid
                  title="Modules"
                  hint="Visible tabs in the embed"
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
                  labels={{
                    maintenance: "Field Maintenance PWA (/m)",
                    managerMaintenance: "Manager Maintenance PWA (/mm)",
                    dispatch: "Dispatch PWA",
                  }}
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
              </section>

              {selected && (
                <section className="admin-panel">
                  <header className="admin-panel-head">
                    <h3>Armada Command notifiers</h3>
                    <p className="muted">Paste into Armada Custom Server URLs (replace webhook secret)</p>
                  </header>
                  <div className="admin-notifier-list">
                    <div className="admin-notifier-row">
                      <div>
                        <span className="admin-stat-label">Exception</span>
                        <code>{selected.notifierUrlTemplate}</code>
                      </div>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() =>
                          void copyText(selected.notifierUrlTemplate).then(() =>
                            setNotice("Exception notifier URL copied"),
                          )
                        }
                      >
                        Copy
                      </button>
                    </div>
                    {selected.notifierUrlMaintenance && (
                      <div className="admin-notifier-row">
                        <div>
                          <span className="admin-stat-label">Maintenance</span>
                          <code>{selected.notifierUrlMaintenance}</code>
                        </div>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() =>
                            void copyText(selected.notifierUrlMaintenance || "").then(() =>
                              setNotice("Maintenance notifier URL copied"),
                            )
                          }
                        >
                          Copy
                        </button>
                      </div>
                    )}
                  </div>
                </section>
              )}

              <div className="admin-actions sticky">
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void saveDraft()}>
                  Save tenant
                </button>
                {selectedId !== "new" && (
                  <button type="button" className="btn-ghost" disabled={busy} onClick={() => void disableTenant()}>
                    Disable
                  </button>
                )}
              </div>

              {selectedId !== "new" && (
                <section className="admin-panel admin-field-users">
                  <header className="admin-panel-head">
                    <h3>Field users</h3>
                    <p className="muted">
                      Sign-in at <code>/m</code> or <code>/dispatch</code> — scoped to this tenant
                    </p>
                  </header>
                  <form className="admin-form-grid" onSubmit={(e) => void createFieldUser(e)}>
                    <label>
                      Username
                      <input value={fuUsername} onChange={(e) => setFuUsername(e.target.value)} required />
                    </label>
                    <label>
                      Password
                      <input
                        type="password"
                        value={fuPassword}
                        onChange={(e) => setFuPassword(e.target.value)}
                        required
                        minLength={6}
                        autoComplete="new-password"
                      />
                    </label>
                    <label>
                      Display name
                      <input value={fuDisplayName} onChange={(e) => setFuDisplayName(e.target.value)} />
                    </label>
                    <label>
                      Role
                      <select value={fuRole} onChange={(e) => setFuRole(e.target.value)}>
                        {FIELD_ROLE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Phone (WhatsApp)
                      <input
                        value={fuPhone}
                        onChange={(e) => setFuPhone(e.target.value)}
                        placeholder="62812…"
                      />
                    </label>
                    <label>
                      Email
                      <input
                        type="email"
                        value={fuEmail}
                        onChange={(e) => setFuEmail(e.target.value)}
                        placeholder="tech@…"
                      />
                    </label>
                    <div className="span-2 admin-actions">
                      <button type="submit" className="btn btn-primary" disabled={busy}>
                        Add field user
                      </button>
                    </div>
                  </form>

                  <ul className="admin-field-list">
                    {fieldUsers.map((u) => (
                      <li key={u.id}>
                        <div className="admin-field-identity">
                          <strong>{u.username}</strong>
                          <div className="admin-field-tags">
                            <span className="admin-pill is-muted">{u.role}</span>
                            {!u.enabled ? <span className="admin-pill is-off">disabled</span> : null}
                          </div>
                          <span className="muted">
                            {[u.displayName, u.phone, u.email].filter(Boolean).join(" · ") || "No contact set"}
                          </span>
                        </div>
                        <div className="admin-field-row-actions">
                          <select
                            value={u.role}
                            disabled={busy}
                            onChange={(e) => void patchFieldUser(u.id, { role: e.target.value })}
                          >
                            {FIELD_ROLE_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                          <input
                            type="password"
                            placeholder="New password"
                            value={fuResetPass[u.id] || ""}
                            onChange={(e) => setFuResetPass({ ...fuResetPass, [u.id]: e.target.value })}
                            autoComplete="new-password"
                          />
                          <button
                            type="button"
                            className="btn-ghost"
                            disabled={busy || !(fuResetPass[u.id] || "").trim()}
                            onClick={() => {
                              const password = (fuResetPass[u.id] || "").trim();
                              void patchFieldUser(u.id, { password }).then(() =>
                                setFuResetPass((prev) => {
                                  const next = { ...prev };
                                  delete next[u.id];
                                  return next;
                                }),
                              );
                            }}
                          >
                            Reset pw
                          </button>
                          <button
                            type="button"
                            className="btn-ghost"
                            disabled={busy}
                            onClick={() => void patchFieldUser(u.id, { enabled: !u.enabled })}
                          >
                            {u.enabled ? "Disable" : "Enable"}
                          </button>
                          <button
                            type="button"
                            className="btn-ghost"
                            disabled={busy}
                            onClick={() => void deleteFieldUser(u.id, u.username)}
                          >
                            Delete
                          </button>
                        </div>
                      </li>
                    ))}
                    {fieldUsers.length === 0 && <li className="muted admin-empty">No field users yet.</li>}
                  </ul>
                </section>
              )}
            </>
          ) : (
            <div className="admin-empty-state">
              <BrandMark size={36} />
              <h2>Select a tenant</h2>
              <p className="muted">Pick from the list or create a new embed tenant to manage tokens and notify channels.</p>
              <button type="button" className="btn btn-primary" onClick={selectNew}>
                Create tenant
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
