import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type NativeDutyStatus = {
  active: boolean;
  lastFixAt: string | null;
  lastSentAt: string | null;
  queued: number;
  error: string | null;
  permission?: string;
};

export interface DutyLocationPlugin {
  start(options: {
    jobId?: string | null;
    origin: string;
    intervalSec?: number;
    quietSec?: number;
    minMoveM?: number;
  }): Promise<NativeDutyStatus>;
  stop(): Promise<void>;
  flush(): Promise<NativeDutyStatus>;
  getStatus(): Promise<NativeDutyStatus>;
  ensurePermission(): Promise<{ permission: string }>;
  addListener(
    eventName: "status",
    listenerFunc: (status: NativeDutyStatus) => void,
  ): Promise<PluginListenerHandle>;
}

export const DutyLocation = registerPlugin<DutyLocationPlugin>("DutyLocation");
