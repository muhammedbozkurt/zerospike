import * as StoreReview from "expo-store-review";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { logEvent } from "../analytics";
import { isScreenshotMode } from "../screenshotMode";

/**
 * Store-review gateway. Every trigger (a saved log, a viewed weekly digest, a
 * finished export) routes through maybeRequestReview(trigger) instead of its
 * own copy of the eligibility rules, so the caps below apply everywhere. Never
 * called from app launch or from an error/interruption path - only from the
 * positive moment itself.
 *
 * Caps (all must hold):
 * - first seen (this device, this install) at least MIN_DAYS_SINCE_FIRST_SEEN
 *   days ago, and at least MIN_LOG_COUNT logs recorded since;
 * - at most one attempt per app version;
 * - at least MIN_DAYS_BETWEEN_PROMPTS days since the last attempt (any
 *   version) - this only matters once a version bump clears the per-version
 *   cap above.
 *
 * No pre-prompt sentiment gate: Play policy forbids filtering who sees the
 * native prompt, so eligibility is decided entirely from our own usage
 * signals, never from asking the user how they feel first.
 */

const FIRST_SEEN_KEY = "zerospike.reviewFirstSeenAt";
const LOG_COUNT_KEY = "zerospike.reviewLogCount";
const LAST_PROMPT_AT_KEY = "zerospike.reviewLastPromptAt";
const LAST_PROMPT_VERSION_KEY = "zerospike.reviewLastPromptVersion";

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_DAYS_SINCE_FIRST_SEEN = 3;
const MIN_LOG_COUNT = 5;
const MIN_DAYS_BETWEEN_PROMPTS = 30;

function currentAppVersion(): string {
  return Constants.expoConfig?.version ?? "0.0.0";
}

// Lazily stamped on first call (there is no install-time hook), so this reads
// as "first seen by the review gateway" rather than the true install instant.
// That only ever makes the gate stricter, never looser.
async function getFirstSeenAt(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(FIRST_SEEN_KEY);
    if (raw) return Number(raw);
    const now = Date.now();
    await AsyncStorage.setItem(FIRST_SEEN_KEY, String(now));
    return now;
  } catch {
    return Date.now();
  }
}

async function getLogCount(): Promise<number> {
  try {
    return Number(await AsyncStorage.getItem(LOG_COUNT_KEY)) || 0;
  } catch {
    return 0;
  }
}

async function bumpLogCount(): Promise<void> {
  try {
    const count = (await getLogCount()) + 1;
    await AsyncStorage.setItem(LOG_COUNT_KEY, String(count));
  } catch {
    // best-effort; a missed increment only delays eligibility, never breaks it
  }
}

async function meetsBaselineEligibility(): Promise<boolean> {
  const firstSeenAt = await getFirstSeenAt();
  const daysSinceFirstSeen = (Date.now() - firstSeenAt) / DAY_MS;
  if (daysSinceFirstSeen < MIN_DAYS_SINCE_FIRST_SEEN) return false;
  return (await getLogCount()) >= MIN_LOG_COUNT;
}

async function canAttemptPrompt(): Promise<boolean> {
  try {
    const lastVersion = await AsyncStorage.getItem(LAST_PROMPT_VERSION_KEY);
    if (lastVersion === currentAppVersion()) return false;
    const lastAtRaw = await AsyncStorage.getItem(LAST_PROMPT_AT_KEY);
    if (!lastAtRaw) return true;
    return (Date.now() - Number(lastAtRaw)) / DAY_MS >= MIN_DAYS_BETWEEN_PROMPTS;
  } catch {
    return false;
  }
}

async function recordPromptAttempt(): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_PROMPT_AT_KEY, String(Date.now()));
    await AsyncStorage.setItem(LAST_PROMPT_VERSION_KEY, currentAppVersion());
  } catch {
    // best-effort
  }
}

/** Single entry point for every review-prompt trigger. `trigger` names the
 *  calling site (e.g. "log_meal", "weekly_insights_view") for the reader of that
 *  call; schema v1's store_review_prompt carries no fields, so it is not sent. */
export async function maybeRequestReview(trigger: string): Promise<void> {
  // Never let the native review sheet steal a store-screenshot capture.
  if (isScreenshotMode()) return;
  try {
    if (!(await meetsBaselineEligibility())) return;
    if (!(await canAttemptPrompt())) return;
    if (!(await StoreReview.isAvailableAsync())) return;
    // Record the attempt before requesting: the native API never reports
    // whether it actually showed, so this is the standard way to guarantee
    // the per-version/30-day caps above regardless of what iOS/Android did.
    await recordPromptAttempt();
    logEvent("store_review_prompt");
    await StoreReview.requestReview();
  } catch {
    // review unavailable; never block a user flow
  }
}

/** Call after each new log (glucose/insulin/meal). Counts it toward the
 *  log-count gate, then attempts a prompt through the same gateway. */
export async function noteLogAndMaybeReview(trigger: string): Promise<void> {
  await bumpLogCount();
  await maybeRequestReview(trigger);
}
