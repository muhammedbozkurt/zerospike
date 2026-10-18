import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  LEGACY_OPT_OUT_KEY,
  createConsentController,
  type ConsentChoice,
  type ConsentListener,
  type ConsentState,
} from "./consent";

/**
 * The app's analytics consent, AsyncStorage-backed (the state machine and its
 * migration live in ./consent). Usage analytics are opt-in: nothing is collected
 * or queued until the state is "granted", and a storage read error counts as off.
 * The names below the controller are the ones callers already import; "enabled"
 * means granted.
 */

export type { ConsentChoice, ConsentChange, ConsentListener, ConsentState } from "./consent";

/** The pre-opt-in key ("true" meant switched off). It is read once, to migrate, and then removed. */
export const ANALYTICS_OPT_OUT_KEY = LEGACY_OPT_OUT_KEY;

const consent = createConsentController(AsyncStorage);

export function getAnalyticsConsent(): Promise<ConsentState> {
  return consent.getConsent();
}

/**
 * Settings > Data > Privacy and the two consent surfaces (onboarding, the
 * dashboard sheet). `next` is an answer the user gave, "granted" or "declined";
 * "unanswered" is only ever the absence of one (see ./consent). Persists first
 * and throws if that fails, so the choice is never lost. The sinks then react in
 * the background (the Supabase outbox starts or is emptied, and the RevenueCat device_id attribute follow the switch), so this resolves as
 * soon as the choice is stored. Only "granted" lets anything out: declining
 * sends nothing, not even a note that it was switched off.
 */
export function setAnalyticsConsent(next: ConsentChoice): Promise<void> {
  return consent.setConsent(next);
}

/** Synchronous gate for hot paths: false until the stored state has been read once. */
export function isAnalyticsEnabledNow(): boolean {
  return consent.isGrantedNow();
}

/** Sinks register here to react when the state changes. Returns the unsubscribe. */
export function onAnalyticsEnabledChange(listener: ConsentListener): () => void {
  return consent.onChange(listener);
}

/** True only for "granted"; "unanswered" and an unreadable store are off. */
export async function getAnalyticsEnabled(): Promise<boolean> {
  return (await consent.getConsent()) === "granted";
}

/**
 * Kept for existing callers. Despite the name it is "not opted in": a user who
 * was never asked has not opted out, but nothing is collected for them either.
 */
export async function isAnalyticsOptedOut(): Promise<boolean> {
  return !(await getAnalyticsEnabled());
}

export async function setAnalyticsEnabled(enabled: boolean): Promise<void> {
  await consent.setConsent(enabled ? "granted" : "declined");
}

/** True once onboarding or the dashboard sheet put the question to the user. */
export function hasAnalyticsConsentPrompt(): Promise<boolean> {
  return consent.hasPrompted();
}

export function markAnalyticsConsentPrompted(): Promise<void> {
  return consent.markPrompted();
}

/** Resolves once every sink has finished reacting to the changes so far. */
export function analyticsConsentSettled(): Promise<void> {
  return consent.settled();
}
