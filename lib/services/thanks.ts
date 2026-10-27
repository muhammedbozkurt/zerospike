import AsyncStorage from "@react-native-async-storage/async-storage";

import { THANKS_STATE_KEY, type ThanksOutcome } from "../thanks/detect";
import { evaluateThanks } from "../thanks/evaluate";
import { getEntitlementSnapshot } from "./purchases";

/**
 * One look at the entitlement for the thank-you moments. Account-level (Pro
 * belongs to the store account, not to a profile), so the state sits under one
 * unscoped key.
 */
export function evaluateThanksNow(): Promise<ThanksOutcome> {
  return evaluateThanks({
    readEntitlement: getEntitlementSnapshot,
    readRaw: () => AsyncStorage.getItem(THANKS_STATE_KEY),
    writeRaw: (raw) => AsyncStorage.setItem(THANKS_STATE_KEY, raw),
    now: Date.now,
  });
}
