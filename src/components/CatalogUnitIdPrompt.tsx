import { useState } from "react";
import { CatalogScanButton } from "./CatalogScanButton";

type Props = {
  itemName: string;
  allowCamera?: boolean;
  allowTyped?: boolean;
  allowNfc?: boolean;
  onSubmit: (serial: string, lot: string) => void;
  onCancel: () => void;
};

export function CatalogUnitIdPrompt({
  itemName,
  allowCamera = true,
  allowTyped = true,
  allowNfc = false,
  onSubmit,
  onCancel,
}: Props) {
  const [serial, setSerial] = useState("");
  const [lot, setLot] = useState("");

  return (
    <div className="catalog-unit-prompt-modal" role="dialog" aria-label="Enter serial">
      <form
        className="catalog-unit-prompt-sheet"
        onSubmit={(e) => {
          e.preventDefault();
          const unit = serial.trim();
          if (!unit) return;
          onSubmit(unit, lot.trim());
        }}
      >
        <p className="muted">This unit — {itemName}</p>
        <label>
          Serial
          <input
            value={serial}
            onChange={(e) => setSerial(e.target.value)}
            placeholder="Serial / UID"
            autoComplete="off"
            autoFocus
          />
        </label>
        <label>
          Lot
          <input value={lot} onChange={(e) => setLot(e.target.value)} placeholder="Optional" autoComplete="off" />
        </label>
        {allowCamera || allowTyped || allowNfc ? (
          <CatalogScanButton
            label="Scan serial"
            allowCamera={allowCamera}
            allowTyped={allowTyped}
            allowNfc={allowNfc}
            onCode={(code) => setSerial(code)}
          />
        ) : null}
        <div className="catalog-unit-prompt-actions">
          <button type="submit" className="btn" disabled={!serial.trim()}>
            Use serial
          </button>
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
