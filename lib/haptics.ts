import * as Haptics from "expo-haptics";

/**
 * Thin haptic-feedback wrappers. Every call is fire-and-forget and fully
 * guarded, so a device without a taptic engine (or any failure) never breaks
 * the surrounding flow.
 *
 *   success → log saved / item created
 *   warning → delete / Pro-gate / error
 *   select  → a discrete choice (site, point, segment/chip)
 */
function run(p: () => Promise<unknown>): void {
  try {
    p().catch(() => {});
  } catch {
    // haptics unavailable, ignore
  }
}

export function hapticSuccess(): void {
  run(() =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  );
}

export function hapticWarning(): void {
  run(() =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
  );
}

export function hapticSelect(): void {
  run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}
