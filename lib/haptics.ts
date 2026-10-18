import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * The only module that talks to expo-haptics. Every call is fire-and-forget,
 * fully guarded, and gated on the Settings > App "Haptic feedback" switch, so a
 * device without a taptic engine (or any failure) never breaks the flow.
 *
 *   success → log saved / item created / plan ready / a timer that ran out
 *   warning → delete / Pro-gate / error
 *   select  → a discrete choice (site, point, segment/chip, option card)
 *   light   → moving on to the next step
 *
 * Reduce Motion does not touch these: it only switches animations off.
 */
const KEY = "zerospike.haptics";

// Synchronous cache so a tap never waits on storage. Off until the stored
// answer arrives (first read starts at import), so a user who turned it off
// never feels a buzz in the cold-start window.
let enabled = false;
let touched = false;

const ready: Promise<void> = AsyncStorage.getItem(KEY)
  .then((v) => {
    if (!touched) enabled = v !== "0";
  })
  .catch(() => {
    if (!touched) enabled = true;
  });

export function getHapticsEnabled(): Promise<boolean> {
  return ready.then(() => enabled);
}

export async function setHapticsEnabled(on: boolean): Promise<void> {
  touched = true;
  enabled = on;
  try {
    await AsyncStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // the cache still holds for this run
  }
}

function run(p: () => Promise<unknown>): void {
  if (!enabled) return;
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
  run(() => Haptics.selectionAsync());
}

export function hapticLight(): void {
  run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}
