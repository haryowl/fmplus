import { useState } from "react";
import {
  buildCatalogLabel,
  type CatalogLabelPreview,
  type CatalogTargetKind,
} from "../lib/catalogCodes";

type SheetProps = {
  preview: CatalogLabelPreview;
  onClose: () => void;
};

export function CatalogLabelPrintSheet({ preview, onClose }: SheetProps) {
  return (
    <div className="catalog-label-print-modal" role="dialog" aria-label="Print catalog label">
      <div className="catalog-label-print-sheet">
        <div className="catalog-label-print-body">
          <h3>{preview.label}</h3>
          <p className="catalog-label-print-sku">{preview.code}</p>
          <img className="catalog-label-print-qr" alt="QR code" src={preview.qrSrc} />
          <img className="catalog-label-print-bar" alt="Barcode" src={preview.barSrc} />
          <code className="catalog-label-print-payload">{preview.payload}</code>
        </div>
        <div className="catalog-label-print-actions no-print">
          <button type="button" className="btn" onClick={() => window.print()}>
            Print
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

type Props = {
  kind: CatalogTargetKind;
  name: string;
  sku: string;
  disabled?: boolean;
  className?: string;
  label?: string;
};

export function CatalogLabelPrintButton({
  kind,
  name,
  sku,
  disabled,
  className = "btn-ghost btn-compact",
  label = "Print QR / barcode",
}: Props) {
  const [open, setOpen] = useState(false);
  const preview = buildCatalogLabel(kind, name, sku);

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={disabled || !preview}
        title={preview ? "Print QR and barcode" : "Add a SKU to print"}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      {open && preview ? <CatalogLabelPrintSheet preview={preview} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
