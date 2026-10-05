import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * One-time prompts around Health writing, device-wide like
 * injectionMapNotice.ts: the "also save manual readings to Health?" question
 * for existing users (asked right after a manual reading, never again once
 * answered either way) and the "send past readings?" offer shown the first time
 * writing is switched on.
 */
const WRITE_ASKED_KEY = "zerospike.healthWriteAskedV1";
const BACKFILL_OFFERED_KEY = "zerospike.healthBackfillOfferedV1";

async function seen(key: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(key)) === "true";
  } catch {
    // Fail closed: a storage error must not turn into a prompt on every launch.
    return true;
  }
}

async function mark(key: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, "true");
  } catch {
    // best-effort persistence
  }
}

export const healthWriteAskSeen = () => seen(WRITE_ASKED_KEY);
export const markHealthWriteAskSeen = () => mark(WRITE_ASKED_KEY);
export const healthBackfillOfferSeen = () => seen(BACKFILL_OFFERED_KEY);
export const markHealthBackfillOfferSeen = () => mark(BACKFILL_OFFERED_KEY);
