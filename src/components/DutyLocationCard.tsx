import { useEffect, useState } from "react";
import {
  driverLocationStatus,
  flushDriverLocationQueue,
  formatAge,
  subscribeDriverLocation,
  type DriverLocationStatus,
} from "../lib/driverLocation";

export function useDriverLocationStatus(): DriverLocationStatus {
  const [status, setStatus] = useState<DriverLocationStatus>(driverLocationStatus);
  useEffect(() => subscribeDriverLocation(setStatus), []);
  // The card shows relative ages, which go stale without a heartbeat.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!status.active) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 10_000);
    return () => window.clearInterval(id);
  }, [status.active]);
  return status;
}

type Props = {
  consent: boolean;
  onConsentChange: (on: boolean) => void;
  /** True when a job is in progress, i.e. tracking is expected to be running. */
  onDuty: boolean;
};

/**
 * Driver-facing control and honest status for on-duty location sharing.
 *
 * The wording matters here: a PWA cannot track with the screen off, so the card
 * says so rather than letting dispatch believe a parked driver is being followed.
 */
export function DutyLocationCard({ consent, onConsentChange, onDuty }: Props) {
  const status = useDriverLocationStatus();

  return (
    <section className="field-panel duty-location-card">
      <label className="duty-location-toggle">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => onConsentChange(e.target.checked)}
        />
        <span>
          <strong>Share my location while on duty</strong>
          <span className="muted">
            Dispatch sees your position only while a job is in progress.
          </span>
        </span>
      </label>

      {consent ? (
        <div className="duty-location-state">
          <span
            className={`duty-location-dot ${status.active ? "is-on" : "is-off"}`}
            aria-hidden
          />
          <span>
            {status.active ? (
              <>
                <strong>Sharing location</strong>
                <span className="muted">
                  {" · last fix "}
                  {formatAge(status.lastFixAt)}
                  {status.queued > 0 ? ` · ${status.queued} waiting to send` : ""}
                  {status.lastSentAt ? ` · sent ${formatAge(status.lastSentAt)}` : ""}
                </span>
              </>
            ) : onDuty ? (
              <strong>Starting…</strong>
            ) : (
              <>
                <strong>Standing by</strong>
                <span className="muted"> · starts when you begin a route</span>
              </>
            )}
          </span>
          {status.queued > 0 ? (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => void flushDriverLocationQueue()}
            >
              Send now
            </button>
          ) : null}
        </div>
      ) : null}

      {status.permission === "denied" ? (
        <p className="duty-location-warn">
          Location permission is blocked for this site. Enable it in your browser
          settings, otherwise Dispatch cannot see where you are.
        </p>
      ) : null}

      {status.error && status.permission !== "denied" ? (
        <p className="duty-location-warn">{status.error}</p>
      ) : null}

      {consent && status.active ? (
        <p className="muted duty-location-note">
          Keep this app open on screen. Phones stop sharing location when the
          screen is off or the app is closed — your queued positions are sent as
          soon as you come back.
          {status.wakeLock ? " Screen is being kept awake." : ""}
        </p>
      ) : null}
    </section>
  );
}
