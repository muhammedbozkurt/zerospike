import type { DiabetesType } from "./db/types";

/**
 * The ready-made measurement reminder set offered ONCE, at the end of
 * onboarding (2.3.0's K2-E). Pure and dependency-free, like lib/alarmSelect.ts
 * and lib/postMealTimer.ts, so scripts/reminderPresets.test.ts runs it under
 * plain Node.
 *
 * WHAT THIS IS NOT: not a recommended testing frequency, not a schedule anyone
 * should follow, and never described as one on screen. It is a STARTING LAYOUT
 * the user previews, edits by removing lines, and can change or delete entirely
 * afterwards - the app is a logbook, and telling someone how often to measure
 * would be exactly the medical-device line it must never cross (see the hard
 * limits at the top of docs/plan-2.3.0.md). The screen that shows this never
 * names a diabetes type either: the type only decides how many neutral times a
 * day the layout starts with, and the copy frames the whole thing as "a ready
 * layout, change it however you like".
 *
 * Only GLUCOSE rows. A basal reminder is already owned by syncBasalReminderRow
 * (profile setup writes exactly one), and a medication reminder by onboarding's
 * own medReminder step; producing either here would mean two rows for one
 * intent.
 *
 * The busiest layout is four rows, so even together with a basal row and a
 * medication row it stays under MAX_REMINDERS (10, lib/db/reminders.ts).
 *
 * Every layout's times also land in DIFFERENT parts of the day (see
 * dayBucketOf): the rows are named after that, so two times sharing a bucket
 * would produce two rows with the same name. scripts/reminderPresets.test.ts
 * pins that for all five layouts.
 */
export interface ReminderPreset {
  type: "glucose";
  /** "HH:MM", the exact format lib/db/reminders.ts stores and applyReminders
   *  parses. */
  time: string;
  /** Which part of the day the time falls in. The screen turns this into the
   *  row's REAL name ("Morning glucose check"), so a three-line layout does not
   *  arrive as three rows all called "Glucose check" - see dayBucketOf. */
  bucket: DayBucket;
}

/**
 * The parts of the day a preset reminder can be named after. Plain clock
 * ranges, deliberately not tied to meals: naming a reminder "before breakfast"
 * would frame it as a measurement instruction, which this app does not give.
 *
 *   05:00-09:29  morning
 *   09:30-11:29  lateMorning
 *   11:30-13:59  midday
 *   14:00-17:59  afternoon
 *   18:00-21:59  evening
 *   22:00-04:59  night     (wraps past midnight)
 */
export type DayBucket =
  | "morning"
  | "lateMorning"
  | "midday"
  | "afternoon"
  | "evening"
  | "night";

/** Minutes since midnight, tolerant of a malformed string the same way
 *  parseHHMM in lib/services/notifications.ts is. */
function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  const hour = Number.isFinite(h) ? h : 0;
  const minute = Number.isFinite(m) ? m : 0;
  return hour * 60 + minute;
}

export function dayBucketOf(hhmm: string): DayBucket {
  const t = minutesOf(hhmm);
  if (t >= 5 * 60 && t <= 9 * 60 + 29) return "morning";
  if (t >= 9 * 60 + 30 && t <= 11 * 60 + 29) return "lateMorning";
  if (t >= 11 * 60 + 30 && t <= 13 * 60 + 59) return "midday";
  if (t >= 14 * 60 && t <= 17 * 60 + 59) return "afternoon";
  if (t >= 18 * 60 && t <= 21 * 60 + 59) return "evening";
  // 22:00 through 04:59, wrapping past midnight.
  return "night";
}

const FOUR_TIMES = ["07:30", "12:30", "18:30", "22:30"];
const GESTATIONAL = ["07:30", "10:00", "14:00", "20:30"];
const THREE_TIMES = ["08:00", "13:00", "21:00"];
const NEUTRAL_THREE = ["08:00", "13:00", "20:00"];

/** Times are plain points in the day, deliberately not tied to meals or to any
 *  clinical framing - neither here nor in the copy that renders them. */
function presetTimes(type: DiabetesType): string[] {
  switch (type) {
    case "type1":
      return FOUR_TIMES;
    case "gestational":
      return GESTATIONAL;
    case "type2":
      return THREE_TIMES;
    case "prediabetes":
    case "unknown":
    case "none":
    default:
      return NEUTRAL_THREE;
  }
}

export function presetFor(type: DiabetesType): ReminderPreset[] {
  return presetTimes(type).map((time) => ({
    type: "glucose",
    time,
    bucket: dayBucketOf(time),
  }));
}

/**
 * Exactly what "Set up this plan" writes, as data: one row per previewed time,
 * named after its part of the day.
 *
 * Split out of setUpReminderPlan (lib/services/reminderPlan.ts) so the shape of
 * the rows is pinned by scripts/reminderPresets.test.ts under plain Node - the
 * screen that offers this now exists twice (onboarding and profile setup), and
 * the two must produce identical rows for the first profile and the fifth.
 *
 * `alarmEnabled` is spelled out because this is the app arming a delivery on
 * the user's behalf. There is deliberately NO alarmUserSet field: that column
 * (schema v21) records that the USER chose a delivery, and walking through a
 * ready-made layout is not that choice - createReminder writes 0 for an absent
 * one, which is what keeps a later default change free to move these rows.
 */
export interface ReminderPlanRow {
  type: "glucose";
  time: string;
  label: string;
  enabled: true;
  alarmEnabled: true;
  /** The owner, carried EXPLICITLY rather than left to createReminder's
   *  active-profile fallback. The layout is offered on a screen that opens
   *  right after a profile switch, so "whichever profile is active when this
   *  row is inserted" is a moving target: a switch landing mid-write would
   *  file the rest of the layout under the wrong profile. */
  profileId?: string;
}

export function planRowsToWrite(
  rows: ReminderPreset[],
  labelFor: (bucket: DayBucket) => string,
  profileId?: string
): ReminderPlanRow[] {
  return rows.map((preset) => ({
    type: "glucose",
    time: preset.time,
    label: labelFor(preset.bucket),
    enabled: true,
    alarmEnabled: true,
    ...(profileId ? { profileId } : {}),
  }));
}

/**
 * Which of a profile's EXISTING rows the layout replaces: the measurement rows,
 * and only those.
 *
 * Replace, not merge - a user who removed 12:30 from the preview must not end
 * up with it anyway from an earlier attempt. The basal row
 * (syncBasalReminderRow), the medication row and anything custom belong to
 * other intents and are never touched; on a profile added later that matters
 * more than it did in onboarding, because those rows may well already exist.
 *
 * `profileId` is a second, independent lock on top of the caller already
 * having asked for one profile's rows: a DELETE takes a globally unique id, so
 * a list that turned out to hold another profile's rows (an active-profile
 * switch racing the read) would delete reminders belonging to someone the user
 * was not even editing. A row whose owner is unknown is left alone rather than
 * assumed to be ours.
 */
export function planRowsToReplace<
  T extends { id: string; type: string; profile_id?: string | null },
>(existing: readonly T[], profileId?: string): string[] {
  return existing
    .filter((r) => r.type === "glucose")
    .filter((r) => profileId == null || r.profile_id === profileId)
    .map((r) => r.id);
}
