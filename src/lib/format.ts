export function formatKm(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function formatHours(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatLiters(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function formatKmPerL(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function formatIdr(n: number): string {
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

export function formatPct(n: number): string {
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export function formatInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function formatSpeed(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function formatRpm(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function formatMeters(n: number): string {
  return `${Math.round(n).toLocaleString("en-US")} m`;
}

export function odoGpsDelta(odometerKm: number, ignitionKm: number): string {
  if (ignitionKm <= 0) return "—";
  const pct = ((odometerKm - ignitionKm) / ignitionKm) * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}
