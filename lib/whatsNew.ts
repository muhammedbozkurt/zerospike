/**
 * Pure rules behind the one-time "What's new" sheet (components/WhatsNewSheet):
 * who counts as an updater, when the sheet may open, and the once-only flag.
 * Dependency-free so scripts/whatsNew.test.ts runs under plain node; the storage
 * and the sheet live in ./whatsNewStore and components/WhatsNewSheet.
 *
 * There is no install date in the app. The flag holds the app version that last
 * saw (or was never owed) the sheet, and completeOnboarding stamps it, so:
 * a flag that is absent on an onboarded user means "installed before this
 * feature existed" (an update); a fresh install gets the flag the moment its
 * onboarding ends and is never shown the sheet.
 */

import type { KeyValueStore } from "./feedbackSurvey";

/** The release (major.minor) whose changes the sheet describes. */
export const WHATS_NEW_RELEASE = "2.4";

/** Value: the app version at the time the sheet was shown or was ruled out. */
export const WHATS_NEW_SEEN_KEY = "zerospike.whatsNew.seen";

/** Settle time after landing on a tab screen before the sheet opens. */
export const WHATS_NEW_DELAY_MS = 3000;

/** The four lines, in order; each is an i18n key under whatsNew. */
export const WHATS_NEW_ITEMS = [
  "whatsNew.itemTheme",
  "whatsNew.itemBodyMap",
  "whatsNew.itemMeal",
  "whatsNew.itemSpike",
] as const;

/** "2.4.1" or "2.4" to [2, 4]; null for anything that is not a version. */
export function parseRelease(version: string | null | undefined): [number, number] | null {
  if (!version) return null;
  const m = /^(\d{1,4})\.(\d{1,4})(?:\.\d{1,6})?(?:[-+][0-9A-Za-z.+-]*)?$/.exec(version.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2])];
}

function releaseAtLeast(v: [number, number], min: [number, number]): boolean {
  return v[0] > min[0] || (v[0] === min[0] && v[1] >= min[1]);
}

const TARGET = parseRelease(WHATS_NEW_RELEASE) as [number, number];

export interface WhatsNewDueInput {
  onboarded: boolean;
  appVersion: string;
  /** The stored flag, null when absent. */
  seen: string | null;
}

/**
 * True for an already-onboarded user running this release or later whose flag is
 * absent or older than the release. An unreadable flag value counts as seen:
 * showing nothing is the safe failure.
 */
export function whatsNewDue(i: WhatsNewDueInput): boolean {
  if (!i.onboarded) return false;
  const app = parseRelease(i.appVersion);
  if (!app || !releaseAtLeast(app, TARGET)) return false;
  if (i.seen === null) return true;
  const seen = parseRelease(i.seen);
  if (!seen) return false;
  return !releaseAtLeast(seen, TARGET);
}

export interface WhatsNewGate {
  ready: boolean;
  onboarded: boolean;
  screenshotMode: boolean;
  /** Top route segment. */
  root: string | undefined;
  /** The winback is deciding or showing. */
  winbackHold: boolean;
  /** The cancellation survey is armed, open, or was shown this session. */
  surveyBusy: boolean;
}

/** Only on the tab screens: never over onboarding, paywall, SOS or any modal route. */
export function isWhatsNewRoute(root: string | undefined): boolean {
  return root === "(tabs)";
}

export function whatsNewMayPresent(g: WhatsNewGate): boolean {
  return (
    g.ready &&
    g.onboarded &&
    !g.screenshotMode &&
    !g.winbackHold &&
    !g.surveyBusy &&
    isWhatsNewRoute(g.root)
  );
}

/** Stamps the flag with the running version (or the release when the version is unreadable). */
export async function markWhatsNewSeen(kv: KeyValueStore, appVersion: string): Promise<void> {
  try {
    await kv.set(WHATS_NEW_SEEN_KEY, parseRelease(appVersion) ? appVersion.trim() : WHATS_NEW_RELEASE);
  } catch {
    // best-effort; the worst case is one extra sheet for a new install
  }
}

/**
 * Takes the sheet: true at most once per install. The flag is written before the
 * answer is returned, so an interrupted sheet does not come back.
 */
export async function takeWhatsNew(
  kv: KeyValueStore,
  input: { onboarded: boolean; appVersion: string }
): Promise<boolean> {
  try {
    const seen = await kv.get(WHATS_NEW_SEEN_KEY);
    if (!whatsNewDue({ ...input, seen })) return false;
    await markWhatsNewSeen(kv, input.appVersion);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the survey stands in the way. Reads pending before asked: the survey
 * writes asked first and clears pending second, so a survey that slipped in
 * between the two reads still shows up as asked.
 */
export async function surveyInTheWay(
  kv: KeyValueStore,
  askedAtStart: boolean,
  keys: { pending: string; asked: string }
): Promise<boolean> {
  try {
    if ((await kv.get(keys.pending)) === "true") return true;
    const asked = (await kv.get(keys.asked)) === "true";
    return asked && !askedAtStart;
  } catch {
    return true;
  }
}
