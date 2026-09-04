export type AppView = "full" | "compact" | "fleet" | "fleetCompact" | "status" | "trips";

export function viewFromPath(pathname: string): AppView {
  const parts = (pathname.replace(/\/+$/, "") || "/").split("/").filter(Boolean);
  const leaf = parts[0] ?? "";
  const next = parts[1] ?? "";
  if (leaf === "fleet" && (next === "compact" || next === "compact.html")) return "fleetCompact";
  if (leaf === "fleet" || leaf === "fleet.html") return "fleet";
  if (leaf === "compact" || leaf === "compact.html") return "compact";
  if (leaf === "status" || leaf === "status.html") return "status";
  if (leaf === "trips" || leaf === "trips.html") return "trips";
  return "full";
}

/** True for the single-vehicle compact page only (`/fleet/compact` is not this). */
export function isCompactPath(pathname: string): boolean {
  return viewFromPath(pathname) === "compact";
}

export function withSearch(path: string, search = ""): string {
  return `${path}${search}`;
}

export function compactHref(search: string): string {
  return withSearch("/compact", search);
}

export function fullHref(search: string): string {
  return withSearch("/", search);
}

export function fleetHref(search: string): string {
  return withSearch("/fleet", search);
}

export function fleetCompactHref(search: string): string {
  return withSearch("/fleet/compact", search);
}

export function statusHref(search: string): string {
  return withSearch("/status", search);
}

export function tripsHref(search: string): string {
  return withSearch("/trips", search);
}

export const VIEW_CHANGE = "fms-embed:view";

/** Same-document tab switch so GPS day cache survives. */
export function navigateView(href: string) {
  const url = new URL(href, window.location.href);
  const next = `${url.pathname}${url.search}`;
  const current = `${window.location.pathname}${window.location.search}`;
  if (next === current) return;
  window.history.pushState(null, "", next);
  window.dispatchEvent(new Event(VIEW_CHANGE));
}

export function writeLocationSearch(patch: Record<string, string | null | undefined>) {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(patch)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const next = `${window.location.pathname}?${params.toString()}`;
  const current = `${window.location.pathname}${window.location.search}`;
  if (next !== current) window.history.replaceState(null, "", next);
}
