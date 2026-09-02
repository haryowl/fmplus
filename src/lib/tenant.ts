import { API_PREFIX, DEFAULT_APP_ID } from "./config";

export const TENANT_HEADER = "X-Fms-Tenant";
const KEY_RE = /^[A-Za-z0-9._-]{8,80}$/;

let tenantKey = "";
let appId = DEFAULT_APP_ID;

export function isTenantKey(value: string): boolean {
  return KEY_RE.test(value);
}

export function configureTenant(key: string, nextAppId: number) {
  tenantKey = isTenantKey(key) ? key : "";
  if (Number.isInteger(nextAppId) && nextAppId > 0) appId = nextAppId;
}

export function currentTenantKey(): string {
  return tenantKey;
}

export function currentAppId(): number {
  return appId;
}

export function apiBase(): string {
  const override = import.meta.env.VITE_ARMADA_API_BASE;
  if (override && !tenantKey) return override;
  return `${API_PREFIX}/${appId}`;
}

export function tenantHeaders(): Record<string, string> {
  return tenantKey ? { [TENANT_HEADER]: tenantKey } : {};
}

export type EmbedContext = {
  appId: number;
  userIds: number[];
  groupIds: number[];
};

export async function fetchEmbedContext(signal?: AbortSignal): Promise<EmbedContext | null> {
  const res = await fetch("/api/embed-context", {
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Embed context ${res.status}`);
  const raw = (await res.json()) as Partial<EmbedContext>;
  const nextApp = Number(raw.appId);
  const userIds = Array.isArray(raw.userIds) ? raw.userIds.map(Number).filter((id) => id > 0) : [];
  const groupIds = Array.isArray(raw.groupIds) ? raw.groupIds.map(Number).filter((id) => id > 0) : [];
  if (!Number.isInteger(nextApp) || nextApp < 1) return null;
  configureTenant(tenantKey, nextApp);
  return { appId: nextApp, userIds, groupIds };
}

export function bootTenantFromSearch(search: string) {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const key = params.get("k") ?? "";
  const id = Number(params.get("appId") || DEFAULT_APP_ID);
  configureTenant(key, Number.isInteger(id) && id > 0 ? id : DEFAULT_APP_ID);
}
