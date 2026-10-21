import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import { getWidgetInfo } from "react-native-android-widget";
import { parseFatalReport, type FatalReport } from "../../lib/fatalReport";

/**
 * JS side of the post-meal Live Activity (and, since 2.1.0, the small "is a
 * widget actually installed" query the dashboard's setup row reads).
 *
 * `requireOptionalNativeModule` returns null in Expo Go and in any build made
 * before `npx expo prebuild` linked the module, so every call below is a no-op
 * there. That is deliberate: the lock-screen countdown is a convenience, and
 * losing it must never stop a meal from being logged.
 */
interface LiveActivityNativeModule {
  isAvailable(): boolean;
  start(
    endsAtMs: number,
    startedAtMs: number,
    title: string,
    lastReading: string | null,
    unitLabel: string
  ): Promise<boolean>;
  update(lastReading: string | null, unitLabel: string): Promise<boolean>;
  end(): Promise<void>;
  isWidgetInstalled(): Promise<boolean | null>;
  getLastFatalReport?(): string | null;
  clearLastFatalReport?(): boolean;
}

/**
 * ONE queue for every activity call (K3-6).
 *
 * ActivityKit's own start/update/end are async, and the module used to fire
 * them from detached Tasks and return immediately - so a start-end-start
 * sequence (log a meal, cancel it, log another) reached ActivityKit in
 * whatever order those tasks happened to finish in. The observable failure was
 * a cancelled countdown left on the lock screen, or a fresh one that never
 * appeared because a stale `end` landed after it.
 *
 * The native side now awaits properly; this chain is the other half, so the
 * ORDER those awaited calls are issued in is the order the caller wrote them.
 * Every link swallows its own failure, so one bad call can never wedge the
 * queue for the rest of the session.
 */
let activityQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  const next = activityQueue.then(work, work).catch(() => fallback);
  activityQueue = next;
  return next;
}

const native = requireOptionalNativeModule<LiveActivityNativeModule>(
  "ZerospikeLiveActivity"
);

/** True only when the OS supports Live Activities AND the user allows them. */
export function isLiveActivityAvailable(): boolean {
  try {
    return native?.isAvailable() ?? false;
  } catch {
    return false;
  }
}

/**
 * Shows (or updates) the post-meal countdown. `endsAt` / `startedAt` are epoch
 * ms, matching the timer the notification service persists - both ride along
 * so the native side can render a bounded `timerInterval` (freezes at 0:00)
 * instead of an open-ended one (counts up past it). Returns whether anything
 * was shown.
 */
export function startPostMealActivity(options: {
  endsAt: number;
  startedAt: number;
  title: string;
  lastReading?: string | null;
  unitLabel: string;
}): Promise<boolean> {
  return enqueue(
    async () =>
      (await native?.start(
        options.endsAt,
        options.startedAt,
        options.title,
        options.lastReading ?? null,
        options.unitLabel
      )) ?? false,
    false
  );
}

/**
 * Refreshes the reading on a RUNNING countdown without moving its end (K3-1).
 *
 * Never starts one: a glucose reading is not a meal, and the countdown has
 * exactly two deliberate sources (see schedulePostMealReminder). Resolves false
 * when nothing is running, which is the normal case.
 */
export function updatePostMealActivityReading(options: {
  lastReading?: string | null;
  unitLabel: string;
}): Promise<boolean> {
  return enqueue(
    async () =>
      (await native?.update(options.lastReading ?? null, options.unitLabel)) ?? false,
    false
  );
}

/** Ends the countdown (elapsed, cancelled, or the reading was logged early).
 *  Returns a promise so a caller that is about to arm a NEW countdown can wait
 *  for the teardown; the existing fire-and-forget callers are unaffected. */
export function endPostMealActivity(): Promise<void> {
  return enqueue(async () => {
    await native?.end();
  }, undefined);
}

/**
 * The fatal report the native uncaught-exception hook left on the device on
 * the previous run (see lib/fatalReport.ts for the shape), or null. Optional
 * methods: a binary built before the hook existed simply has none.
 */
export function getLastFatalReport(): FatalReport | null {
  try {
    return parseFatalReport(native?.getLastFatalReport?.() ?? null);
  } catch {
    return null;
  }
}

/** Deletes the stored report; true when nothing is left on the device. */
export function clearLastFatalReport(): boolean {
  try {
    return native?.clearLastFatalReport?.() ?? false;
  } catch {
    return false;
  }
}

/** Mirrors ANDROID_WIDGET_NAME / ANDROID_QUICK_ADD_WIDGET_NAME in
 *  lib/services/liveData.ts (not imported from here: that file is a separate,
 *  in-flight surface this change stays out of). Either one placed counts as
 *  "the user has a zerospike widget". */
const ANDROID_GLANCE_WIDGET = "Zerospike";
const ANDROID_QUICK_ADD_WIDGET = "ZerospikeQuickAdd";

/**
 * Whether a zerospike widget (the glucose summary/glance widget or Quick Add,
 * home screen or - on iOS - Lock Screen too) is currently placed anywhere on
 * the device.
 *
 * `undefined` when this cannot be determined: no native module (Expo Go, or a
 * build before prebuild linked it), or a query error. The dashboard's setup
 * row treats that as "not checked yet" and stays neutral, never flips to "not
 * installed" on a false negative.
 */
export async function isWidgetInstalled(): Promise<boolean | undefined> {
  if (Platform.OS === "android") {
    try {
      const [glance, quickAdd] = await Promise.all([
        getWidgetInfo(ANDROID_GLANCE_WIDGET),
        getWidgetInfo(ANDROID_QUICK_ADD_WIDGET),
      ]);
      return glance.length > 0 || quickAdd.length > 0;
    } catch {
      return undefined;
    }
  }
  try {
    return (await native?.isWidgetInstalled()) ?? undefined;
  } catch {
    return undefined;
  }
}
