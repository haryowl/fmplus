import { tenantHeaders } from "./tenant";

export type DispatchStatus =
  | "draft"
  | "assigned"
  | "en_route"
  | "arrived"
  | "done"
  | "cancelled";

export type DispatchStopStatus = "pending" | "arrived" | "done" | "skipped";

export type DispatchStop = {
  id: string;
  sortOrder: number;
  name: string;
  address: string;
  lat: number | null;
  lon: number | null;
  notes: string;
  status: DispatchStopStatus;
  arrivedAt: string | null;
  completedAt: string | null;
};

export type DispatchJob = {
  id: string;
  status: DispatchStatus;
  title: string;
  notes: string;
  armadaUserId: number | null;
  armadaUsername: string;
  userDisplayName: string;
  assignedFieldUserId: string | null;
  assigneeUsername?: string;
  assigneeDisplayName?: string;
  assignedAt: string | null;
  startedAt: string | null;
  arrivedAt: string | null;
  completedAt: string | null;
  fieldNote: string;
  createdAt: string;
  updatedAt: string;
  stops: DispatchStop[];
};

export type DispatchFieldUser = {
  id: string;
  username: string;
  role: string;
  displayName: string;
  enabled: boolean;
};

export const DISPATCH_STATUS_LABELS: Record<DispatchStatus, string> = {
  draft: "Draft",
  assigned: "Assigned",
  en_route: "En route",
  arrived: "Arrived",
  done: "Done",
  cancelled: "Cancelled",
};

export function dispatchVehicleLabel(job: DispatchJob): string {
  return job.userDisplayName || job.armadaUsername || (job.armadaUserId ? `#${job.armadaUserId}` : "—");
}

export function dispatchAssigneeLabel(job: DispatchJob): string {
  return job.assigneeDisplayName || job.assigneeUsername || "Unassigned";
}

export async function fetchDispatchJobs(
  status: "open" | "all" | DispatchStatus = "open",
  signal?: AbortSignal,
): Promise<DispatchJob[]> {
  const res = await fetch(`/api/dispatch/jobs?status=${encodeURIComponent(status)}&limit=100`, {
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as { jobs?: DispatchJob[]; error?: string };
  if (!res.ok) throw new Error(data.error || `Dispatch ${res.status}`);
  return data.jobs || [];
}

export async function fetchDispatchJob(id: string): Promise<DispatchJob> {
  const res = await fetch(`/api/dispatch/jobs/${encodeURIComponent(id)}`, {
    headers: { accept: "application/json", ...tenantHeaders() },
  });
  const data = (await res.json().catch(() => ({}))) as { job?: DispatchJob; error?: string };
  if (!res.ok) throw new Error(data.error || `Job ${res.status}`);
  if (!data.job) throw new Error("Job missing");
  return data.job;
}

export async function createDispatchJob(body: {
  title: string;
  notes?: string;
  armadaUserId?: number | null;
  armadaUsername?: string;
  userDisplayName?: string;
  assignedFieldUserId?: string | null;
  stops?: Array<{ name?: string; address?: string; lat?: number | null; lon?: number | null; notes?: string }>;
}): Promise<DispatchJob> {
  const res = await fetch("/api/dispatch/jobs", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", ...tenantHeaders() },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { job?: DispatchJob; error?: string };
  if (!res.ok) throw new Error(data.error || `Create ${res.status}`);
  if (!data.job) throw new Error("Create failed");
  return data.job;
}

export async function patchDispatchJob(
  id: string,
  patch: Record<string, unknown>,
): Promise<DispatchJob> {
  const res = await fetch(`/api/dispatch/jobs/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { accept: "application/json", "content-type": "application/json", ...tenantHeaders() },
    body: JSON.stringify(patch),
  });
  const data = (await res.json().catch(() => ({}))) as { job?: DispatchJob; error?: string };
  if (!res.ok) throw new Error(data.error || `Patch ${res.status}`);
  if (!data.job) throw new Error("Patch failed");
  return data.job;
}

export async function fetchDispatchFieldUsers(): Promise<DispatchFieldUser[]> {
  const res = await fetch("/api/dispatch/field-users", {
    headers: { accept: "application/json", ...tenantHeaders() },
  });
  const data = (await res.json().catch(() => ({}))) as { users?: DispatchFieldUser[]; error?: string };
  if (!res.ok) throw new Error(data.error || `Field users ${res.status}`);
  return data.users || [];
}

/** Parse lines like: -6.2, 106.8 Depot A */
export function parseStopPaste(text: string): Array<{
  name: string;
  lat: number | null;
  lon: number | null;
}> {
  const out: Array<{ name: string; lat: number | null; lon: number | null }> = [];
  for (const line of text.split(/[\n;]+/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/[,|\s]+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) {
      out.push({ name: trimmed.slice(0, 200), lat: null, lon: null });
      continue;
    }
    const lat = Number(parts[0]);
    const lon = Number(parts[1]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      out.push({
        lat,
        lon,
        name: parts.slice(2).join(" ").slice(0, 200) || `Stop ${out.length + 1}`,
      });
    } else {
      out.push({ name: trimmed.slice(0, 200), lat: null, lon: null });
    }
  }
  return out;
}
