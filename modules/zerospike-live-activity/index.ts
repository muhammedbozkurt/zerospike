import { requireOptionalNativeModule } from "expo-modules-core";

/**
 * JS side of the post-meal Live Activity.
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
