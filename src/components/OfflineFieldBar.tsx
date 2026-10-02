import { useEffect, useState } from "react";
import { subscribeOfflineField, type OfflineFieldStatus } from "../lib/offlineField";

function when(iso: string | null): string {
  if (!iso) return "not synced yet";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "saved on this phone";
  return `synced ${date.toLocaleString()}`;
}

/** Shown only in the offline Field APK. */
export function OfflineFieldBar() {
  const [status, setStatus] = useState<OfflineFieldStatus>({ syncedAt: null, pending: 0, conflicts: [] });
  useEffect(() => subscribeOfflineField(setStatus), []);
  const conflict = status.conflicts[status.conflicts.length - 1];
  return (
    <div className="offline-field-bar" role="status">
      <span>Saved on this phone · {when(status.syncedAt)}</span>
      {status.pending > 0 ? <strong> · {status.pending} waiting to send</strong> : null}
      {conflict ? <span className="offline-field-conflict"> · {conflict.error}</span> : null}
    </div>
  );
}
