import { useState, type FormEvent } from "react";
import {
  applyDispatchEmbedToUrl,
  saveDispatchEmbedSettings,
  type DispatchEmbedSettings,
} from "../lib/dispatchApp";
import { isTenantKey } from "../lib/tenant";

export function DispatchTenantSetup() {
  const [tenantKey, setTenantKey] = useState("");
  const [appId, setAppId] = useState("");
  const [userId, setUserId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [error, setError] = useState("");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const key = tenantKey.trim();
    if (!isTenantKey(key)) {
      setError("Enter a valid tenant key (same k= used on the desk Jobs URL).");
      return;
    }
    const settings: DispatchEmbedSettings = {
      tenantKey: key,
      appId: appId.trim() || undefined,
      userId: userId.trim() || undefined,
      groupId: groupId.trim() || undefined,
    };
    saveDispatchEmbedSettings(settings);
    applyDispatchEmbedToUrl(settings, "/jobs");
  }

  return (
    <div className="dispatch-app-setup">
      <div className="dispatch-app-setup-card">
        <p className="dispatch-eyebrow">ARMADA Dispatch</p>
        <h1>Connect this phone</h1>
        <p className="muted">
          Enter the desk embed tenant key (the <code>k=</code> value from the Jobs URL). It stays on this
          device only.
        </p>
        <form onSubmit={onSubmit} className="dispatch-app-setup-form">
          <label className="field">
            Tenant key
            <input
              value={tenantKey}
              onChange={(e) => setTenantKey(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              required
              placeholder="emb_…"
            />
          </label>
          <label className="field">
            App id (optional)
            <input
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              inputMode="numeric"
              placeholder="Usually left blank"
            />
          </label>
          <label className="field">
            User id filter (optional)
            <input
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              inputMode="numeric"
              placeholder="Embed userId="
            />
          </label>
          <label className="field">
            Group id filter (optional)
            <input
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              inputMode="numeric"
              placeholder="Embed groupId="
            />
          </label>
          {error ? <p className="dispatch-alert">{error}</p> : null}
          <button type="submit" className="btn btn-primary">
            Open Jobs
          </button>
        </form>
      </div>
    </div>
  );
}
