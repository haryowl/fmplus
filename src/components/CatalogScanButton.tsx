import { useEffect, useRef, useState } from "react";
import { barcodeDetectorAvailable, detectBarcodeFromVideo } from "../lib/catalogScan";

type Props = {
  disabled?: boolean;
  label?: string;
  onCode: (code: string) => void;
  allowCamera?: boolean;
  allowTyped?: boolean;
};

export function CatalogScanButton({
  disabled,
  label = "Scan",
  onCode,
  allowCamera = true,
  allowTyped = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [hint, setHint] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const canDetect = allowCamera && barcodeDetectorAvailable();
    setHint(
      canDetect
        ? "Point the camera at a barcode or QR"
        : allowTyped
          ? "Type the SKU or barcode"
          : "Scan is disabled",
    );

    async function start() {
      if (!canDetect || !navigator.mediaDevices?.getUserMedia) return;
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
        setHint("Camera unavailable — type the code");
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
  }, [open, allowCamera, allowTyped]);

  return (
    <>
      <button type="button" className="btn-secondary" disabled={disabled} onClick={() => setOpen(true)}>
        {label}
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
