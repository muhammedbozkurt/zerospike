import AsyncStorage from "@react-native-async-storage/async-storage";

import { THANKS_STATE_KEY, type ThanksOutcome } from "../thanks/detect";
import { confirmThanksShown, evaluateThanks, type ThanksDeps, type ThanksKind } from "../thanks/evaluate";
import { getEntitlementSnapshot } from "./purchases";

const deps: ThanksDeps = {
  readEntitlement: getEntitlementSnapshot,
  readRaw: () => AsyncStorage.getItem(THANKS_STATE_KEY),
  writeRaw: (raw) => AsyncStorage.setItem(THANKS_STATE_KEY, raw),
  now: Date.now,
};

/**
 * One look at the entitlement for the thank-you moments; resolves to the moment
 * waiting to be shown. Account-level (Pro belongs to the store account, not to
 * a profile), so the state sits under one unscoped key.
 */
export function evaluateThanksNow(): Promise<ThanksOutcome> {
  return evaluateThanks(deps);
}

/** The moment is really on screen: stamp it and clear its pending mark. */
export function confirmThanksNow(kind: ThanksKind): Promise<boolean> {
  return confirmThanksShown(deps, kind);
}
