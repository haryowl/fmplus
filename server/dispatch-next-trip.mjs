/**
 * Next-trip title after a completed (or still-open) job for the same driver.
 * "West loop" → "West loop · trip 2"; "West loop · trip 2" → "West loop · trip 3".
 */
export function nextDispatchTripTitle(title) {
  const raw = String(title || "Dispatch job").trim() || "Dispatch job";
  const m = raw.match(/^(.*?)(?:\s*·\s*)?trip\s+(\d+)\s*$/i);
  if (m) {
    const base = m[1].replace(/\s*·\s*$/, "").trim() || "Dispatch job";
    return `${base} · trip ${Number(m[2]) + 1}`;
  }
  return `${raw} · trip 2`;
}

export function jobIsClosed(status) {
  const s = String(status || "").toLowerCase();
  return s === "done" || s === "cancelled";
}
