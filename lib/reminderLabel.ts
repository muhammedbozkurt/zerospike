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
 * The alarm title for one reminder row.
 *
 * Type-based rows (glucose / med / basal) drop to the shortest natural word in
 * each language rather than reusing the NOTIFICATION title: a notification
 * banner has room for "Glucose check" and a Dynamic Island does not. They are
 * their own keys rather than the `reminders.type*` labels the list draws,
 * because the two are tuned against different constraints - renaming a row type
 * in the UI must not silently re-clip an alarm, and shortening an alarm must
 * not make the settings list terse.
 *
 * A custom row keeps the user's OWN name, in full, whatever its length: we do
 * not get to abbreviate somebody's words. If the OS clips it, that is the OS
 * clipping the user's text, which is the honest outcome - and it is the only
 * title on this surface they can shorten themselves.
 *
 * IN-APP surfaces are untouched by all of this: the reminders list, the
 * dashboard's next-reminder line, the "coming up" card and onboarding's closing
 * card all keep showing the row's real name.
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
