import AsyncStorage from "@react-native-async-storage/async-storage";

import { cgmDetected, countCgmReadingsLast24h } from "../db/cgmSql";
import { emitCgmChanged } from "./importEvents";

/**
 * How a profile gets its glucose readings. 'manual' is the default and is never
 * changed by anything but the user: finding sensor data in Health only makes
 * the one-time switch question available (shouldOfferCgmSwitch), it does not
 * switch.
 */
export type CgmMode = "manual" | "cgm" | "nightscout";

export const CGM_MODES: readonly CgmMode[] = ["manual", "cgm", "nightscout"];

/** Per-profile AsyncStorage bases (`<base>.<profileId>`, lib/profileScopedKeys.ts). */
export const CGM_MODE_KEY = "zerospike.cgmMode";
export const CGM_OFFER_KEY = "zerospike.cgmOffer";

export type CgmOfferAction = "accepted" | "declined";

export function cgmModeKey(profileId: string): string {
  return `${CGM_MODE_KEY}.${profileId}`;
}

export function cgmOfferKey(profileId: string): string {
  return `${CGM_OFFER_KEY}.${profileId}`;
}

/** Anything that is not a known mode reads as manual. */
export function parseCgmMode(raw: unknown): CgmMode {
  return raw === "cgm" || raw === "nightscout" ? raw : "manual";
}

/** True when sensor data drives this profile's screens (anything but manual). */
export function isCgmModeActive(mode: CgmMode): boolean {
  return mode !== "manual";
}

export async function getCgmMode(profileId: string): Promise<CgmMode> {
  try {
    return parseCgmMode(await AsyncStorage.getItem(cgmModeKey(profileId)));
  } catch {
    return "manual";
  }
}

/** Throws when the write fails, so the caller can say so instead of showing a
 *  mode that did not stick. Going back to 'manual' deletes no readings.
 *
 *  Leaving a sensor mode for manual is an answer to the "switch to CGM mode?"
 *  question (the person just chose manual on purpose), so it is recorded as
 *  declined and the card does not come straight back. `keepOffer` skips that for
 *  a reset that is not a decision (onboarding rewriting an abandoned attempt). */
export async function setCgmMode(
  profileId: string,
  mode: CgmMode,
  opts: { keepOffer?: boolean } = {}
): Promise<void> {
  const before = mode === "manual" && !opts.keepOffer ? await getCgmMode(profileId) : "manual";
  await AsyncStorage.setItem(cgmModeKey(profileId), mode);
  if (before !== "manual") {
    try {
      await AsyncStorage.setItem(cgmOfferKey(profileId), "declined");
    } catch {
      // The mode is saved; the question may be asked once more.
    }
  }
  emitCgmChanged({ kind: "mode", profileId });
}

export async function getCgmOfferAnswer(
  profileId: string
): Promise<CgmOfferAction | null> {
  try {
    const raw = await AsyncStorage.getItem(cgmOfferKey(profileId));
    return raw === "accepted" || raw === "declined" ? raw : null;
  } catch {
    return null;
  }
}

/** The question is asked once per profile: due only while the profile is still
 *  manual, sensor data was found, and no answer was recorded yet. */
export function offerIsDue(input: {
  detected: boolean;
  mode: CgmMode;
  answered: boolean;
}): boolean {
  return input.detected && input.mode === "manual" && !input.answered;
}

export async function shouldOfferCgmSwitch(
  profileId: string,
  deps: { countRecent?: (profileId: string) => Promise<number> } = {}
): Promise<boolean> {
  const mode = await getCgmMode(profileId);
  if (mode !== "manual") return false;
  if ((await getCgmOfferAnswer(profileId)) != null) return false;
  try {
    const count = await (deps.countRecent ?? countCgmReadingsLast24h)(profileId);
    return offerIsDue({ detected: cgmDetected(count), mode, answered: false });
  } catch {
    return false;
  }
}

/** Records the answer so the question never comes back. Accepting also moves
 *  the profile to 'cgm'; declining leaves it manual. */
export async function markCgmOfferShown(
  profileId: string,
  action: CgmOfferAction
): Promise<void> {
  await AsyncStorage.setItem(cgmOfferKey(profileId), action);
  if (action === "accepted") await setCgmMode(profileId, "cgm");
}
