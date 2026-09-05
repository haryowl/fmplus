import { colName, xmlEscape, zipStore } from "./xlsxZip";

export type ExcelCell = string | number | boolean | null | undefined;

function cellXml(value: ExcelCell, ref: string): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  if (typeof value === "boolean") {
    return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  const text = value == null ? "" : String(value);
  return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(text)}</t></is></c>`;
}

function sheetXml(rows: ExcelCell[][]): string {
  const body = rows
    .map((line, rowIdx) => {
      const r = rowIdx + 1;
      const cells = line.map((value, col) => cellXml(value, `${colName(col)}${r}`)).join("");
      return `<row r="${r}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

/** Excel sheet names: max 31 chars, no \\ / ? * [ ]. */
export function sanitizeSheetName(name: string): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || "Sheet1").slice(0, 31);
}

export function excelFilename(prefix: string): string {
  const safe = prefix.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "export";
  return `${safe}-${new Date().toISOString().slice(0, 10)}.xlsx`;
}

export function buildXlsx(sheetName: string, rows: ExcelCell[][]): Uint8Array {
  const utf8 = new TextEncoder();
  const name = sanitizeSheetName(sheetName);
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
<sheets><sheet name="${xmlEscape(name)}" sheetId="1" r:id="rId1"/></sheets>
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
      data: utf8.encode(sheetXml(rows)),
    },
  ]);
}

export function downloadXlsx(filename: string, sheetName: string, rows: ExcelCell[][]): void {
  const bytes = buildXlsx(sheetName, rows);
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  a.click();
  URL.revokeObjectURL(href);
}

export function pairsToSheet(pairs: Array<[string, ExcelCell]>): ExcelCell[][] {
  return [["Metric", "Value"], ...pairs];
}
