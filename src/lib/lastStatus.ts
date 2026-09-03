import { asNumber } from "./geo";
import { offsetToMinutes } from "./time";
import { colName, xmlEscape, zipStore } from "./xlsxZip";

export type LastStatusRow = {
  id: number;
  name: string;
  username: string;
  utc: string;
  deviceActivity: string;
  lastMs: number | null;
  lat: number | null;
  lon: number | null;
  altitude: number | null;
  heading: number | null;
  speedKmh: number | null;
  ignition: boolean | null;
  fuelLevel: number | null;
  odometerKm: number | null;
};

export type LastStatusSortId =
  | "name"
  | "lastMs"
  | "ignition"
  | "speedKmh"
  | "fuelLevel"
  | "odometerKm";

const PAGE_SIZE = 1000;

function asUtc(raw: Record<string, unknown>): string {
  const value = raw.utc ?? raw.uTC ?? raw.UTC ?? raw.deviceActivity;
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function asVariables(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  if (Array.isArray(raw)) {
    const out: Record<string, unknown> = {};
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const name = typeof row.name === "string" ? row.name : "";
      if (name) out[name] = row.value;
    }
    return out;
  }
  return raw as Record<string, unknown>;
}

function lookup(vars: Record<string, unknown>, names: string[]): unknown {
  const keys = Object.keys(vars);
  for (const want of names) {
    if (want in vars) return vars[want];
    const found = keys.find((key) => key.toLowerCase() === want.toLowerCase());
    if (found) return vars[found];
  }
  return undefined;
}

function asBool(value: unknown): boolean | null {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (s === "true" || s === "on" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "off" || s === "0" || s === "no") return false;
  }
  return null;
}

function parseMs(value: string): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function cleanCoord(lat: number | null, lon: number | null): { lat: number | null; lon: number | null } {
  if (lat === null || lon === null) return { lat: null, lon: null };
  if (Math.abs(lat) < 0.01 && Math.abs(lon) < 0.01) return { lat: null, lon: null };
  return { lat, lon };
}

function speedKmhFrom(vars: Record<string, unknown>, velocity: unknown): number | null {
  const fromVar = asNumber(lookup(vars, ["speed"]));
  if (fromVar !== null) return fromVar * 3.6;
  if (!velocity || typeof velocity !== "object" || Array.isArray(velocity)) return null;
  return asNumber((velocity as Record<string, unknown>).groundSpeed);
}

export function mapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lon}`)}`;
}

export function normalizeUserStatus(raw: unknown): LastStatusRow | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const id = Number(item.id ?? item.userId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const vars = asVariables(item.variables);
  const position =
    item.position && typeof item.position === "object" && !Array.isArray(item.position)
      ? (item.position as Record<string, unknown>)
      : {};
  const utc = asUtc(item);
  const deviceActivity = typeof item.deviceActivity === "string" ? item.deviceActivity.trim() : "";
  const utcMs = parseMs(utc);
  const activityMs = parseMs(deviceActivity);
  const lastMs =
    utcMs !== null && activityMs !== null
      ? Math.max(utcMs, activityMs)
      : utcMs ?? activityMs;
  const odoM = asNumber(lookup(vars, ["odometerAcc", "odometer"]));
  const coords = cleanCoord(asNumber(position.latitude), asNumber(position.longitude));

  return {
    id,
    name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : `User ${id}`,
    username: typeof item.username === "string" ? item.username : "",
    utc,
    deviceActivity,
    lastMs,
    lat: coords.lat,
    lon: coords.lon,
    altitude: asNumber(position.altitude),
    heading: asNumber(
      item.velocity && typeof item.velocity === "object" && !Array.isArray(item.velocity)
        ? (item.velocity as Record<string, unknown>).heading
        : undefined,
    ),
    speedKmh: speedKmhFrom(vars, item.velocity),
    ignition: asBool(lookup(vars, ["ignition"])),
    fuelLevel: asNumber(lookup(vars, ["fuel level", "fuelLevel", "FuelLevel"])),
    odometerKm: odoM === null ? null : odoM / 1000,
  };
}

export function unwrapStatusList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown[] }).items)) {
    return (raw as { items: unknown[] }).items;
  }
  return [];
}

export function normalizeUserStatusList(raw: unknown): LastStatusRow[] {
  const out: LastStatusRow[] = [];
  for (const item of unwrapStatusList(raw)) {
    const row = normalizeUserStatus(item);
    if (row) out.push(row);
  }
  return out;
}

export function filterStatusRows(rows: LastStatusRow[], userIds?: number[]): LastStatusRow[] {
  if (!userIds || userIds.length === 0) return rows;
  const allow = new Set(userIds);
  return rows.filter((row) => allow.has(row.id));
}

export function formatStatusTime(iso: string, offset: string): string {
  const ms = parseMs(iso);
  if (ms === null) return "—";
  const shifted = new Date(ms + offsetToMinutes(offset) * 60_000);
  return `${shifted.toISOString().replace("T", " ").slice(0, 19)} ${offset}`;
}

export function ageLabel(lastMs: number | null, now = Date.now()): string {
  if (lastMs === null) return "—";
  const diff = now - lastMs;
  if (!Number.isFinite(diff)) return "—";
  if (diff < 15_000) return "just now";
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr} h ago`;
  return `${Math.floor(hr / 24)} d ago`;
}

export function ageTone(lastMs: number | null, now = Date.now()): "live" | "recent" | "stale" | "" {
  if (lastMs === null) return "";
  const diff = now - lastMs;
  if (diff < 15 * 60_000) return "live";
  if (diff < 24 * 60 * 60_000) return "recent";
  return "stale";
}

export function sortStatusRows(
  rows: LastStatusRow[],
  sortId: LastStatusSortId,
  dir: "asc" | "desc",
): LastStatusRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[sortId];
    const bv = b[sortId];
    if (sortId === "name") {
      return sign * a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    }
    if (typeof av === "boolean" || typeof bv === "boolean") {
      const an = av === true ? 1 : av === false ? 0 : -1;
      const bn = bv === true ? 1 : bv === false ? 0 : -1;
      return sign * (an - bn) || a.name.localeCompare(b.name);
    }
    const an = typeof av === "number" ? av : null;
    const bn = typeof bv === "number" ? bv : null;
    if (an === null && bn === null) return a.name.localeCompare(b.name);
    if (an === null) return 1;
    if (bn === null) return -1;
    return sign * (an - bn) || a.name.localeCompare(b.name);
  });
}

export function statusExcelHeaders(): string[] {
  return [
    "Vehicle",
    "Id",
    "Last seen",
    "Age",
    "Ignition",
    "Speed km/h",
    "Heading",
    "Fuel",
    "Odometer km",
    "Latitude",
    "Longitude",
    "Map",
  ];
}

export function statusExcelRow(row: LastStatusRow, timezone: string, now = Date.now()): (string | number)[] {
  const map =
    row.lat !== null && row.lon !== null ? mapsUrl(row.lat, row.lon) : "";
  return [
    row.name,
    row.id,
    row.utc ? formatStatusTime(row.utc, timezone) : "",
    ageLabel(row.lastMs, now),
    row.ignition === null ? "" : row.ignition ? "On" : "Off",
    row.speedKmh === null ? "" : Math.round(row.speedKmh * 10) / 10,
    row.heading === null ? "" : Math.round(row.heading),
    row.fuelLevel === null ? "" : Math.round(row.fuelLevel * 10) / 10,
    row.odometerKm === null ? "" : Math.round(row.odometerKm * 10) / 10,
    row.lat === null ? "" : Math.round(row.lat * 1e6) / 1e6,
    row.lon === null ? "" : Math.round(row.lon * 1e6) / 1e6,
    map,
  ];
}

function sheetXml(rows: LastStatusRow[], timezone: string, now: number): string {
  const headers = statusExcelHeaders();
  const data = [headers, ...rows.map((row) => statusExcelRow(row, timezone, now))];
  const body = data
    .map((line, rowIdx) => {
      const r = rowIdx + 1;
      const cells = line
        .map((value, col) => {
          const ref = `${colName(col)}${r}`;
          if (typeof value === "number" && Number.isFinite(value)) {
            return `<c r="${ref}"><v>${value}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(String(value))}</t></is></c>`;
        })
        .join("");
      return `<row r="${r}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

export function statusXlsx(rows: LastStatusRow[], timezone: string, now = Date.now()): Uint8Array {
  const utf8 = new TextEncoder();
  return zipStore([
    {
      name: "[Content_Types].xml",
      data: utf8.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`),
    },
    {
      name: "_rels/.rels",
      data: utf8.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    },
    {
      name: "xl/workbook.xml",
      data: utf8.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Last status" sheetId="1" r:id="rId1"/></sheets>
</workbook>`),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: utf8.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`),
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data: utf8.encode(sheetXml(rows, timezone, now)),
    },
  ]);
}

export function downloadStatusExcel(rows: LastStatusRow[], timezone: string): void {
  const bytes = statusXlsx(rows, timezone);
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = `last-status-${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(href);
}

export const STATUS_PAGE_SIZE = PAGE_SIZE;
