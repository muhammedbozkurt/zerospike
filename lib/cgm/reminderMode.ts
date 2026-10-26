import AsyncStorage from "@react-native-async-storage/async-storage";

import { isCgmModeActive, type CgmMode } from "./state";

/**
 * Measurement (glucose) reminders while a profile gets its readings from a
 * sensor. They are OFF by default there; the user can switch single ones back
 * on, which is what the opt-in list records. Nothing is deleted or disabled in
 * the reminders table, so going back to manual restores them exactly.
 *
 * Per-profile AsyncStorage base (`<base>.<profileId>`, lib/profileScopedKeys.ts).
 */
export const CGM_GLUCOSE_OPTIN_KEY = "zerospike.cgmGlucoseOptIn";

export function cgmGlucoseOptInKey(profileId: string): string {
  return `${CGM_GLUCOSE_OPTIN_KEY}.${profileId}`;
}

export function parseGlucoseOptIn(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

export async function getGlucoseOptIn(profileId: string): Promise<Set<string>> {
  try {
    return new Set(parseGlucoseOptIn(await AsyncStorage.getItem(cgmGlucoseOptInKey(profileId))));
  } catch {
    return new Set();
  }
}

export async function setGlucoseOptIn(
  profileId: string,
  reminderId: string,
  on: boolean
): Promise<void> {
  const next = await getGlucoseOptIn(profileId);
  if (on) next.add(reminderId);
  else next.delete(reminderId);
  await AsyncStorage.setItem(cgmGlucoseOptInKey(profileId), JSON.stringify([...next]));
}

/** True when this row is a measurement reminder held back by sensor mode. */
export function glucoseReminderPaused(
  row: { id: string; type: string },
  mode: CgmMode,
  optIn: ReadonlySet<string>
): boolean {
  return row.type === "glucose" && isCgmModeActive(mode) && !optIn.has(row.id);
}

/** The rows as the scheduler sees them: paused ones read as switched off.
 *  For screens that draw "what will actually arrive" from the table. */
export function withCgmPause<T extends { id: string; type: string; enabled: number }>(
  rows: readonly T[],
  mode: CgmMode,
  optIn: ReadonlySet<string>
): T[] {
  return rows.map((r) => (glucoseReminderPaused(r, mode, optIn) ? { ...r, enabled: 0 } : r));
}
