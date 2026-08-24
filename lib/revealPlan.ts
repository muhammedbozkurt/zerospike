import { alarmModeOf } from "./alarmSelect";
import type { ReminderType } from "./db/types";

/**
 * What onboarding's closing screen actually promises (2.3.0's G13).
 *
 * The reveal used to print three fixed lines - post-meal tracking, low-reading
 * follow-up, night insulin - which stopped being true the moment setup started
 * creating real reminder rows: a user who had just accepted a four-time
 * measurement layout saw no mention of it, and someone who chose "Not now" saw
 * the same card as someone who had set everything up. This builds the card from
 * the rows that were REALLY written, so the screen can only ever describe what
 * exists.
 *
 * ONE LINE PER ROW, not one per type: since the preset rows carry their own
 * names (Morning glucose check, Midday glucose check - see lib/reminderPresets),
 * collapsing them into "Glucose check, 08:00, 13:00, 21:00" would throw away
 * exactly the naming that makes the list readable.
 *
 * Pure and dependency-free, like lib/alarmSelect.ts and lib/postMealTimer.ts:
 * the caller resolves the rows, the preferences and the AlarmKit facts, and
 * scripts/revealPlan.test.ts runs it under plain Node. It owns no copy either -
 * kinds, names and times come out, the screen turns them into localized text.
 */

/** The subset of a reminders row this needs; a real `Reminder` satisfies it. */
export interface RevealPlanRow {
  id: string;
  type: ReminderType;
  label: string | null;
  time: string;
  enabled: number;
  alarm_enabled: number;
}

export type RevealPlanKind =
  /** A reminder row the user now has. */
  | "glucose"
  | "med"
  | "basal"
  /** App behaviours with no fixed time of their own. */
  | "postMeal"
  | "lowFollowup";

export interface RevealPlanItem {
  kind: RevealPlanKind;
  /** Stable React key: the row id, or the kind for the two behaviours. */
  id: string;
  /** The row's own name when it has one (every preset row does). null falls
   *  back to the type's generic name on screen. */
  label: string | null;
  /** "HH:MM", or null for the two items that are not reminder rows. */
  time: string | null;
  /** How this reminder will be DELIVERED, from the same three-way AND
   *  applyReminders arms with - so a device that cannot ring an alarm never
   *  claims one here. null for the two items that are not reminder rows. */
  mode: "alarm" | "notification" | null;
  /** The post-meal window, in minutes; only ever set on that item. */
  minutes?: number;
}

/** The order the card lists things in: the user's own reminders first, most
 *  specific first, then the two behaviours that just run. */
const REMINDER_KINDS: readonly Extract<
  RevealPlanKind,
  "glucose" | "med" | "basal"
>[] = ["glucose", "med", "basal"];

export function buildRevealPlan(input: {
  rows: readonly RevealPlanRow[];
  /** NotificationPrefs.postMeal / .lowFollowup, as they will be saved. */
  postMeal: boolean;
  lowFollowup: boolean;
  /** The fixed post-meal window (POST_MEAL_WINDOW_MIN), so the line can name
   *  it without this module importing anything. */
  postMealMinutes?: number;
  alarmKitAvailable: boolean;
  alarmAuthorized: boolean;
}): RevealPlanItem[] {
  const { rows, alarmKitAvailable, alarmAuthorized } = input;
  const items: RevealPlanItem[] = [];

  for (const kind of REMINDER_KINDS) {
    // Disabled rows are not part of what was set up: syncBasalReminderRow keeps
    // a basal row and merely turns it off for a user who says they take no
    // insulin, and that user must not be told about a night reminder.
    const group = rows
      .filter((r) => r.type === kind && r.enabled === 1)
      .sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
    for (const row of group) {
      items.push({
        kind,
        id: row.id,
        label: row.label && row.label.trim() ? row.label : null,
        time: row.time,
        mode: alarmModeOf({
          alarmEnabled: row.alarm_enabled === 1,
          alarmKitAvailable,
          alarmAuthorized,
        }),
      });
    }
  }

  // Custom reminders are deliberately not listed: nothing can create one before
  // setup is finished, so a line for them could only ever be empty.

  if (input.postMeal) {
    items.push({
      kind: "postMeal",
      id: "postMeal",
      label: null,
      time: null,
      mode: null,
      ...(input.postMealMinutes != null ? { minutes: input.postMealMinutes } : {}),
    });
  }
  if (input.lowFollowup) {
    items.push({
      kind: "lowFollowup",
      id: "lowFollowup",
      label: null,
      time: null,
      mode: null,
    });
  }

  return items;
}
