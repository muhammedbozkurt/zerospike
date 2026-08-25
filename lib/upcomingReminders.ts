import { reminderDelivery } from "./alarmSelect";
import type { ReminderType } from "./db/types";

/**
 * What the next 24 hours actually hold (2.3.0's K2-A), computed from the
 * reminders TABLE rather than from the OS queues.
 *
 * Pure and dependency-free, exactly like lib/postMealTimer.ts and
 * lib/alarmSelect.ts, so scripts/upcomingReminders.test.ts can exercise it
 * under plain Node: every input - the rows, the clock, the gates, the AlarmKit
 * facts, the running post-meal window - is resolved by the caller.
 *
 * WHY THE TABLE, not getAllScheduledNotificationsAsync() + listScheduledAlarmIds():
 *  - listScheduledAlarmIds() returns identities only, with no fire time
 *    (modules/zerospike-alarmkit), so an alarm row's moment cannot be read
 *    back from it at all;
 *  - the shape a DAILY expo trigger reads back as differs per platform, so the
 *    same screen would need re-normalizing twice to look the same on both;
 *  - the table is already applyReminders' single source of truth, and deriving
 *    this list from the SAME rows with the SAME gates means the screen and the
 *    real delivery cannot drift into two different truths;
 *  - a pure computation is testable off-device.
 *
 * The consequence is stated openly in the UI: this is the schedule the app has
 * SET UP, not a readout of the OS queue. An OS that dropped a notification is
 * not visible here (the reliability card on the same screen covers that).
 */

/** The subset of a reminders row this computation needs. A real `Reminder`
 *  (lib/db/types.ts) satisfies it structurally, so callers pass rows straight
 *  through and tests build small literals. */
export interface UpcomingReminderRow {
  id: string;
  type: ReminderType;
  label: string | null;
  time: string;
  enabled: number;
  alarm_enabled: number;
}

export interface UpcomingItem {
  kind: "reminder" | "postMeal";
  /** The reminder row's id, or "postMeal" for the running countdown. */
  id: string;
  /** Epoch ms of the next delivery. */
  at: number;
  /** How it will be delivered, from the same decision applyReminders arms
   *  with - never from the stored column alone. */
  mode: "alarm" | "notification";
  /** Reminder rows only: what kind of reminder it is, so the caller can name
   *  it with the copy it already has. */
  type?: ReminderType;
  /** Reminder rows only: the user's own text, when they gave one. */
  label?: string | null;
}

export interface UpcomingInput {
  rows: readonly UpcomingReminderRow[];
  now: number;
  /** How far ahead to look. A day on the reminders screen - see the DST note
   *  on `horizonOf` below for why "a day" is not always 24 hours. */
  windowMs: number;
  /** NotificationPrefs.enabled - the app's own master switch. The user's own
   *  "no", so it empties the reminder side on its own. */
  masterEnabled: boolean;
  /** getNotificationPermission() === "granted". Since K3-2 this no longer
   *  empties the list by itself: a row set to ring as an ALARM is delivered by
   *  AlarmKit and does not need it, so the two facts are now applied per row,
   *  per mechanism (see reminderDelivery in ./alarmSelect.ts). */
  notificationPermission: boolean;
  /** The active profile's basal / oral-meds visibility gates, exactly as
   *  applyReminders applies them. */
  showsBasal: boolean;
  showsMeds: boolean;
  alarmKitAvailable: boolean;
  alarmAuthorized: boolean;
  /** End of a RUNNING post-meal window, or null when none is counting down. */
  postMealEndsAt?: number | null;
  /** The post-meal delivery preference (NotificationPrefs.postMealAlarm), used
   *  for that one item's own mode. */
  postMealAlarm?: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How far ahead to actually look.
 *
 * For the day-long window the screen uses, the horizon is "this time tomorrow"
 * on the WALL CLOCK, reached by advancing the date - not by adding 24 hours.
 * On the night a DST change gives back an hour, a fixed 24 hours reaches an
 * hour PAST tomorrow's same time and a reminder set for that hour appears
 * twice: once for today and once for tomorrow. Every shorter window (the tests
 * use a few hours) stays plain arithmetic, where no date boundary is involved.
 */
function horizonOf(now: number, windowMs: number): number {
  if (windowMs !== DAY_MS) return now + windowMs;
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

/**
 * The next moment a daily "HH:MM" reminder fires, at or after `now`.
 *
 * A time that has already passed today moves to tomorrow by advancing the DATE
 * (not by adding 24 hours), so a DST boundary keeps the wall-clock time the
 * user chose. A time landing exactly on `now` counts as passed: this list is
 * "what is coming", and a moment that has arrived is no longer ahead.
 */
export function nextOccurrenceAt(hhmm: string, now: number): number {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  const hour = Number.isFinite(h) ? h : 0;
  const minute = Number.isFinite(m) ? m : 0;
  const d = new Date(now);
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/**
 * Everything the user can expect within `windowMs`, soonest first.
 *
 * Scope is deliberately narrow: reminder rows the user set up, plus a running
 * post-meal countdown. The weekly summary, the empty-journal nudge and the
 * trial notice are the app's own status messages rather than reminders anyone
 * set, and the low-reading follow-up is value-triggered - listing that one as
 * an "upcoming alarm" would blur exactly the line this app is not allowed to
 * blur (see the hard limits at the top of docs/plan-2.3.0.md).
 *
 * Since K3-2 the post-meal item goes through the SAME per-row delivery
 * decision as the rows: the master switch takes it down with everything else,
 * while a missing notification permission only takes it down when it is not
 * set to ring as an alarm.
 */
/**
 * Just the next thing, or null when there is none (2.3.0's G18).
 *
 * The dashboard shows ONE line, so it asks for one item rather than taking a
 * whole list and dropping all but its head - and it gets the same gates,
 * ordering and delivery decision the reminders screen uses, because it is the
 * same computation.
 */
export function nextUpcoming(input: UpcomingInput): UpcomingItem | null {
  return buildUpcoming(input)[0] ?? null;
}

export function buildUpcoming(input: UpcomingInput): UpcomingItem[] {
  const {
    rows,
    now,
    windowMs,
    masterEnabled,
    notificationPermission,
    showsBasal,
    showsMeds,
    alarmKitAvailable,
    alarmAuthorized,
    postMealEndsAt,
    postMealAlarm = false,
  } = input;
  const until = horizonOf(now, windowMs);
  const items: UpcomingItem[] = [];

  for (const row of rows) {
    // The SAME per-row, per-mechanism decision applyReminders arms from, so
    // this list can never show a reminder the scheduler is not arming (or hide
    // one it is): an alarm-mode row survives a missing notification permission,
    // a notification-mode row does not.
    const delivery = reminderDelivery({
      masterEnabled,
      rowEnabled: row.enabled === 1,
      visibilityGateOpen:
        row.type === "basal" ? showsBasal : row.type === "med" ? showsMeds : true,
      alarmEnabled: row.alarm_enabled === 1,
      alarmKitAvailable,
      alarmAuthorized,
      notificationPermission,
    });
    if (delivery === "none") continue;
    const at = nextOccurrenceAt(row.time, now);
    if (!Number.isFinite(at) || at > until) continue;
    items.push({
      kind: "reminder",
      id: row.id,
      at,
      mode: delivery,
      type: row.type,
      label: row.label,
    });
  }

  if (postMealEndsAt != null && postMealEndsAt > now && postMealEndsAt <= until) {
    // The running countdown follows the same rule, minus the row flags: it is
    // the app's own timer, already armed, so only the master switch and its own
    // delivery decide whether it can still reach the user.
    const delivery = reminderDelivery({
      masterEnabled,
      rowEnabled: true,
      visibilityGateOpen: true,
      alarmEnabled: postMealAlarm,
      alarmKitAvailable,
      alarmAuthorized,
      notificationPermission,
    });
    if (delivery !== "none") {
      items.push({ kind: "postMeal", id: "postMeal", at: postMealEndsAt, mode: delivery });
    }
  }

  // Ties broken by id so the order is stable across re-renders (two reminders
  // can genuinely share a time).
  return items.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}
