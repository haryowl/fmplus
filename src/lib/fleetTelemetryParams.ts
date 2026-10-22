import { formatAvlParamValue } from "./avlIoEnums";
import { tenantHeaders } from "./tenant";

export type TelemetryParamRow = {
  deviceId: string;
  imei?: string;
  label?: string;
  protocol?: string;
  paramId: string;
  paramLabel: string;
  category: string;
  unit?: string;
  value: string | number | boolean | null;
  source: string;
  updatedAt?: string | null;
};

export type TelemetryParamResponse = {
  rows: TelemetryParamRow[];
  recordedAt?: string | null;
};

export type DisplayPinColumn = { id: string; aliases?: string[]; label: string };

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

/** Built-in pin order when tenant has no Admin override (one id per alias family). */
export const FLEET_DISPLAY_PIN_IDS = [
  "fuel_level",
  "can.fuel_l",
  "ext_voltage",
  "battery_voltage",
  "pcb.temp",
  "gps.valid",
];

const PIN_ALIASES: Record<string, string[]> = {
  ext_voltage: ["voltage.ext"],
  "voltage.ext": ["ext_voltage"],
  battery_voltage: ["voltage.batt"],
  "voltage.batt": ["battery_voltage"],
};

/** Keep the first id of each alias family (lookup still uses PIN_ALIASES). */
export function uniqueDisplayPinIds(pinIds: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of pinIds) {
    const id = String(raw || "").trim();
    if (!id || seen.has(id)) continue;
    const aliases = PIN_ALIASES[id] || [];
    if (aliases.some((a) => seen.has(a))) continue;
    seen.add(id);
    for (const a of aliases) seen.add(a);
    out.push(id);
  }
  return out;
}

/** Preferred pin order / de-dupe aliases for Dashboard columns (defaults). */
export const FLEET_DASH_PIN_COLUMNS: DisplayPinColumn[] = uniqueDisplayPinIds(
  FLEET_DISPLAY_PIN_IDS,
).map((id) => ({
  id,
  aliases: PIN_ALIASES[id],
  label: FLEET_DISPLAY_PIN_LABELS[id] || id,
}));

const FUEL_PIN_IDS = new Set(["fuel_level", "can.fuel_l"]);

function humanizePinId(id: string): string {
  const known = FLEET_DISPLAY_PIN_LABELS[id];
  if (known) return known;
  const leaf = id.includes(".") ? id.slice(id.lastIndexOf(".") + 1) : id;
  return leaf
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Build columns from tenant/last-status pin ids (falls back to defaults). */
export function buildDisplayPinColumns(
  pinIds?: string[] | null,
  labels?: Record<string, string> | null,
): DisplayPinColumn[] {
  const ids = uniqueDisplayPinIds(
    Array.isArray(pinIds) && pinIds.length > 0 ? pinIds : FLEET_DISPLAY_PIN_IDS,
  );
  return ids.map((id) => ({
    id,
    aliases: PIN_ALIASES[id],
    label: (labels && labels[id]) || humanizePinId(id),
  }));
}

/** Extra mapper pins shown beside dedicated Fuel/Odo columns. */
export function extraDisplayPinColumns(
  pinIds?: string[] | null,
  labels?: Record<string, string> | null,
): DisplayPinColumn[] {
  return buildDisplayPinColumns(pinIds, labels).filter((c) => !FUEL_PIN_IDS.has(c.id));
}

/** Effective pin ids for Admin checkbox UI (blank text = defaults). */
export function effectiveDisplayPinIds(text: string): string[] {
  const parsed = parseDisplayPinIdsText(text);
  return parsed == null ? FLEET_DISPLAY_PIN_IDS.slice() : parsed;
}

/** Toggle one pin id in Admin free-text (seeds from defaults when blank). */
export function toggleDisplayPinIdText(text: string, pinId: string): string {
  const current = effectiveDisplayPinIds(text);
  const has = current.includes(pinId);
  const next = has ? current.filter((id) => id !== pinId) : [...current, pinId];
  return next.join(", ");
}

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

export function formatDisplayPinValue(
  v: string | number | boolean | null,
  paramId?: string,
): string {
  if (v == null) return "—";
  const decoded = paramId ? formatAvlParamValue(paramId, v) : v;
  if (typeof decoded === "boolean") return decoded ? "yes" : "no";
  if (typeof decoded === "number") {
    return Number.isInteger(decoded) ? String(decoded) : String(Math.round(decoded * 100) / 100);
  }
  return String(decoded);
}

/** Parse Admin textarea (comma / whitespace / newline separated). Blank → null (defaults). */
export function parseDisplayPinIdsText(text: string): string[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const parts = trimmed
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : null;
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
