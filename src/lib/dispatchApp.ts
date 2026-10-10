import { isTenantKey } from "./tenant";
import { isNativeDispatchApp } from "./nativeField";

const STORAGE_KEY = "fmplus.dispatch.embed";

export type DispatchEmbedSettings = {
  tenantKey: string;
  appId?: string;
  userId?: string;
  groupId?: string;
};

export function readDispatchEmbedSettings(): DispatchEmbedSettings | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DispatchEmbedSettings>;
    const tenantKey = String(parsed.tenantKey || "").trim();
    if (!isTenantKey(tenantKey)) return null;
    return {
      tenantKey,
      appId: String(parsed.appId || "").trim() || undefined,
      userId: String(parsed.userId || "").trim() || undefined,
      groupId: String(parsed.groupId || "").trim() || undefined,
    };
  } catch {
    return null;
  }
}

export function saveDispatchEmbedSettings(settings: DispatchEmbedSettings): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      tenantKey: settings.tenantKey.trim(),
      appId: settings.appId?.trim() || undefined,
      userId: settings.userId?.trim() || undefined,
      groupId: settings.groupId?.trim() || undefined,
    }),
  );
}

export function clearDispatchEmbedSettings(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

/** Merge stored desk embed params into the URL when the Dispatch APK opens without k=. */
export function bootDispatchAppSearch(): boolean {
  if (typeof window === "undefined" || !isNativeDispatchApp()) return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("k")) return Boolean(params.get("k"));
  const stored = readDispatchEmbedSettings();
  if (!stored) return false;
  params.set("k", stored.tenantKey);
  if (stored.appId) params.set("appId", stored.appId);
  if (stored.userId) params.set("userId", stored.userId);
  if (stored.groupId) params.set("groupId", stored.groupId);
  const next = `${window.location.pathname}?${params.toString()}${window.location.hash || ""}`;
  window.history.replaceState(window.history.state, "", next);
  return true;
}

export function dispatchAppNeedsSetup(): boolean {
  if (!isNativeDispatchApp()) return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("k") && isTenantKey(params.get("k") || "")) return false;
  return !readDispatchEmbedSettings();
}

export function applyDispatchEmbedToUrl(settings: DispatchEmbedSettings, path = "/jobs"): void {
  const params = new URLSearchParams();
  params.set("k", settings.tenantKey.trim());
  if (settings.appId?.trim()) params.set("appId", settings.appId.trim());
  if (settings.userId?.trim()) params.set("userId", settings.userId.trim());
  if (settings.groupId?.trim()) params.set("groupId", settings.groupId.trim());
  window.location.assign(`${path}?${params.toString()}`);
}
