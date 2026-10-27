import AsyncStorage from "@react-native-async-storage/async-storage";

import { logCrash } from "../analytics";
import { insertImportedGlucose } from "../db/logs";
import { getProfile, listProfiles } from "../db/profiles";
import { safeNightscoutError } from "../nightscout/safeError";
import {
  awaitNightscoutIdle,
  connectNightscout,
  disconnectNightscout,
  nightscoutSecretKey,
  nightscoutStateKey,
  readNightscoutState,
  resetNightscoutCursor,
  runNightscoutSync,
  testConnection,
  type NsConnectResult,
  type NsDeps,
  type NsState,
  type NsSyncOutcome,
  type NsTestResult,
} from "../nightscout/sync";
import { deleteNightscoutReadings } from "../nightscout/localData";
import { secureGet, secureRemove, secureSet, secureStoreAvailable } from "../secureStore";
import { getHealthBackgroundEntitled, syncHealthInBackground } from "./health";

/**
 * The sources that feed a profile's glucose log from outside the device, in
 * the order a pass runs them: Nightscout, then Health. Foreground polling
 * (lib/useSourcePolling.ts), the Android background task and the iOS HealthKit
 * observer all come through here.
 *
 * Nightscout wiring only: storage and secure store are the real ones, the
 * import door is insertImportedGlucose, and any unexpected error is reduced to
 * a message-free one before it is logged (the message could quote the address).
 */

const ACTIVE_PROFILE_KEY = "zerospike.activeProfile";

function deps(): NsDeps {
  return {
    storage: AsyncStorage,
    secure: secureStoreAvailable()
      ? { get: secureGet, set: secureSet, remove: secureRemove }
      : null,
    insert: insertImportedGlucose,
    onError: (stage, err) => {
      logCrash(safeNightscoutError(stage, err), { screen: "nightscout", op: stage });
    },
  };
}

export function nightscoutAvailable(): boolean {
  return secureStoreAvailable();
}

export function getNightscoutState(profileId: string): Promise<NsState> {
  return readNightscoutState(profileId, deps());
}

/** The test result without the normalised address and the token to store: the
 *  screen needs neither, and keeping them out of its hands keeps them out of
 *  anything it could log. `token` is only a token that was pasted inside the
 *  address, to move it into the token field. */
export type NightscoutTestView = Omit<NsTestResult, "base" | "useToken">;

export async function testNightscout(input: {
  url: string;
  token: string;
}): Promise<NightscoutTestView> {
  const { base: _base, useToken: _useToken, ...view } = await testConnection(input, deps());
  return view;
}

export function connectNightscoutFor(
  profileId: string,
  input: { url: string; token: string }
): Promise<NsConnectResult> {
  return connectNightscout(profileId, input, deps());
}

/** Turns the connection off. `deleteReadings` also removes what it imported. */
export async function disconnectNightscoutFor(
  profileId: string,
  options: { deleteReadings: boolean }
): Promise<{ removed: number }> {
  await disconnectNightscout(profileId, deps());
  // A sync that was mid-insert when the connection went must finish before the
  // rows are deleted, or its last batch would land after the delete.
  await awaitNightscoutIdle(profileId);
  let removed = 0;
  if (options.deleteReadings) removed = await deleteNightscoutReadings(profileId);
  return { removed };
}

/** "Delete data": readings up to now never return from the server. */
export async function resetNightscoutCursorFor(profileId: string): Promise<void> {
  try {
    await resetNightscoutCursor(profileId, deps());
  } catch (err) {
    logCrash(safeNightscoutError("resetCursor", err), { screen: "nightscout", op: "resetCursor" });
  }
}

/** Profile deletion: the stored address and token go with the profile. */
export async function clearNightscoutForProfile(profileId: string): Promise<void> {
  try {
    if (secureStoreAvailable()) await secureRemove(nightscoutSecretKey(profileId));
  } catch (err) {
    logCrash(safeNightscoutError("clearSecret", err), { screen: "nightscout", op: "clearSecret" });
  }
  try {
    await AsyncStorage.removeItem(nightscoutStateKey(profileId));
  } catch {
    // an orphaned state flag is inert once the secret is gone
  }
}

export async function syncNightscoutForeground(
  profileId: string,
  isPro: boolean
): Promise<NsSyncOutcome> {
  if (!secureStoreAvailable()) return { status: "skipped", reason: "no_credentials" };
  try {
    return await runNightscoutSync(profileId, deps(), { entitled: isPro });
  } catch (err) {
    logCrash(safeNightscoutError("foreground", err), { screen: "nightscout", op: "foreground" });
    return { status: "error", error: "storage" };
  }
}

async function activeProfileId(): Promise<string | null> {
  try {
    const saved = await AsyncStorage.getItem(ACTIVE_PROFILE_KEY);
    const profile = saved ? await getProfile(saved) : null;
    if (profile) return profile.id;
    return (await listProfiles())[0]?.id ?? null;
  } catch {
    return null;
  }
}

/** True when the active profile has a Nightscout connection that may run in the
 *  background (entitlement is the flag the foreground stores for headless runs). */
export async function nightscoutBackgroundWanted(): Promise<boolean> {
  try {
    if (!secureStoreAvailable()) return false;
    if (!(await getHealthBackgroundEntitled())) return false;
    const profileId = await activeProfileId();
    if (!profileId) return false;
    return (await readNightscoutState(profileId, deps())).connected;
  } catch {
    return false;
  }
}

export interface SourcePassOutcome {
  failed: boolean;
}

/** One background pass: Nightscout, then Health. Never throws, never prompts. */
export async function syncSourcesInBackground(): Promise<SourcePassOutcome> {
  let failed = false;
  try {
    const profileId = await activeProfileId();
    if (profileId && secureStoreAvailable()) {
      const entitled = await getHealthBackgroundEntitled();
      const out = await runNightscoutSync(profileId, deps(), { entitled });
      if (out.status === "error" && out.error !== "auth") failed = true;
    }
  } catch (err) {
    logCrash(safeNightscoutError("background", err), { screen: "nightscout", op: "background" });
    failed = true;
  }
  const health = await syncHealthInBackground();
  if (health.result?.status === "error") failed = true;
  return { failed };
}
