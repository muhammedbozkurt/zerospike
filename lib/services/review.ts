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
 * positive moment itself. "trial_converted" is asked right after the thank-you
 * sheet has been closed with Continue or the close button; a tap on one of the
 * sheet's cards leaves for another screen and asks nothing (and so writes no
 * stamp). It follows its own rule (see canAttemptConversionPrompt) instead of
 * the caps below.
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
const STREAK_7_DONE_KEY = "zerospike.reviewStreak7Done";
const STREAK_TARGET = 7;

export type ReviewTrigger =
  | "log_saved"
  | "streak_7"
  | "weekly_insights_view"
  | "pdf_export_success"
  | "trial_converted";

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_DAYS_SINCE_FIRST_SEEN = 3;
const MIN_LOG_COUNT = 5;
const MIN_DAYS_BETWEEN_PROMPTS = 30;
const MIN_DAYS_BETWEEN_CONVERSION_PROMPTS = 365;

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

/**
 * "trial_converted" is its own moment (the user just chose to pay), so it does
 * not wait for the usage baseline or the per-version cap. It asks for something
 * stricter instead: nothing in the last 365 days, counting every trigger,
 * because it reads the shared last-prompt stamp. An unreadable or future-dated
 * stamp (clock moved back) blocks it.
 */
async function canAttemptConversionPrompt(): Promise<boolean> {
  try {
    const lastAtRaw = await AsyncStorage.getItem(LAST_PROMPT_AT_KEY);
    if (!lastAtRaw) return true;
    const lastAt = Number(lastAtRaw);
    if (!Number.isFinite(lastAt)) return false;
    return (Date.now() - lastAt) / DAY_MS >= MIN_DAYS_BETWEEN_CONVERSION_PROMPTS;
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
 *  calling site (e.g. "log_saved", "weekly_insights_view") for the reader of that
 *  call and is reported on store_review_prompt. Resolves true only when the
 *  native request was actually attempted. */
// Synchronous guard: two concurrent triggers must not both pass the caps
// before either has recorded its attempt.
let inFlight = false;

export async function maybeRequestReview(trigger: ReviewTrigger): Promise<boolean> {
  // Never let the native review sheet steal a store-screenshot capture.
  if (isScreenshotMode()) return false;
  if (inFlight) return false;
  inFlight = true;
  try {
    if (trigger === "trial_converted") {
      if (!(await canAttemptConversionPrompt())) return false;
    } else {
      if (!(await meetsBaselineEligibility())) return false;
      if (!(await canAttemptPrompt())) return false;
    }
    if (!(await StoreReview.isAvailableAsync())) return false;
    // Record the attempt before requesting: the native API never reports
    // whether it actually showed, so this is the standard way to guarantee
    // the per-version/30-day caps above regardless of what iOS/Android did.
    await recordPromptAttempt();
    logEvent("store_review_prompt", { trigger });
    await StoreReview.requestReview();
    return true;
  } catch {
    return false;
  } finally {
    inFlight = false;
  }
}

/** Counts a saved log toward the log-count gate without prompting, for call
 *  sites that must hold the prompt back while another sheet is up. */
export async function noteLog(): Promise<void> {
  await bumpLogCount();
}

export async function noteLogAndMaybeReview(): Promise<void> {
  await noteLog();
  await maybeRequestReview("log_saved");
}

/** True only on the save that lifts the streak from below 7 to 7 or more. */
export function crossedStreak7(before: number, after: number): boolean {
  return before < STREAK_TARGET && after >= STREAK_TARGET;
}

/** The once-flag is spent only when the gateway really attempted a prompt; a
 *  crossing blocked by the baseline caps gets no new chance until the streak
 *  breaks and reaches 7 again. */
export async function noteStreakAndMaybeReview(streak: number): Promise<void> {
  if (streak < STREAK_TARGET) return;
  try {
    if (await AsyncStorage.getItem(STREAK_7_DONE_KEY)) return;
    if (await maybeRequestReview("streak_7")) {
      await AsyncStorage.setItem(STREAK_7_DONE_KEY, "1");
    }
  } catch {
    // best-effort
  }
}

/** Store write-review URL from app.json (never hardcoded). Null when the
 *  config carries no store id/package, so the caller can stay inert. */
export function writeReviewUrl(platform: string): string | null {
  const cfg = Constants.expoConfig;
  if (platform === "android") {
    const pkg = cfg?.android?.package;
    return pkg ? `https://play.google.com/store/apps/details?id=${pkg}` : null;
  }
  const base = StoreReview.storeUrl();
  if (!base) return null;
  return `${base}${base.includes("?") ? "&" : "?"}action=write-review`;
}
