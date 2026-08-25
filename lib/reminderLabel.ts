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
 * The widest a name may be before the alarm falls back to its short type label.
 *
 * CALIBRATED ON THE REAL NAMES, in all nine languages (pinned by
 * scripts/reminderLabel.test.ts, which reads the locale files rather than
 * trusting this comment). The measurement:
 *
 *   tr  max 13   Kuşluk ölçümü
 *   ar  max 12   قياس الظهيرة
 *   ja  max 14   午前遅くの測定  (7 chars, 14 cells)
 *   de  max 21   Messung am Nachmittag
 *   pt  max 23   Medição do fim da manhã
 *   fr  max 24   Mesure de fin de matinée
 *   es  max 24   Medición de media mañana
 *   en  max 26   Late morning glucose check
 *   it  max 27   Misurazione di metà mattina
 *
 * The two goals asked for cannot both hold: letting EVERY preset name through
 * needs 27 cells, and 27 cells on a Dynamic Island compact is exactly the
 * clipping device QA reported ("Glikoz olcu..."). The budget wins, because a
 * title nobody can read is worse than a correct short one - so this is 14, the
 * largest value that still fits the compact surface, and it is calibrated so
 * that the three languages whose preset names are genuinely short (tr, ar, ja)
 * pass ALL of theirs by name. Japanese lands exactly on the line at 14 cells,
 * which is why the limit is inclusive and why width, not length, is measured.
 *
 * The six Latin languages keep the previous behaviour for PRESET rows (their
 * names are sentences, not labels), but every user in every language still
 * gets their OWN short names through: "Metformin", "Yurüyüs", "Insulin" all
 * fit comfortably. Naming a reminder something short is now the way to see it
 * on the alarm, in any language.
 */
export const ALARM_TITLE_MAX_CELLS = 14;

/**
 * The alarm title for one reminder row.
 *
 * A CUSTOM row always keeps the user's own name, in full, whatever its length:
 * we do not get to abbreviate somebody's words, and it is the only title on
 * this surface they can shorten themselves.
 *
 * A TYPE-BASED row (glucose / med / basal) now uses its own name too - the
 * user's, or the one the ready-made layout gave it - but only while that name
 * fits the compact budget (ALARM_TITLE_MAX_CELLS). Past it the short type noun
 * takes over, because AlarmKit's compact presentations clip hard and the app
 * does not own that width. A named row that fits is strictly better than a
 * generic noun: "Sabah olcumu" says which reminder is ringing, "Olcum" does not.
 *
 * IN-APP surfaces are untouched by all of this: the reminders list, the
 * dashboard's next-reminder line, the "coming up" card and onboarding's closing
 * card all keep showing the row's real name at full length.
 *
 * Language changes need no special handling. A stored name is the user's (or
 * the layout's) own text and deliberately does not follow the app language -
 * the same rule every other surface applies - while a row that falls back here
 * returns a KEY, which rescheduleForLanguageChange re-resolves through i18n.t
 * on its re-arm pass. So both halves already do the right thing.
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
  if (own && alarmTitleWidth(own) <= ALARM_TITLE_MAX_CELLS) {
    return { kind: "text", text: own };
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
