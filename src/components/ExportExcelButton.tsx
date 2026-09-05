import { downloadXlsx, excelFilename, type ExcelCell } from "../lib/xlsxDownload";

type Props = {
  disabled?: boolean;
  /** File name prefix; date suffix is added automatically. */
  prefix: string;
  sheetName: string;
  getRows: () => ExcelCell[][];
  label?: string;
};

export function ExportExcelButton({ disabled, prefix, sheetName, getRows, label = "Export Excel" }: Props) {
  return (
    <button
      className="btn btn-secondary no-print"
      type="button"
      disabled={disabled}
      onClick={() => downloadXlsx(excelFilename(prefix), sheetName, getRows())}
    >
      {label}
    </button>
  );
}
