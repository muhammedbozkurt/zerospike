export type MedSaveOutcome = "ok" | "failed";

/** The entry write is the save; remembering the name for the picker is a side
 *  step whose failure must not turn a written row into an error (the user would
 *  press Save again and get a second row). */
export async function saveMedGuarded(deps: {
  write: () => Promise<void>;
  rememberName: () => Promise<void>;
}): Promise<MedSaveOutcome> {
  try {
    await deps.write();
  } catch {
    return "failed";
  }
  try {
    await deps.rememberName();
  } catch {
    // best-effort
  }
  return "ok";
}
