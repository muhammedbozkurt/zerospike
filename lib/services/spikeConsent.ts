import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearHistory } from "../ai/spikeHistory";
import { forgetUnsavedEstimate } from "../ai/carbEstimateUnsaved";

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
const CONSENT_VERSION_KEY = "zerospike.spikeConsentVersion";

/**
 * Version 2 added the meal-text paragraph (spike.consentCarb). A consent stored
 * without a version (v1) or with an older one no longer counts, so existing
 * users see the screen once more before any meal text can leave the device.
 */
export const SPIKE_CONSENT_VERSION = 2;

async function consentStands(): Promise<boolean> {
  if ((await AsyncStorage.getItem(CONSENT_KEY)) !== "true") return false;
  return Number(await AsyncStorage.getItem(CONSENT_VERSION_KEY)) === SPIKE_CONSENT_VERSION;
}

export async function hasSpikeConsent(): Promise<boolean> {
  try {
    return await consentStands();
  } catch {
    return false; // fail-closed
  }
}

/**
 * The summary consent is versioned too. Version 2 added the CGM averages to
 * the packet (spike.ctxShared1 names the sources). A summary consent stored
 * without a version (v1, given before 2.5) keeps the packet it agreed to, but
 * the cgm block stays out of it until the user accepts the current text.
 */
export const SPIKE_CONTEXT_CONSENT_VERSION = 2;
const CONTEXT_CONSENT_VERSION_KEY = "zerospike.spikeContextConsentVersion";
/** Set once the v2 text has been put in front of a v1 user, accepted or not,
 *  so the offer is made once and not on every visit. */
const CGM_OFFER_SEEN_KEY = "zerospike.spikeCgmOfferSeen";

/** 0 when the summary consent is off, 1 for a pre-2.5 consent, else the stored version. */
export async function getSpikeContextConsentVersion(): Promise<number> {
  try {
    if (!(await hasSpikeContextConsent())) return 0;
    const stored = Number(await AsyncStorage.getItem(CONTEXT_CONSENT_VERSION_KEY));
    return Number.isInteger(stored) && stored >= 1 ? stored : 1;
  } catch {
    return 0; // fail-closed
  }
}

/** True only while the summary consent stands AND was given on the text that
 *  names CGM. The one gate for the cgm block of the packet. */
export async function hasSpikeCgmConsent(): Promise<boolean> {
  return (await getSpikeContextConsentVersion()) >= SPIKE_CONTEXT_CONSENT_VERSION;
}

export async function shouldOfferSpikeCgmConsent(): Promise<boolean> {
  try {
    if ((await getSpikeContextConsentVersion()) !== 1) return false;
    return (await AsyncStorage.getItem(CGM_OFFER_SEEN_KEY)) !== "true";
  } catch {
    return false;
  }
}

export async function markSpikeCgmOfferSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(CGM_OFFER_SEEN_KEY, "true");
  } catch {
    // best-effort: the offer may come once more
  }
}

export async function grantSpikeConsent(): Promise<void> {
  try {
    await AsyncStorage.setItem(CONSENT_KEY, "true");
    await AsyncStorage.setItem(CONSENT_VERSION_KEY, String(SPIKE_CONSENT_VERSION));
  } catch {
    // best-effort
  }
}

/** True only when BOTH the chat consent and the summary consent are on. */
export async function hasSpikeContextConsent(): Promise<boolean> {
  try {
    if (!(await consentStands())) return false;
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
      await AsyncStorage.setItem(CONTEXT_CONSENT_VERSION_KEY, String(SPIKE_CONTEXT_CONSENT_VERSION));
      await AsyncStorage.setItem(CONTEXT_CONSENT_KEY, "true");
    } else {
      try {
        await AsyncStorage.removeItem(CONTEXT_CONSENT_KEY);
      } catch {
        await AsyncStorage.setItem(CONTEXT_CONSENT_KEY, "false");
      }
      try {
        await AsyncStorage.removeItem(CONTEXT_CONSENT_VERSION_KEY);
      } catch {
        // the consent flag above already reads off; a stale version is inert
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
    await AsyncStorage.removeItem(CONSENT_VERSION_KEY);
  } catch {
    // best-effort
  }
  try {
    await AsyncStorage.removeItem(CONTEXT_CONSENT_KEY);
  } catch {
    // best-effort
  }
  try {
    await AsyncStorage.removeItem(CONTEXT_CONSENT_VERSION_KEY);
    await AsyncStorage.removeItem(CGM_OFFER_SEEN_KEY);
  } catch {
    // best-effort
  }
  forgetUnsavedEstimate();
  await clearHistory();
}
