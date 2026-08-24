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
