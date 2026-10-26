import {
  planRowsToReplace,
  planRowsToWrite,
  type DayBucket,
  type ReminderPlanRow,
  type ReminderPreset,
} from "./reminderPresets";

export type ReminderPlanOutcome = "written" | "limit" | "failed";

export interface ReminderPlanResult {
  outcome: ReminderPlanOutcome;
  written: number;
}

export interface ReminderPlanDeps {
  list(profileId?: string): Promise<{ id: string; type: string; profile_id?: string | null }[]>;
  count(profileId?: string): Promise<number>;
  remove(id: string): Promise<void>;
  create(row: ReminderPlanRow): Promise<unknown>;
  transaction<T>(run: () => Promise<T>): Promise<T>;
  maxReminders: number;
  afterWrite(): Promise<void>;
}

export async function runReminderPlan(
  deps: ReminderPlanDeps,
  rows: ReminderPreset[],
  labelFor: (bucket: DayBucket) => string,
  profileId?: string
): Promise<ReminderPlanResult> {
  try {
    const existing = await deps.list(profileId);
    const wanted = planRowsToWrite(rows, labelFor, profileId);
    const replaceIds = planRowsToReplace(existing, profileId);
    // Delete and insert are one unit: a failure halfway rolls the old
    // measurement rows back instead of leaving the profile with none of them.
    const written = await deps.transaction(async () => {
      for (const id of replaceIds) await deps.remove(id);
      const room = Math.max(0, deps.maxReminders - (await deps.count(profileId)));
      let n = 0;
      for (const row of wanted.slice(0, room)) {
        await deps.create(row);
        n++;
      }
      return n;
    });
    if (written > 0) {
      try {
        await deps.afterWrite();
      } catch {
        // permission prompts are best-effort; the rows are already saved
      }
    }
    return { outcome: written < wanted.length ? "limit" : "written", written };
  } catch {
    return { outcome: "failed", written: 0 };
  }
}
