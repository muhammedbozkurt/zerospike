import { getDb } from "./index";
import { uuid } from "../uuid";
import type { Food } from "./types";

export async function listFavoriteFoods(profileId: string): Promise<Food[]> {
  const db = await getDb();
  return db.getAllAsync<Food>(
    `SELECT f.* FROM favorites fav
       JOIN foods f ON f.id = fav.food_id
     WHERE fav.profile_id = ?
     ORDER BY f.name_tr COLLATE NOCASE ASC;`,
    [profileId]
  );
}

export async function isFavorite(
  profileId: string,
  foodId: string
): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) AS c FROM favorites WHERE profile_id = ? AND food_id = ?;",
    [profileId, foodId]
  );
  return (row?.c ?? 0) > 0;
}

export async function toggleFavorite(
  profileId: string,
  foodId: string
): Promise<boolean> {
  const db = await getDb();
  const exists = await isFavorite(profileId, foodId);
  if (exists) {
    await db.runAsync(
      "DELETE FROM favorites WHERE profile_id = ? AND food_id = ?;",
      [profileId, foodId]
    );
    return false;
  }
  await db.runAsync(
    "INSERT OR IGNORE INTO favorites (id, profile_id, food_id) VALUES (?, ?, ?);",
    [uuid(), profileId, foodId]
  );
  return true;
}
