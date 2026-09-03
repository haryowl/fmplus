import { printDashboard } from "../lib/printDashboard";

type Props = {
  disabled?: boolean;
};

export function ExportPdfButton({ disabled }: Props) {
  return (
    <button
      className="btn-ghost no-print"
      type="button"
      disabled={disabled}
      onClick={() => printDashboard()}
    >
      Export PDF
    </button>
  );
}
