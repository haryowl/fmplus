import { useEffect, useRef, useState } from "react";
import { barcodeDetectorAvailable, detectBarcodeFromVideo } from "../lib/catalogScan";
import { scanButtonLabel, scanSheetHint, startNfcScan } from "../lib/nfcScan";

type Props = {
  disabled?: boolean;
  label?: string;
  onCode: (code: string) => void;
  allowCamera?: boolean;
  allowTyped?: boolean;
  allowNfc?: boolean;
};

export function CatalogScanButton({
  disabled,
  label = "Scan",
  onCode,
  allowCamera = true,
  allowTyped = true,
  allowNfc = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [hint, setHint] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  const cameraReady = allowCamera && barcodeDetectorAvailable();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setHint(scanSheetHint({ cameraReady, typed: allowTyped, nfcReady: false }));

    async function start() {
      if (!cameraReady || !navigator.mediaDevices?.getUserMedia) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
      } catch {
        setHint(scanSheetHint({ cameraReady: false, typed: allowTyped, nfcReady: false }));
      }
    }
    void start();

    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;
      void detectBarcodeFromVideo(video).then((value) => {
        if (value && !cancelled) {
          onCodeRef.current(value);
          setOpen(false);
        }
      });
    }, 400);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open, allowCamera, allowTyped, cameraReady]);

  useEffect(() => {
    if (!open || !allowNfc) return;
    let cancelled = false;
    let stop: (() => Promise<void>) | undefined;
    void startNfcScan((code) => {
      if (cancelled) return;
      onCodeRef.current(code);
      setOpen(false);
    }).then((res) => {
      if (cancelled) {
        void res.stop();
        return;
      }
      stop = res.stop;
      setHint(scanSheetHint({ cameraReady, typed: allowTyped, nfcReady: res.ready }));
    });
    return () => {
      cancelled = true;
      void stop?.();
    };
  }, [open, allowNfc, allowTyped, cameraReady]);

  return (
    <>
      <button type="button" className="btn-secondary" disabled={disabled} onClick={() => setOpen(true)}>
        {scanButtonLabel(label, allowNfc)}
      </button>
      {open ? (
        <div className="catalog-scan-modal" role="dialog" aria-label="Scan catalog code">
          <div className="catalog-scan-sheet">
            <p className="muted">{hint}</p>
            {allowCamera ? <video ref={videoRef} className="catalog-scan-video" playsInline muted /> : null}
            {allowTyped ? (
              <form
                className="catalog-scan-type"
                onSubmit={(e) => {
                  e.preventDefault();
                  const code = typed.trim();
                  if (!code) return;
                  onCode(code);
                  setTyped("");
                  setOpen(false);
                }}
              >
                <input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder="SKU / barcode / QR text"
                  autoComplete="off"
                  autoFocus
                />
                <button type="submit" className="btn" disabled={!typed.trim()}>
                  Use code
                </button>
              </form>
            ) : null}
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setTyped("");
                setOpen(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
