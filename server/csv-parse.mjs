/**
 * Minimal CSV parse/helpers for bulk import (no external deps).
 * Supports quoted fields, CRLF/LF, header row required.
 */

/** @param {string} text */
export function parseCsv(text) {
  const raw = String(text || "").replace(/^\uFEFF/, "");
  if (!raw.trim()) return { headers: [], rows: [] };

  const rows = [];
  let row = [];
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
  const data = [];
  for (let r = 1; r < rows.length; r++) {
    const line = rows[r];
    if (!line.some((c) => String(c || "").trim())) continue;
    /** @type {Record<string, string>} */
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      obj[key] = String(line[c] ?? "").trim();
    }
    data.push(obj);
  }
  return { headers, rows: data };
}

export function normalizeHeader(h) {
  return String(h || "")
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/, "")
    .replace(/[\s\-]+/g, "_")
    .replace(/_+/g, "_");
}

/** @param {unknown} v */
export function csvBool(v) {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "y";
}

/** @param {unknown} v */
export function csvNum(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** @param {string[]} headers @param {string[][]} bodyRows */
export function csvString(headers, bodyRows) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.map(esc).join(",")];
  for (const row of bodyRows) lines.push(row.map(esc).join(","));
  return `${lines.join("\n")}\n`;
}
