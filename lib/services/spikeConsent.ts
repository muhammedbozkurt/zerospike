import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearHistory } from "../ai/spikeHistory";

/**
 * Spike consent gate - fail-closed (Apple 5.1.1). Until the user explicitly
 * accepts the data-boundary screen, Spike is locked. Consent can be withdrawn
 * from Settings, which clears the flag and re-locks the assistant.
 *
 * A second, separate consent covers the 14-day summary packet
 * (lib/ai/spikeContext.ts). It is off by default, is asked for on its own
 * screen, can be turned off from the chat at any time, and only counts while
 * the first consent stands.
 */
const CONSENT_KEY = "zerospike.spikeConsent";
const CONTEXT_CONSENT_KEY = "zerospike.spikeContextConsent";

export async function hasSpikeConsent(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(CONSENT_KEY)) === "true";
  } catch {
    return false; // fail-closed
  }
}

export async function grantSpikeConsent(): Promise<void> {
  try {
    await AsyncStorage.setItem(CONSENT_KEY, "true");
  } catch {
    // best-effort
  }
}

/** True only when BOTH the chat consent and the summary consent are on. */
export async function hasSpikeContextConsent(): Promise<boolean> {
  try {
    if ((await AsyncStorage.getItem(CONSENT_KEY)) !== "true") return false;
    return (await AsyncStorage.getItem(CONTEXT_CONSENT_KEY)) === "true";
  } catch {
    return false; // fail-closed
  }
}

/**
 * Stores the summary consent and reports whether the stored value is now what
 * was asked for, so the switch on screen only moves when the choice is really
 * kept. Turning it off must stick even when removing the key fails, hence the
 * explicit "false" fallback: a switch that reads off must never come back on.
 */
export async function setSpikeContextConsent(granted: boolean): Promise<boolean> {
  try {
    if (granted) {
      await AsyncStorage.setItem(CONTEXT_CONSENT_KEY, "true");
    } else {
      try {
        await AsyncStorage.removeItem(CONTEXT_CONSENT_KEY);
      } catch {
        await AsyncStorage.setItem(CONTEXT_CONSENT_KEY, "false");
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** Withdrawing takes the stored chat with it: leaving a readable transcript
 *  behind after the user revoked consent is not what "withdraw" means. The
 *  summary consent goes too, so a later re-consent starts from off. */
export async function withdrawSpikeConsent(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CONSENT_KEY);
  } catch {
    // best-effort
  }
  try {
    await AsyncStorage.removeItem(CONTEXT_CONSENT_KEY);
  } catch {
    // best-effort
  }
  await clearHistory();
}
