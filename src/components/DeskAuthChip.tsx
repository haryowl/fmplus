import { useState, type FormEvent } from "react";
import { useDeskSession } from "../lib/deskSession";

export function DeskAuthChip() {
  const { user, ready, busy, error, setError, login, logout } = useDeskSession();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  if (!ready) return null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ok = await login(username.trim(), password);
    if (ok) {
      setOpen(false);
      setUsername("");
      setPassword("");
    }
  }

  if (user) {
    return (
      <div className="desk-auth-chip">
        <span className="desk-auth-who" title={user.username}>
          {user.displayName || user.username}
        </span>
        <button type="button" className="btn-ghost desk-auth-btn" disabled={busy} onClick={() => void logout()}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="desk-auth-chip">
      <button
        type="button"
        className="btn-ghost desk-auth-btn"
        disabled={busy}
        onClick={() => {
          setError("");
          setOpen((v) => !v);
        }}
      >
        Sign in
      </button>
      {open ? (
        <form className="desk-auth-pop" onSubmit={(e) => void onSubmit(e)}>
          <p className="desk-auth-pop-title">Desk sign in</p>
          <p className="muted desk-auth-pop-hint">Use a User or Field account for this tenant.</p>
          <label>
            Username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              disabled={busy}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              disabled={busy}
            />
          </label>
          {error ? <p className="desk-auth-error">{error}</p> : null}
          <div className="desk-auth-pop-actions">
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !username.trim() || !password}>
              Sign in
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
