export type AppView = "full" | "compact" | "fleet" | "fleetCompact";

export function viewFromPath(pathname: string): AppView {
  const parts = (pathname.replace(/\/+$/, "") || "/").split("/").filter(Boolean);
  const leaf = parts[0] ?? "";
  const next = parts[1] ?? "";
  if (leaf === "fleet" && (next === "compact" || next === "compact.html")) return "fleetCompact";
  if (leaf === "fleet" || leaf === "fleet.html") return "fleet";
  if (leaf === "compact" || leaf === "compact.html") return "compact";
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
