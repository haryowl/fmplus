import { useRef, useState } from "react";
import { scanPayloadFor, type CatalogTargetKind } from "../lib/catalogCodes";
import { deskNfcWriteAvailable, writeDeskNfcTag } from "../lib/nfcWrite";

type Props = {
  kind: CatalogTargetKind;
  name: string;
  sku: string;
  disabled?: boolean;
  compact?: boolean;
};

export function CatalogNfcWriteButton({ kind, name, sku, disabled, compact }: Props) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const payload = scanPayloadFor(kind, sku);
  const canWrite = deskNfcWriteAvailable();

  function close() {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setStatus("");
    setOpen(false);
  }

  async function writeNow() {
    if (!payload || busy) return;
    setBusy(true);
    setStatus("Hold an NFC tag to this device…");
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await writeDeskNfcTag(payload, ac.signal);
      setStatus(`Wrote ${name || sku}`);
    } catch (err) {
      if (ac.signal.aborted) return;
      setStatus(err instanceof Error ? err.message : "Could not write the tag");
    } finally {
      if (!ac.signal.aborted) setBusy(false);
      abortRef.current = null;
    }
  }

  async function copyPayload() {
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload);
      setStatus("Payload copied");
    } catch {
      setStatus(payload);
    }
  }

  return (
    <>
      <button
        type="button"
        className={compact ? "catalog-v2-icon-btn" : "btn-ghost btn-compact"}
        disabled={disabled || !payload}
        title={payload ? "Write the same code onto an NFC tag" : "Add a SKU to write a tag"}
        aria-label="Write NFC"
        onClick={() => {
          setStatus("");
          setOpen(true);
        }}
      >
        {compact ? (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M5 8.5a7 7 0 0 1 10.6-1.2M5 12a4.5 4.5 0 0 1 6.8-.7M8.5 15.5h.01M16 8.2a8 8 0 0 1 0 7.6M19 5.5a12 12 0 0 1 0 13"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          "Write NFC"
        )}
      </button>
      {open ? (
        <div className="catalog-nfc-write-modal" role="dialog" aria-label="Write NFC tag">
          <div className="catalog-nfc-write-sheet">
            <p className="dispatch-eyebrow">Desk only</p>
            <h3>Write NFC</h3>
            <p className="muted">{name || sku}</p>
            <code className="catalog-nfc-write-payload">{payload}</code>
            {canWrite ? (
              <p className="muted">Chrome on Android. Hold a writable tag to this device, then tap Write tag.</p>
            ) : (
              <p className="muted">
                NFC write needs Chrome on Android (HTTPS). Copy the payload, or add the chip UID under Codes after a
                Field tap.
              </p>
            )}
            {status ? <p className="muted">{status}</p> : null}
            <div className="catalog-nfc-write-actions">
              {canWrite ? (
                <button type="button" className="btn" disabled={busy} onClick={() => void writeNow()}>
                  Write tag
                </button>
              ) : null}
              <button type="button" className="btn-secondary" onClick={() => void copyPayload()}>
                Copy payload
              </button>
              <button type="button" className="btn-ghost" onClick={close}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
