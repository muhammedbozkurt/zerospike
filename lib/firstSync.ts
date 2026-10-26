import type { CgmMode } from "./cgm/state";

/**
 * The home guide's lead step. A manual profile starts with its first reading; a
 * profile on a sensor mode starts with the first sync, which is done once a
 * sensor reading has arrived. Pure, with its reads injected, so
 * scripts/firstSync.test.ts runs it under plain Node; lib/services/firstLog.ts
 * supplies the real ones.
 */

export type FirstStepKind = "log" | "sync";

export function firstStepKindOf(mode: CgmMode): FirstStepKind {
  return mode === "manual" ? "log" : "sync";
}

export const FIRST_SYNC_FLAG_BASE = "zerospike.firstSync";

export function firstSyncKey(profileId: string): string {
  return `${FIRST_SYNC_FLAG_BASE}.${profileId}`;
}

export interface FirstSyncDeps {
  readFlag: (profileId: string) => Promise<boolean>;
  writeFlag: (profileId: string) => Promise<void>;
  getMode: (profileId: string) => Promise<CgmMode>;
  countReadings: (profileId: string) => Promise<number>;
}

/** The remembered answer only; never counts. */
export async function isFirstSyncDone(
  profileId: string,
  deps: Pick<FirstSyncDeps, "readFlag">
): Promise<boolean> {
  try {
    return await deps.readFlag(profileId);
  } catch {
    return false;
  }
}

/**
 * Marks the first sync done once a sensor reading exists for a profile on a
 * sensor mode, and remembers it so a later empty stretch does not undo it.
 * Manual mode never completes it. Any failure reads as not done yet.
 */
export async function noteFirstSync(
  profileId: string,
  deps: FirstSyncDeps
): Promise<boolean> {
  try {
    if (await deps.readFlag(profileId)) return true;
    if (firstStepKindOf(await deps.getMode(profileId)) !== "sync") return false;
    if ((await deps.countReadings(profileId)) <= 0) return false;
    await deps.writeFlag(profileId);
    return true;
  } catch {
    return false;
  }
}
