import * as StoreReview from "expo-store-review";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { logEvent } from "../analytics";

/**
 * Asks for a store review at most once in the app's lifetime, at a genuinely
 * positive moment: the 10th log OR the first time the weekly summary is viewed.
 * Uses the native in-app review prompt (which the OS may or may not surface), so
 * it never navigates the user away and never nags.
 */

const PROMPTED_KEY = "zerospike.reviewPrompted";
const LOGCOUNT_KEY = "zerospike.reviewLogCount";
const LOG_THRESHOLD = 10;

async function alreadyPrompted(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PROMPTED_KEY)) === "true";
  } catch {
    return false;
  }
}

async function promptOnce(): Promise<void> {
  if (await alreadyPrompted()) return;
  try {
    if (!(await StoreReview.hasAction())) return;
    // Flag before requesting: the native API never reports whether it showed,
    // so this is the standard way to guarantee a single lifetime prompt.
    await AsyncStorage.setItem(PROMPTED_KEY, "true");
    logEvent("review_prompted");
    await StoreReview.requestReview();
  } catch {
    // review unavailable; never block a user flow
  }
}

/** Call after each new log; prompts once when the 10th log is reached. */
export async function noteLogAndMaybeReview(): Promise<void> {
  if (await alreadyPrompted()) return;
  let count = 0;
  try {
    count = Number(await AsyncStorage.getItem(LOGCOUNT_KEY)) || 0;
  } catch {
    count = 0;
  }
  count += 1;
  try {
    await AsyncStorage.setItem(LOGCOUNT_KEY, String(count));
  } catch {
    // best-effort
  }
  if (count >= LOG_THRESHOLD) await promptOnce();
}

/** Call when the weekly summary is first viewed; prompts once. */
export async function maybeReviewOnWeeklyView(): Promise<void> {
  await promptOnce();
}
