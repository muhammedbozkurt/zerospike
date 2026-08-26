import AsyncStorage from "@react-native-async-storage/async-storage";
import { profileScopedKeys } from "../profileScopedKeys";
import { getDb, DEFAULT_PROFILE_ID, defaultProfileName } from "./index";
import { uuid } from "../uuid";
import type { DiabetesType, InsulinMode, UserProfile } from "./types";

export async function listProfiles(): Promise<UserProfile[]> {
  const db = await getDb();
  return db.getAllAsync<UserProfile>(
    "SELECT * FROM user_profiles ORDER BY created_at ASC;"
  );
}

export async function getProfile(id: string): Promise<UserProfile | null> {
  const db = await getDb();
  return db.getFirstAsync<UserProfile>(
    "SELECT * FROM user_profiles WHERE id = ?;",
    [id]
  );
}

/** Always returns a usable profile, falling back to (or recreating) the default. */
export async function getDefaultProfile(): Promise<UserProfile> {
  const db = await getDb();
  const existing = await db.getFirstAsync<UserProfile>(
    "SELECT * FROM user_profiles ORDER BY created_at ASC LIMIT 1;"
  );
  if (existing) return existing;

  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO user_profiles
       (id, name, insulin_sensitivity_factor, carb_ratio_breakfast,
        carb_ratio_lunch, carb_ratio_dinner, target_fasting_min,
        target_fasting_max, target_postmeal_min, target_postmeal_max,
        hypo_threshold_mgdl, daily_carb_target_g, daily_carb_target_min_g,
        basal_daily_units, basal_insulin_id, bolus_insulin_id,
        basal_insulin_other, bolus_insulin_other,
        created_at)
     VALUES (?, ?, 40, 10, 12, 12, 80, 100, 80, 140, 70, 200, 160, NULL, NULL, NULL, NULL, NULL, ?);`,
    [DEFAULT_PROFILE_ID, defaultProfileName(), now]
  );
  return (await getProfile(DEFAULT_PROFILE_ID))!;
}

export interface NewProfileInput {
  name: string;
  insulin_sensitivity_factor?: number;
  carb_ratio_breakfast?: number;
  carb_ratio_lunch?: number;
  carb_ratio_dinner?: number;
  target_fasting_min?: number;
  target_fasting_max?: number;
  target_postmeal_min?: number;
  target_postmeal_max?: number;
  hypo_threshold_mgdl?: number;
  daily_carb_target_g?: number;
  daily_carb_target_min_g?: number;
  diabetes_type?: DiabetesType;
  insulin_mode?: InsulinMode;
  basal_daily_units?: number | null;
  basal_insulin_id?: string | null;
  bolus_insulin_id?: string | null;
  /** Free-text product name (schema v22), only meaningful alongside the
   *  matching *_insulin_id set to the catalog's "other" id. */
  basal_insulin_other?: string | null;
  bolus_insulin_other?: string | null;
}

export async function createProfile(
  input: NewProfileInput
): Promise<UserProfile> {
  const db = await getDb();
  const id = uuid();
  const now = new Date().toISOString();
  const carbMax = input.daily_carb_target_g ?? 200;
  await db.runAsync(
    `INSERT INTO user_profiles
       (id, name, insulin_sensitivity_factor, carb_ratio_breakfast,
        carb_ratio_lunch, carb_ratio_dinner, target_fasting_min,
        target_fasting_max, target_postmeal_min, target_postmeal_max,
        hypo_threshold_mgdl, daily_carb_target_g, daily_carb_target_min_g,
        diabetes_type, insulin_mode,
        basal_daily_units, basal_insulin_id, bolus_insulin_id,
        basal_insulin_other, bolus_insulin_other, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      id,
      input.name.trim() || defaultProfileName(),
      input.insulin_sensitivity_factor ?? 40,
      input.carb_ratio_breakfast ?? 10,
      input.carb_ratio_lunch ?? 12,
      input.carb_ratio_dinner ?? 12,
      input.target_fasting_min ?? 80,
      input.target_fasting_max ?? 100,
      input.target_postmeal_min ?? 80,
      input.target_postmeal_max ?? 140,
      input.hypo_threshold_mgdl ?? 70,
      carbMax,
      input.daily_carb_target_min_g ?? Math.round(carbMax * 0.8),
      input.diabetes_type ?? "unknown",
      input.insulin_mode ?? "both",
      input.basal_daily_units ?? null,
      input.basal_insulin_id ?? null,
      input.bolus_insulin_id ?? null,
      input.basal_insulin_other ?? null,
      input.bolus_insulin_other ?? null,
      now,
    ]
  );
  return (await getProfile(id))!;
}

export type ProfileUpdate = Partial<Omit<UserProfile, "id" | "created_at">>;

export async function updateProfile(
  id: string,
  patch: ProfileUpdate
): Promise<UserProfile> {
  const db = await getDb();
  const fields: string[] = [];
  const values: (string | number)[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    fields.push(`${key} = ?`);
    values.push(value as string | number);
  }
  if (fields.length > 0) {
    values.push(id);
    await db.runAsync(
      `UPDATE user_profiles SET ${fields.join(", ")} WHERE id = ?;`,
      values
    );
  }
  return (await getProfile(id))!;
}

/** Deletes a profile and (via cascades) its logs. Never deletes the last one.
 *
 *  reminders is the one profile-scoped table with no foreign key on
 *  profile_id (schema v19 - see lib/db/reminders.ts's own ownership note), so
 *  it is not covered by ON DELETE CASCADE like sugar_logs/meal_logs/etc: this
 *  runs its own DELETE first, or a deleted profile's reminders would sit in
 *  the table forever, orphaned, with nothing left to ever read or clear them. */
export async function deleteProfile(id: string): Promise<boolean> {
  const db = await getDb();
  const count = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) AS c FROM user_profiles;"
  );
  if ((count?.c ?? 0) <= 1) return false;
  await db.runAsync("DELETE FROM reminders WHERE profile_id = ?;", [id]);
  await db.runAsync("DELETE FROM user_profiles WHERE id = ?;", [id]);
  // The profile's AsyncStorage flags go with it (X9). Nothing reads them once
  // the row is gone, but one of them is a health preference the user asked to
  // remove along with the profile, and a recycled id would inherit the rest.
  // Best-effort: the profile itself is already deleted, and a storage failure
  // must not report that as a failed delete.
  try {
    await AsyncStorage.multiRemove(profileScopedKeys(id));
  } catch {
    // leftover flags are inert; the row is what mattered
  }
  return true;
}
