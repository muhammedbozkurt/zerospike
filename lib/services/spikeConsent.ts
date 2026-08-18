import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearHistory } from "../ai/spikeHistory";

/**
 * Spike consent gate - fail-closed (Apple 5.1.1). Until the user explicitly
 * accepts the data-boundary screen, Spike is locked. Consent can be withdrawn
 * from Settings, which clears the flag and re-locks the assistant.
 */
const CONSENT_KEY = "zerospike.spikeConsent";

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

/** Withdrawing takes the stored chat with it: leaving a readable transcript
 *  behind after the user revoked consent is not what "withdraw" means. */
export async function withdrawSpikeConsent(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CONSENT_KEY);
  } catch {
    // best-effort
  }
  await clearHistory();
}
