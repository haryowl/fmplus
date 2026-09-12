import { useId, useRef, useState } from "react";

export type CsvImportErrorRow = { line: number; error: string };
export type CsvImportSkippedRow = { line: number; reason: string };

type Props = {
  title?: string;
  hint: string;
  templateFilename: string;
  onDownloadTemplate: () => void;
  parseFile: (text: string) => { rows: Record<string, string>[]; error?: string };
  onImport: (rows: Record<string, string>[]) => Promise<{
    created: number;
    skipped?: number;
    errors?: number;
    errorRows?: CsvImportErrorRow[];
    skippedRows?: CsvImportSkippedRow[];
  }>;
  disabled?: boolean;
};

export function CsvImportPanel({
  title = "Import CSV",
  hint,
  templateFilename,
  onDownloadTemplate,
  parseFile,
  onImport,
  disabled,
}: Props) {
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [parseError, setParseError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");
  const [detailErrors, setDetailErrors] = useState<CsvImportErrorRow[]>([]);

  function reset() {
    setFileName("");
    setRows([]);
    setParseError("");
    setResult("");
    setDetailErrors([]);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onFileChange(file: File | null) {
    setResult("");
    setDetailErrors([]);
    if (!file) {
      reset();
      return;
    }
    setFileName(file.name);
    try {
      const text = await file.text();
      const parsed = parseFile(text);
      if (parsed.error) {
        setParseError(parsed.error);
        setRows([]);
        return;
      }
      setParseError("");
      setRows(parsed.rows);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Could not read file");
      setRows([]);
    }
  }

  async function handleImport() {
    if (!rows.length || busy || disabled) return;
    setBusy(true);
    setResult("");
    setDetailErrors([]);
    try {
      const out = await onImport(rows);
      const parts = [`Created ${out.created}`];
      if (out.skipped) parts.push(`skipped ${out.skipped}`);
      if (out.errors) parts.push(`errors ${out.errors}`);
      setResult(parts.join(" · "));
      setDetailErrors(out.errorRows || []);
      if (out.created > 0) {
        setRows([]);
        setFileName("");
        if (fileRef.current) fileRef.current.value = "";
      }
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="csv-import">
      <button
        type="button"
        className="btn-secondary"
        disabled={disabled}
        onClick={() => {
          setOpen((v) => !v);
          if (open) reset();
        }}
      >
        {open ? "Hide CSV import" : title}
      </button>
      {open ? (
        <div className="csv-import-panel">
          <p className="muted csv-import-hint">{hint}</p>
          <div className="csv-import-actions">
            <button type="button" className="btn-secondary" onClick={onDownloadTemplate}>
              Download template
            </button>
            <label className="csv-import-file btn-secondary" htmlFor={inputId}>
              Choose CSV
              <input
                id={inputId}
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                hidden
                disabled={busy || disabled}
                onChange={(e) => void onFileChange(e.target.files?.[0] || null)}
              />
            </label>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || disabled || rows.length === 0}
              onClick={() => void handleImport()}
            >
              {busy ? "Importing…" : `Import ${rows.length || ""}`.trim()}
            </button>
          </div>
          {fileName ? (
            <p className="muted csv-import-meta">
              {fileName}
              {rows.length ? ` · ${rows.length} row${rows.length === 1 ? "" : "s"}` : ""}
            </p>
          ) : null}
          {parseError ? (
            <p className="csv-import-error" role="alert">
              {parseError}
            </p>
          ) : null}
          {result ? <p className="csv-import-result">{result}</p> : null}
          {detailErrors.length ? (
            <ul className="csv-import-errors">
              {detailErrors.slice(0, 12).map((e) => (
                <li key={`${e.line}-${e.error}`}>
                  Line {e.line}: {e.error}
                </li>
              ))}
              {detailErrors.length > 12 ? <li>…and {detailErrors.length - 12} more</li> : null}
            </ul>
          ) : null}
          <p className="muted csv-import-template-name">Template: {templateFilename}</p>
        </div>
      ) : null}
    </div>
  );
}
