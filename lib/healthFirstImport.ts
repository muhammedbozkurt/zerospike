import type { SyncResult } from "./services/healthTypes";

export const HEALTH_FIRST_IMPORT_KEY = "zerospike.healthFirstImportDone";

/**
 * The first successful Apple Health import that finds nothing gets one neutral
 * note. iOS never reports a refused read permission, so this is NOT a denial
 * message. Any later run, or a first run that found data, is not "first".
 */
export function firstImportOutcome(
  res: SyncResult,
  isIos: boolean,
  alreadyDone: boolean
): { showEmptyNote: boolean; markDone: boolean } {
  if (!isIos || alreadyDone || res.status !== "ok") return { showEmptyNote: false, markDone: false };
  return { showEmptyNote: res.read === 0 && res.inserted === 0, markDone: true };
}
