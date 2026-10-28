import {
  runConnect,
  type ConnectAccess,
  type ConnectResult,
  type FlowSession,
  type HealthFlow,
} from "../healthConnectFlow";

/**
 * Turning the Health import on for a profile (the dashboard card, and Settings >
 * Data sources when CGM is picked). The switch is persisted only AFTER the read
 * permission was granted, never before: a refusal, a request still open when the
 * app is closed, or a run held back by a covered screen leaves nothing behind,
 * so the next launch cannot start an import (and on Android a permission sheet)
 * nobody asked for. All waiting goes through lib/healthConnectFlow.
 */
export interface ConnectSyncDeps<A extends ConnectAccess, R> {
  setBusy: (on: boolean) => void;
  /** The system permission request. */
  request: (wanted: () => boolean) => Promise<A>;
  /** Persists the switch for the profile. */
  writeFlag: (on: boolean) => Promise<void>;
  /** The first import, on the same session. */
  importNow: (session: FlowSession) => Promise<R | null>;
  onDenied: (access: A) => Promise<void>;
  onDone: (synced: R | null, access: A) => Promise<void>;
  onBlocked?: () => void;
  timeoutMs?: number;
}

export function connectHealthSync<A extends ConnectAccess, R>(
  flow: HealthFlow,
  d: ConnectSyncDeps<A, R>
): Promise<ConnectResult> {
  return runConnect<A, R>(flow, {
    setSyncing: d.setBusy,
    request: d.request,
    onBlocked: d.onBlocked,
    timeoutMs: d.timeoutMs,
    onDenied: async (access) => {
      await d.writeFlag(false);
      await d.onDenied(access);
    },
    sync: async (session) => {
      // A switch-off that arrived while the sheet was open supersedes this run.
      if (!session.current()) return null;
      await d.writeFlag(true);
      return d.importNow(session);
    },
    onConnected: d.onDone,
  });
}
