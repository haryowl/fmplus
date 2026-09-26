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
  start(options: { jobId?: string | null; origin: string }): Promise<NativeDutyStatus>;
  stop(): Promise<void>;
  flush(): Promise<NativeDutyStatus>;
  getStatus(): Promise<NativeDutyStatus>;
  addListener(
    eventName: "status",
    listenerFunc: (status: NativeDutyStatus) => void,
  ): Promise<PluginListenerHandle>;
}

export const DutyLocation = registerPlugin<DutyLocationPlugin>("DutyLocation");
