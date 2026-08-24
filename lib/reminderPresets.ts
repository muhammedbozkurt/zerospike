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
 */
export interface ReminderPreset {
  type: "glucose";
  /** "HH:MM", the exact format lib/db/reminders.ts stores and applyReminders
   *  parses. */
  time: string;
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
  return presetTimes(type).map((time) => ({ type: "glucose", time }));
}
