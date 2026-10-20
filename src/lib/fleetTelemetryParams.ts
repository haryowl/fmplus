import { tenantHeaders } from "./tenant";

export type TelemetryParamRow = {
  deviceId: string;
  imei?: string;
  label?: string;
  protocol?: string;
  paramId: string;
  paramLabel: string;
  category: string;
  value: string | number | boolean | null;
  source: string;
  updatedAt?: string | null;
};

export type TelemetryParamResponse = {
  rows: TelemetryParamRow[];
  recordedAt?: string | null;
};

/** Default Dashboard pin labels (ids match server FLEET_DISPLAY_PIN_IDS). */
export const FLEET_DISPLAY_PIN_LABELS: Record<string, string> = {
  fuel_level: "Fuel %",
  "can.fuel_l": "Fuel L",
  ext_voltage: "Ext V",
  "voltage.ext": "Ext V",
  battery_voltage: "Batt V",
  "voltage.batt": "Batt V",
  "pcb.temp": "PCB °C",
  "gps.valid": "GPS",
};

/** Preferred pin order / de-dupe aliases for Dashboard columns. */
export const FLEET_DASH_PIN_COLUMNS: Array<{ id: string; aliases?: string[]; label: string }> = [
  { id: "fuel_level", label: "Fuel %" },
  { id: "can.fuel_l", label: "Fuel L" },
  { id: "ext_voltage", aliases: ["voltage.ext"], label: "Ext V" },
  { id: "battery_voltage", aliases: ["voltage.batt"], label: "Batt V" },
  { id: "pcb.temp", label: "PCB °C" },
  { id: "gps.valid", label: "GPS" },
];

export function readDisplayPin(
  pins: Record<string, string | number | boolean> | null | undefined,
  column: { id: string; aliases?: string[] },
): string | number | boolean | null {
  if (!pins) return null;
  if (pins[column.id] != null) return pins[column.id];
  for (const a of column.aliases || []) {
    if (pins[a] != null) return pins[a];
  }
  return null;
}

export function formatDisplayPinValue(v: string | number | boolean | null): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") {
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  }
  return String(v);
}

async function parseJson(res: Response) {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

export async function fetchDeviceParamValues(
  deviceId: string,
  opts?: { raw?: boolean },
  signal?: AbortSignal,
): Promise<TelemetryParamRow[]> {
  const q = new URLSearchParams({ deviceId });
  if (opts?.raw) q.set("raw", "1");
  const res = await fetch(`/api/tracker/param-values?${q}`, {
    credentials: "include",
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(String(data.error || `Params ${res.status}`));
  return Array.isArray(data.rows) ? (data.rows as TelemetryParamRow[]) : [];
}

export async function fetchFixParamValues(
  opts: { deviceId: string; recordedAt: string; raw?: boolean },
  signal?: AbortSignal,
): Promise<TelemetryParamResponse> {
  const q = new URLSearchParams({
    deviceId: opts.deviceId,
    recordedAt: opts.recordedAt,
  });
  if (opts.raw) q.set("raw", "1");
  const res = await fetch(`/api/tracker/fix-params?${q}`, {
    credentials: "include",
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(String(data.error || `Fix params ${res.status}`));
  return {
    rows: Array.isArray(data.rows) ? (data.rows as TelemetryParamRow[]) : [],
    recordedAt: data.recordedAt ? String(data.recordedAt) : null,
  };
}
