/** Day-month-year stamp used in default job titles and order numbers. */
export function dateStampDDMMYYYY(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) return "";
  return `${match[3]}${match[2]}${match[1]}`;
}

/**
 * Next code for a day, e.g. ORD-04102026-03.
 * Existing values that do not use this prefix are ignored.
 */
export function nextDatedCode(prefix: string, isoDate: string, existing: string[]): string {
  const stamp = dateStampDDMMYYYY(isoDate);
  const head = stamp ? `${prefix}-${stamp}-` : `${prefix}-`;
  const re = new RegExp(`^${prefix}-${stamp}-(\\d+)$`, "i");
  let max = 0;
  for (const value of existing) {
    const hit = re.exec(String(value || "").trim());
    if (!hit) continue;
    const n = Number(hit[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${head}${String(max + 1).padStart(2, "0")}`;
}
