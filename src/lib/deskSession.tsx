import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { emptyDeskPrivileges, mergeDeskPrivileges, type DeskPrivileges } from "./deskPrivileges";
import { currentTenantKey } from "./tenant";

export type DeskUser = {
  id: string;
  username: string;
  role: string;
  displayName: string;
  tenantKey: string;
  privileges: DeskPrivileges;
};

type DeskMeResponse = {
  user: {
    id: string;
    username: string;
    role: string;
    displayName?: string;
    tenantKey?: string;
    privileges?: unknown;
  };
};

type DeskSessionValue = {
  user: DeskUser | null;
  ready: boolean;
  busy: boolean;
  error: string;
  setError: (msg: string) => void;
  privileges: DeskPrivileges;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const DeskSessionContext = createContext<DeskSessionValue | null>(null);

function mapUser(raw: DeskMeResponse["user"]): DeskUser | null {
  const tenantKey = String(raw.tenantKey || "").trim();
  if (!raw.id || !tenantKey) return null;
  return {
    id: String(raw.id),
    username: String(raw.username || ""),
    role: String(raw.role || ""),
    displayName: String(raw.displayName || raw.username || ""),
    tenantKey,
    privileges: mergeDeskPrivileges(raw.privileges),
  };
}

export function DeskSessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<DeskUser | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const clearIfWrongTenant = useCallback((next: DeskUser | null) => {
    const embedKey = currentTenantKey();
    if (!next) return null;
    if (embedKey && next.tenantKey !== embedKey) return null;
    return next;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/field/me", {
        headers: { accept: "application/json" },
        credentials: "include",
      });
      if (!res.ok) {
        setUser(null);
        return;
      }
      const body = (await res.json()) as DeskMeResponse;
      setUser(clearIfWrongTenant(mapUser(body.user)));
    } catch {
      setUser(null);
    } finally {
      setReady(true);
    }
  }, [clearIfWrongTenant]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (username: string, password: string) => {
      const tenantKey = currentTenantKey();
      if (!tenantKey) {
        setError("Embed tenant key (k=) is required before signing in");
        return false;
      }
      setBusy(true);
      setError("");
      try {
        const res = await fetch("/api/field/login", {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ tenantKey, username, password }),
        });
        const body = (await res.json().catch(() => ({}))) as DeskMeResponse & { error?: string };
        if (!res.ok) {
          setError(body.error || `Sign in failed (${res.status})`);
          setUser(null);
          return false;
        }
        const next = clearIfWrongTenant(mapUser(body.user));
        if (!next) {
          setError("Signed-in user does not match this embed tenant");
          setUser(null);
          return false;
        }
        setUser(next);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Sign in failed");
        setUser(null);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [clearIfWrongTenant],
  );

  const logout = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      await fetch("/api/field/logout", {
        method: "POST",
        headers: { accept: "application/json" },
        credentials: "include",
      });
    } catch {
      /* ignore */
    } finally {
      setUser(null);
      setBusy(false);
    }
  }, []);

  const value = useMemo<DeskSessionValue>(
    () => ({
      user,
      ready,
      busy,
      error,
      setError,
      privileges: user?.privileges ?? emptyDeskPrivileges(),
      login,
      logout,
      refresh,
    }),
    [user, ready, busy, error, login, logout, refresh],
  );

  return <DeskSessionContext.Provider value={value}>{children}</DeskSessionContext.Provider>;
}

export function useDeskSession(): DeskSessionValue {
  const ctx = useContext(DeskSessionContext);
  if (!ctx) {
    throw new Error("useDeskSession requires DeskSessionProvider");
  }
  return ctx;
}
