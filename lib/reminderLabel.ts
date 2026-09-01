import type { ReminderType } from "./db/types";

/**
 * The name a reminder is saved with, from whatever the edit sheet is holding
 * (components/ReminderEditSheet.tsx).
 *
 * Pure and dependency-free so scripts/reminderLabel.test.ts can pin the one
 * property that broke in 2.3.0: opening a row to change its TIME and saving it
 * back must never erase its NAME. The sheet used to read the label for two
 * types and write it for the same two, so a measurement row created by the
 * ready-made layout ("Morning glucose check") came back from any save as
 * `null` - the rename the layout promises, undone by the screen that offers it.
 *
 * A blank field is a deliberate null: that is what makes a row show its plain
 * type name again, and it must stay possible.
 */
export interface ReminderLabelFields {
  /** Required for a custom reminder, so it always has something to be called. */
  custom: string;
  /** Optional; blank means "just call it Medication". */
  med: string;
  /** Optional; blank means "just call it Glucose check". */
  glucose: string;
}

export function resolveReminderLabel(
  type: ReminderType,
  fields: ReminderLabelFields
): string | null {
  switch (type) {
    case "custom":
      return fields.custom.trim() || null;
    case "med":
      return fields.med.trim() || null;
    case "glucose":
      return fields.glucose.trim() || null;
    // Basal is the one singleton type with no per-row name: its copy comes from
    // i18n on every surface (see reminderRowLabel in app/settings/reminders.tsx).
    case "basal":
    default:
      return null;
  }
}

/**
 * What the sheet should start with when it opens on an existing row: the row's
 * OWN name goes into the field for its own type, and every other field starts
 * blank. Splitting this out is what keeps "load" and "save" reading the same
 * list of types - the two drifting apart is exactly how the name was lost.
 */
export function reminderLabelFields(
  type: ReminderType,
  label: string | null
): ReminderLabelFields {
  const value = label ?? "";
  return {
    custom: type === "custom" ? value : "",
    med: type === "med" ? value : "",
    glucose: type === "glucose" ? value : "",
  };
}

/**
 * Where an ALARM's on-screen title comes from - either an i18n key we control,
 * or the user's own text passed straight through.
 *
 * Kept separate from every in-app surface on purpose. The alarm is the one
 * place the app does not own the width: AlarmKit's compact presentations (the
 * Dynamic Island, the banner) clip to a handful of characters, and device QA
 * caught a Turkish measurement alarm arriving as "Glikoz ölçü...". Nothing in
 * the app can widen that, so the copy has to get shorter instead.
 */
export type AlarmTitleSource =
  /** An i18n key from the deliberately short `reminders.alarmTitle*` family. */
  | { kind: "key"; key: string }
  /** The user's own words, passed through untouched. */
  | { kind: "text"; text: string };

/**
 * How wide a title is on a COMPACT alarm surface, in latin-character cells.
 *
 * Not `.length`: one CJK ideograph occupies roughly two latin cells, so
 * "午前遅くの測定" is seven characters but about as wide as fourteen latin ones.
 * Counting characters would let a Japanese name through that is twice the width
 * the budget allows, which is the same clipping this whole rule exists to
 * avoid. The ranges below are the fullwidth/wide blocks the app's languages can
 * actually produce (Japanese kana and kanji, plus CJK punctuation and the
 * fullwidth forms); everything else, Arabic and Latin included, is one cell.
 */
export function alarmTitleWidth(title: string): number {
  let cells = 0;
  for (const ch of title) {
    const c = ch.codePointAt(0) ?? 0;
    const wide =
      (c >= 0x1100 && c <= 0x115f) || // Hangul Jamo
      (c >= 0x2e80 && c <= 0x303e) || // CJK radicals, kangxi, CJK punctuation
      (c >= 0x3041 && c <= 0x33ff) || // kana, Hangul compat, CJK compat
      (c >= 0x3400 && c <= 0x4dbf) || // CJK ext A
      (c >= 0x4e00 && c <= 0x9fff) || // CJK unified ideographs
      (c >= 0xa000 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) || // Hangul syllables
      (c >= 0xf900 && c <= 0xfaff) || // CJK compat ideographs
      (c >= 0xfe30 && c <= 0xfe6f) ||
      (c >= 0xff00 && c <= 0xff60) || // fullwidth forms
      (c >= 0xffe0 && c <= 0xffe6);
    cells += wide ? 2 : 1;
  }
  return cells;
}

/**
 * A reference width budget, in latin-character cells, from the compact-alarm
 * calibration that used to decide whether a TYPE-BASED row's own name reached
 * the alarm title. reminderAlarmTitle no longer gates on it - a type-based row
 * (glucose/med/basal) always shows its short type noun, at any name width -
 * and a CUSTOM row was never limited by it either way. Kept only because
 * scripts/reminderLabel.test.ts still uses it to state "genuinely past the old
 * budget" when proving a custom row's name goes through untouched regardless.
 */
export const ALARM_TITLE_MAX_CELLS = 14;

/**
 * The alarm title for one reminder row.
 *
 * A CUSTOM row always keeps the user's own name, in full, whatever its length:
 * we do not get to abbreviate somebody's words, and it is the only title on
 * this surface they can shorten themselves.
 *
 * A TYPE-BASED row (glucose / med / basal) ALWAYS shows its short type noun,
 * never the user's or the ready-made layout's own name, no matter how short
 * that name is. AlarmKit's compact presentations clip hard and the app does
 * not own that width (device QA caught a Turkish measurement alarm arriving as
 * "Glikoz olcu..."), and a name that only sometimes made it through - fitting
 * for one row, clipped for the next - left the alarm title unpredictable in a
 * way a fixed noun is not.
 *
 * IN-APP surfaces are untouched by all of this: the reminders list, the
 * dashboard's next-reminder line, the "coming up" card and onboarding's closing
 * card all keep showing the row's real name at full length.
 *
 * Language changes need no special handling. A type-based row always returns a
 * KEY, which rescheduleForLanguageChange re-resolves through i18n.t on its
 * re-arm pass. A custom row's stored name is the user's own text and
 * deliberately does not follow the app language, the same rule every other
 * surface applies.
 */
export function reminderAlarmTitle(
  type: ReminderType,
  label: string | null
): AlarmTitleSource {
  const own = label?.trim();
  if (type === "custom") {
    return own
      ? { kind: "text", text: own }
      : // A custom row with no name of its own: nothing to pass through, so it
        // falls back to the plain word for "reminder", which is already short
        // in all nine languages.
        { kind: "key", key: "notifications.customTitle" };
  }
  switch (type) {
    case "med":
      return { kind: "key", key: "reminders.alarmTitleMed" };
    case "basal":
      return { kind: "key", key: "reminders.alarmTitleBasal" };
    case "glucose":
    default:
      return { kind: "key", key: "reminders.alarmTitleGlucose" };
  }
}
