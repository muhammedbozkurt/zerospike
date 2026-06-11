import { getDb, DEFAULT_PROFILE_ID, defaultProfileName } from "./index";
import { uuid } from "../uuid";
import type { UserProfile } from "./types";

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

/** Always returns a usable profile — falls back to (or recreates) the default. */
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
        carb_ratio_lunch, carb_ratio_dinner, target_fasting_max,
        target_postmeal_max, daily_carb_target_g, created_at)
     VALUES (?, ?, 40, 10, 12, 12, 100, 140, 200, ?);`,
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
  target_fasting_max?: number;
  target_postmeal_max?: number;
  daily_carb_target_g?: number;
}

export async function createProfile(
  input: NewProfileInput
): Promise<UserProfile> {
  const db = await getDb();
  const id = uuid();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO user_profiles
       (id, name, insulin_sensitivity_factor, carb_ratio_breakfast,
        carb_ratio_lunch, carb_ratio_dinner, target_fasting_max,
        target_postmeal_max, daily_carb_target_g, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      id,
      input.name.trim() || "Profil",
      input.insulin_sensitivity_factor ?? 40,
      input.carb_ratio_breakfast ?? 10,
      input.carb_ratio_lunch ?? 12,
      input.carb_ratio_dinner ?? 12,
      input.target_fasting_max ?? 100,
      input.target_postmeal_max ?? 140,
      input.daily_carb_target_g ?? 200,
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

/** Deletes a profile and (via cascades) its logs. Never deletes the last one. */
export async function deleteProfile(id: string): Promise<boolean> {
  const db = await getDb();
  const count = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) AS c FROM user_profiles;"
  );
  if ((count?.c ?? 0) <= 1) return false;
  await db.runAsync("DELETE FROM user_profiles WHERE id = ?;", [id]);
  return true;
}
