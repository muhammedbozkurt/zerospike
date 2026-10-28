/**
 * Pure decisions behind the writing-direction flow, dependency-free so
 * scripts/rtlSync.test.ts runs them under plain Node.
 *
 * Why the direction needs its own flow: the native layer reads the persisted
 * I18nManager flags once, when the process (or the React context) starts. A flag
 * written mid-session changes nothing on screen until that restart.
 */

export type RtlStartupAction =
  /** Direction already matches the saved language. */
  | "none"
  /** Mismatch: write the flags so the NEXT cold start is right, no reload. */
  | "flagsOnly"
  /** Mismatch: write the flags and try one reload. */
  | "reload";

export interface RtlStartupInput {
  targetRTL: boolean;
  currentRTL: boolean;
  /** The capture pipeline drives its own relaunches; an uninvited reload races them. */
  screenshotMode: boolean;
  /** Persisted one-shot marker ("true" | "false"): the direction a reload was
   *  already attempted for. Stops a reload that never fixes the mismatch from
   *  repeating on every cold start. */
  reloadTriedFor: string | null;
}

export function decideRtlStartup(i: RtlStartupInput): RtlStartupAction {
  if (i.targetRTL === i.currentRTL) return "none";
  if (i.screenshotMode) return "flagsOnly";
  if (i.reloadTriedFor === String(i.targetRTL)) return "flagsOnly";
  return "reload";
}

/**
 * Outcome of asking the runtime to reload so the new direction shows.
 * "reloaded": expo-updates accepted the reload (the React context is recreated
 * and re-reads the flags; this is the production path, it works with OTA off).
 * "manual": no real reload was possible (dev client, Expo Go, expo-updates
 * missing). The flags are already saved; the user has to close and reopen the app.
 */
export type RtlReloadOutcome = "reloaded" | "manual";

export function needsManualRestartNotice(outcome: RtlReloadOutcome): boolean {
  return outcome === "manual";
}
