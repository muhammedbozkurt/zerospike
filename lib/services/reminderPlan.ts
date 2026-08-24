import {
  countReminders,
  createReminder,
  deleteReminder,
  listReminders,
  MAX_REMINDERS,
} from "../db/reminders";
import { requestNotificationPermission } from "./notifications";
import {
  getAlarmAuthorizationStatus,
  isAlarmKitAvailable,
  requestAlarmAuthorization,
} from "../../modules/zerospike-alarmkit";
import {
  planRowsToReplace,
  planRowsToWrite,
  type DayBucket,
  type ReminderPreset,
} from "../reminderPresets";

/**
 * The ready-made measurement layout, as an ACTION rather than a screen: one
 * definition of what "Set up this plan" does, shared by the onboarding step
 * (app/onboarding.tsx) and by the second-profile setup screen
 * (app/profile-setup.tsx).
 *
 * It lives here rather than in either screen because the two must not drift:
 * a profile added later got no layout at all and was never asked for the alarm
 * permission, so the first profile rang as alarms while the second silently did
 * not - a difference nobody could see or fix from any screen. The preview UI
 * itself is shared the same way, see components/ReminderPlanPreview.tsx.
 *
 * What this deliberately is NOT: a recommended testing frequency. See the long
 * note at the top of lib/reminderPresets.ts - the rows are a starting layout the
 * user previews, prunes and can delete afterwards.
 */

/** At most one AlarmKit prompt per app RUN, wherever it is asked from. Module
 *  scope, not a screen's ref: onboarding and profile setup are two different
 *  components (and, for the second profile, two different sessions of the same
 *  screen), and a per-component flag let the same dialog be raised twice in a
 *  row by a user who set up a medication reminder and then a measurement
 *  layout. Across LAUNCHES the OS itself is the lock - a status that is no
 *  longer "notDetermined" is never asked again below. */
let alarmAsked = false;

/**
 * Raises the AlarmKit dialog once, and only where it can mean something: no
 * AlarmKit (Android, iOS < 26, unlinked module) and an already-answered
 * permission both return without prompting.
 *
 * Callers are expected to have written a real reminder row first - the dialog
 * is meaningless before there is something for it to ring - and it never
 * blocks or throws out: a refusal simply leaves the reminder arriving as a
 * notification, which the row's own badge in Settings > Reminders can ask
 * about again whenever the user wants.
 */
export async function ensureAlarmAuthorizationOnce(): Promise<void> {
  if (alarmAsked) return;
  alarmAsked = true;
  try {
    if (!isAlarmKitAvailable()) return;
    if (getAlarmAuthorizationStatus() !== "notDetermined") return;
    await requestAlarmAuthorization();
  } catch {
    // best-effort; the reminder still exists either way
  }
}

/** Why a setup finished the way it did. "limit" and "failed" used to be the
 *  same `false`, which meant a full reminder list and a database error showed
 *  the user the same message - one of which they can act on and one of which
 *  they cannot. */
export type ReminderPlanOutcome =
  /** Every previewed row was written. */
  | "written"
  /** This profile's list is at (or reached) MAX_REMINDERS, so some or all of
   *  the layout had nowhere to go. `written` says which. */
  | "limit"
  /** Something else went wrong; nothing can be promised about what landed. */
  | "failed";

export interface ReminderPlanResult {
  outcome: ReminderPlanOutcome;
  /** How many rows actually reached the table. */
  written: number;
}

/**
 * Writes the previewed layout to `profileId` (falling back to the active
 * profile), then asks for the two permissions - notification first, alarm
 * right after. The order matters: the dialogs are only meaningful once rows
 * actually exist, which is also why a caller's "Not now" path must simply not
 * call this at all rather than call it with an empty list.
 *
 * `profileId` is passed explicitly all the way down (list, replace, insert)
 * rather than resolved per-call from the active profile: this runs on a screen
 * that opens right after a profile switch, and a second switch landing between
 * two of the awaits below would otherwise split one layout across two
 * profiles, or delete rows belonging to neither.
 *
 * REPLACES rather than merges: that profile's existing measurement rows are
 * deleted first, so a user who removed 12:30 from the preview does not end up
 * with it anyway from an earlier, abandoned attempt. Only `glucose` rows are
 * touched - the basal row (syncBasalReminderRow), the medication row and
 * anything custom belong to other intents and are left exactly as they are.
 *
 * The cap is checked BEFORE writing rather than discovered by letting
 * createReminder throw: a partial layout plus a thrown error cannot be told
 * apart from a broken database, and the caller needs to say which happened.
 */
export async function setUpReminderPlan(
  rows: ReminderPreset[],
  labelFor: (bucket: DayBucket) => string,
  profileId?: string
): Promise<ReminderPlanResult> {
  let written = 0;
  try {
    const existing = await listReminders(profileId);
    for (const id of planRowsToReplace(existing, profileId)) {
      await deleteReminder(id);
    }
    const wanted = planRowsToWrite(rows, labelFor, profileId);
    const room = Math.max(0, MAX_REMINDERS - (await countReminders(profileId)));
    for (const row of wanted.slice(0, room)) {
      await createReminder(row);
      written++;
    }
    if (written > 0) {
      await requestNotificationPermission();
      await ensureAlarmAuthorizationOnce();
    }
    return { outcome: written < wanted.length ? "limit" : "written", written };
  } catch {
    // Settings > Reminders is always there to try again, but the caller has to
    // be able to SAY that rather than show the "list is full" message.
    return { outcome: "failed", written };
  }
}
