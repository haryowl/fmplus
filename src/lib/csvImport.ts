/** Client CSV helpers for Dispatch / Maintenance import. */

export type CsvRow = Record<string, string>;

export function normalizeHeader(h: string): string {
  return String(h || "")
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/, "")
    .replace(/[\s\-]+/g, "_")
    .replace(/_+/g, "_");
}

export function parseCsv(text: string): { headers: string[]; rows: CsvRow[] } {
  const raw = String(text || "").replace(/^\uFEFF/, "");
  if (!raw.trim()) return { headers: [], rows: [] };

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let inQuotes = false;

  while (i < raw.length) {
    const ch = raw[i];
    if (inQuotes) {
      if (ch === '"') {
        if (raw[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  row.push(cell);
  if (row.length > 1 || String(row[0] || "").trim() !== "") rows.push(row);

  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => normalizeHeader(h));
  const data: CsvRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const line = rows[r];
    if (!line.some((c) => String(c || "").trim())) continue;
    const obj: CsvRow = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      obj[key] = String(line[c] ?? "").trim();
    }
    data.push(obj);
  }
  return { headers, rows: data };
}

function esc(v: string | number | boolean | null | undefined): string {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], bodyRows: Array<Array<string | number | boolean | null | undefined>>): string {
  const lines = [headers.map(esc).join(",")];
  for (const row of bodyRows) lines.push(row.map(esc).join(","));
  return `${lines.join("\n")}\n`;
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export const DISPATCH_ORDER_CSV_HEADERS = [
  "customer_name",
  "lat",
  "lon",
  "address",
  "external_ref",
  "service_date",
  "zone",
  "volume_m3",
  "weight_kg",
  "window_start",
  "window_end",
  "service_minutes",
  "proof_required",
  "notes",
] as const;

export function dispatchOrderCsvTemplate(): string {
  return toCsv(
    [...DISPATCH_ORDER_CSV_HEADERS],
    [
      [
        "Toko Contoh",
        -6.9147,
        107.6098,
        "Jl. Asia Afrika, Bandung",
        "#ORD-1001",
        "2026-09-12",
        "Dago",
        2.5,
        120,
        "08:00",
        "12:00",
        8,
        "yes",
        "Gate A",
      ],
    ],
  );
}

export const MAINTENANCE_EVENT_CSV_HEADERS = [
  "title",
  "armada_user_id",
  "armada_username",
  "user_display_name",
  "notes",
  "odometer_km",
  "remind_due_at",
  "remind_interval_days",
  "remind_interval_km",
  "remind_interval_hours",
  "remind_before_days",
  "remind_before_km",
  "remind_before_hours",
  "assigned_username",
] as const;

export function maintenanceEventCsvTemplate(): string {
  return toCsv(
    [...MAINTENANCE_EVENT_CSV_HEADERS],
    [
      [
        "Service 10k",
        1903,
        "B9237BBF",
        "B 9237 BBF",
        "Oil + filter",
        10500,
        "2026-09-20",
        90,
        10000,
        "",
        7,
        500,
        "",
        "driver1",
      ],
    ],
  );
}
