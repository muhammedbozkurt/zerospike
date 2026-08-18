import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import { getWidgetInfo } from "react-native-android-widget";

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
    title: string,
    lastReading: string | null,
    unitLabel: string
  ): boolean;
  end(): void;
  isWidgetInstalled(): Promise<boolean | null>;
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
 * Shows (or updates) the post-meal countdown. `endsAt` is epoch ms, matching the
 * timer the notification service persists. Returns whether anything was shown.
 */
export function startPostMealActivity(options: {
  endsAt: number;
  title: string;
  lastReading?: string | null;
  unitLabel: string;
}): boolean {
  try {
    return (
      native?.start(
        options.endsAt,
        options.title,
        options.lastReading ?? null,
        options.unitLabel
      ) ?? false
    );
  } catch {
    return false;
  }
}

/** Ends the countdown (elapsed, cancelled, or the reading was logged early). */
export function endPostMealActivity(): void {
  try {
    native?.end();
  } catch {
    // best-effort; a stale activity expires on its own
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
