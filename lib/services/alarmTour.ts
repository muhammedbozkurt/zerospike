import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

/**
 * "Seen" flag for the one-time alarm tour (app/alarm-tour.tsx, 2.3.0's D).
 *
 * The tour exists for ONE audience: someone whose reminders were notifications
 * yesterday and ring as alarms today (schema v21's default change). A new
 * install is told the same thing inside onboarding and must never see it, which
 * is why completeOnboarding marks it seen (lib/store/AppContext.tsx) rather
 * than this file trying to compare versions to work out who is who.
 *
 * AsyncStorage, not app_meta: this is an interface "has been shown" flag, the
 * same kind as zerospike.widgetTipDismissed / zerospike.winbackShown, and it
 * belongs to the device rather than to any profile's data. The stored value is
 * the app version that showed it (the reviewLastPromptVersion pattern in
 * ./review.ts), so a future release that changes the delivery story again can
 * tell "never seen" from "seen, but back in 2.3.0".
 */

const ALARM_TOUR_KEY = "zerospike.alarmTourSeen";

function currentAppVersion(): string {
  return Constants.expoConfig?.version ?? "0.0.0";
}

/** Whether the tour has already been shown (or deliberately marked as not
 *  needed). Never throws: an unreadable flag reports "seen", so a storage
 *  failure can never turn the tour into something that opens on every launch. */
export async function hasSeenAlarmTour(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ALARM_TOUR_KEY)) != null;
  } catch {
    return true;
  }
}

/** Records that the tour is done with - written BEFORE the tour is pushed (see
 *  the winback pattern in app/_layout.tsx), so a crash or a force-quit inside
 *  it can never bring it back. */
export async function markAlarmTourSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(ALARM_TOUR_KEY, currentAppVersion());
  } catch {
    // best-effort; at worst the tour is offered once more
  }
}
