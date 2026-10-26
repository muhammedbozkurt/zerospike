export type ReminderSaveOutcome = "ok" | "limit" | "writeFailed" | "scheduleFailed";

/**
 * The row write and the OS scheduling are two different failures. Once the row
 * is in the table the sheet must close (a second Save would write the same
 * reminder again), and a scheduling error is reported on its own.
 */
export async function saveReminderGuarded(deps: {
  write: () => Promise<void>;
  afterWrite: () => Promise<void>;
  isCreate: boolean;
}): Promise<ReminderSaveOutcome> {
  try {
    await deps.write();
  } catch (e) {
    const isLimit =
      deps.isCreate && e instanceof Error && e.message.includes("reminders reached");
    return isLimit ? "limit" : "writeFailed";
  }
  try {
    await deps.afterWrite();
  } catch {
    return "scheduleFailed";
  }
  return "ok";
}
