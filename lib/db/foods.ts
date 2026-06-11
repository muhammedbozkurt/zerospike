import { getDb } from "./index";
import { uuid } from "../uuid";
import type { Food } from "./types";

/** Free-tier custom-food cap. */
export const FREE_CUSTOM_FOOD_LIMIT = 3;

/**
 * Builds an FTS5 prefix MATCH query from raw user input. Each token becomes a
 * prefix term ("pi" → "pilav"), multi-word input ANDs the terms. Special FTS
 * syntax characters are stripped so user text can't break the query.
 */
function buildFtsQuery(input: string): string | null {
  const tokens = input
    .toLowerCase()
    .replace(/["'()*:^.\-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `${t}*`).join(" ");
}

/**
 * Multi-language instant search via the FTS5 index (matches across all five
 * name columns + aliases + brand). Falls back to a LIKE scan on any error.
 */
export async function searchFoods(query: string, limit = 50): Promise<Food[]> {
  const db = await getDb();
  const trimmed = query.trim();

  if (!trimmed) {
    return db.getAllAsync<Food>(
      `SELECT * FROM foods ORDER BY is_custom DESC, name_tr COLLATE NOCASE ASC LIMIT ?;`,
      [limit]
    );
  }

  const ftsQuery = buildFtsQuery(trimmed);
  if (ftsQuery) {
    try {
      return await db.getAllAsync<Food>(
        `SELECT f.* FROM foods_fts fts
           JOIN foods f ON f.id = fts.food_id
         WHERE foods_fts MATCH ?
         ORDER BY rank
         LIMIT ?;`,
        [ftsQuery, limit]
      );
    } catch {
      // fall through to LIKE
    }
  }

  const like = `%${trimmed}%`;
  return db.getAllAsync<Food>(
    `SELECT * FROM foods
       WHERE name_tr LIKE ? OR name_en LIKE ? OR name_de LIKE ?
          OR name_es LIKE ? OR name_fr LIKE ? OR aliases_json LIKE ?
          OR brand_name LIKE ?
     ORDER BY is_custom DESC, name_tr COLLATE NOCASE ASC
     LIMIT ?;`,
    [like, like, like, like, like, like, like, limit]
  );
}

/** All foods, customs first, then grouped-friendly by category & name. */
export async function listAllFoods(limit = 2000): Promise<Food[]> {
  const db = await getDb();
  return db.getAllAsync<Food>(
    `SELECT * FROM foods
     ORDER BY is_custom DESC, category ASC, name_tr COLLATE NOCASE ASC
     LIMIT ?;`,
    [limit]
  );
}

export async function getFood(id: string): Promise<Food | null> {
  const db = await getDb();
  return db.getFirstAsync<Food>("SELECT * FROM foods WHERE id = ?;", [id]);
}

/** Offline barcode lookup used by the camera scanner. */
export async function getFoodByBarcode(barcode: string): Promise<Food | null> {
  const db = await getDb();
  return db.getFirstAsync<Food>(
    "SELECT * FROM foods WHERE barcode = ? LIMIT 1;",
    [barcode.trim()]
  );
}

export async function countCustomFoods(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) AS c FROM foods WHERE is_custom = 1;"
  );
  return row?.c ?? 0;
}

export interface NewFoodInput {
  name: string; // entered in user's language; copied across columns + aliases
  carb_100g: number;
  glycemic_index: number;
  portion_size_g?: number;
  brand_name?: string | null;
  barcode?: string | null;
  custom_notes?: string | null;
}

/**
 * Adds a custom food. The entered name is written to every language column
 * (so it stays searchable regardless of UI language) and included in aliases.
 */
export async function addCustomFood(input: NewFoodInput): Promise<Food> {
  const db = await getDb();
  const id = uuid();
  const now = new Date().toISOString();
  const name = input.name.trim();
  const gl = Math.round((input.glycemic_index * input.carb_100g) / 100);
  const aliases = JSON.stringify([name.toLowerCase()]);

  await db.runAsync(
    `INSERT INTO foods
      (id, name_tr, name_en, name_de, name_es, name_fr, aliases_json,
       barcode, carb_100g, glycemic_index, glycemic_load, portion_size_g,
       brand_name, custom_notes, is_custom, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?);`,
    [
      id,
      name,
      name,
      name,
      name,
      name,
      aliases,
      input.barcode?.trim() || null,
      input.carb_100g,
      input.glycemic_index,
      gl,
      input.portion_size_g ?? 100,
      input.brand_name?.trim() || null,
      input.custom_notes?.trim() || null,
      now,
    ]
  );

  const created = await getFood(id);
  if (!created) throw new Error("Failed to create food");
  return created;
}

export async function deleteFood(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM foods WHERE id = ? AND is_custom = 1;", [id]);
}
