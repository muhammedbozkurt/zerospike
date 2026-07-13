import { getDb } from "./index";
import { uuid } from "../uuid";
import { foodName } from "./types";
import type { Food, Lang } from "./types";

/** Free-tier custom-food cap. */
export const FREE_CUSTOM_FOOD_LIMIT = 10;

// Common Turkish everyday foods surfaced first on the default (unsearched) list
// for TR users, so the first screen is not dominated by world dishes. Light
// regional signal with no schema change; other locales are a future item.
const TR_STAPLE_NAMES = new Set([
  "Ekmek", "Pilav", "Bulgur pilavı", "Makarna", "Çay", "Kahve", "Su", "Süt",
  "Yumurta", "Peynir", "Beyaz peynir", "Kaşar peyniri", "Zeytin", "Domates",
  "Salatalık", "Elma", "Muz", "Portakal", "Yoğurt", "Ayran", "Çorba",
  "Mercimek çorbası", "Simit", "Poğaça", "Börek", "Köfte", "Tavuk", "Pirinç",
  "Patates", "Soğan", "Bal", "Reçel", "Tereyağı",
]);

/** Locale-aware, diacritic-insensitive normalization for search matching. */
function norm(s: string, lang: Lang): string {
  return s
    .toLocaleLowerCase(lang)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/** Default (unsearched) ordering: customs first, TR staples next, then the
 *  active-language name in that language's alphabetical order. */
function defaultOrder(lang: Lang) {
  return (a: Food, b: Food) => {
    if (a.is_custom !== b.is_custom) return b.is_custom - a.is_custom;
    if (lang === "tr") {
      const sa = TR_STAPLE_NAMES.has(a.name_tr) ? 0 : 1;
      const sb = TR_STAPLE_NAMES.has(b.name_tr) ? 0 : 1;
      if (sa !== sb) return sa - sb;
    }
    return foodName(a, lang).localeCompare(foodName(b, lang), lang);
  };
}

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
 * Multi-language instant search. Matching stays cross-language (FTS across all
 * five name columns + aliases + brand, LIKE fallback) so a custom food or a
 * foreign-language name is still found, but RANKING is by the active UI
 * language: names whose active-language form prefixes the query come first, then
 * active-language substring matches, then everything else. Ordering is done in
 * JS with localeCompare so Turkish/French alphabets sort correctly (expo-sqlite
 * has no ICU collation).
 */
export async function searchFoods(
  query: string,
  lang: Lang,
  limit = 50
): Promise<Food[]> {
  const db = await getDb();
  const trimmed = query.trim();

  if (!trimmed) {
    const rows = await db.getAllAsync<Food>("SELECT * FROM foods LIMIT 2000;");
    return rows.sort(defaultOrder(lang)).slice(0, limit);
  }

  // Pull a wider candidate pool than `limit` so the JS re-rank has material.
  const pool = Math.max(limit * 4, 120);
  let rows: Food[] = [];
  const ftsQuery = buildFtsQuery(trimmed);
  if (ftsQuery) {
    try {
      rows = await db.getAllAsync<Food>(
        `SELECT f.* FROM foods_fts fts
           JOIN foods f ON f.id = fts.food_id
         WHERE foods_fts MATCH ?
         ORDER BY rank
         LIMIT ?;`,
        [ftsQuery, pool]
      );
    } catch {
      rows = [];
    }
  }
  if (rows.length === 0) {
    const like = `%${trimmed}%`;
    rows = await db.getAllAsync<Food>(
      `SELECT * FROM foods
         WHERE name_tr LIKE ? OR name_en LIKE ? OR name_de LIKE ?
            OR name_es LIKE ? OR name_fr LIKE ? OR aliases_json LIKE ?
            OR brand_name LIKE ?
       LIMIT ?;`,
      [like, like, like, like, like, like, like, pool]
    );
  }

  const q = norm(trimmed, lang);
  const tier = (f: Food): number => {
    const n = norm(foodName(f, lang), lang);
    if (n.startsWith(q)) return 0;
    if (n.includes(q)) return 1;
    return 2;
  };
  return rows
    .sort((a, b) => {
      const ta = tier(a);
      const tb = tier(b);
      if (ta !== tb) return ta - tb;
      if (a.is_custom !== b.is_custom) return b.is_custom - a.is_custom;
      return foodName(a, lang).localeCompare(foodName(b, lang), lang);
    })
    .slice(0, limit);
}

/** All foods, customs first, sorted by the active-language name (localeCompare).
 *  The food tab re-groups these by category in the UI. */
export async function listAllFoods(lang: Lang, limit = 2000): Promise<Food[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Food>("SELECT * FROM foods LIMIT ?;", [limit]);
  return rows.sort(defaultOrder(lang));
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

/**
 * Stores a barcode result fetched from Open Food Facts so the next scan of the
 * same product resolves offline.
 *
 * The row is NOT marked custom: it is catalog data the user did not author, so
 * it must not eat into the free tier's custom-food allowance. `source` records
 * where it came from, which the calculator shows as attribution.
 *
 * Open Food Facts carries no glycemic index. Rather than guess one, GI and GL
 * stay at zero for the user to fill in; neither feeds the dose estimate.
 * Returns the existing row if this barcode was already cached.
 */
export async function cacheBarcodeFood(input: {
  barcode: string;
  name: string;
  brand: string | null;
  carb_100g: number;
  portion_size_g: number;
  source: string;
}): Promise<Food> {
  const existing = await getFoodByBarcode(input.barcode);
  if (existing) return existing;

  const db = await getDb();
  const id = uuid();
  const now = new Date().toISOString();
  const name = input.name.trim();
  const aliases = JSON.stringify([name.toLowerCase()]);

  await db.runAsync(
    `INSERT INTO foods
      (id, name_tr, name_en, name_de, name_es, name_fr, aliases_json,
       barcode, carb_100g, glycemic_index, glycemic_load, portion_size_g,
       brand_name, custom_notes, is_custom, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, NULL, 0, ?, ?);`,
    [
      id,
      name,
      name,
      name,
      name,
      name,
      aliases,
      input.barcode.trim(),
      input.carb_100g,
      input.portion_size_g,
      input.brand?.trim() || null,
      input.source,
      now,
    ]
  );

  const created = await getFood(id);
  if (!created) throw new Error("Failed to cache barcode food");
  return created;
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

export type FoodUpdate = Partial<NewFoodInput>;

/**
 * Updates a custom food (is_custom = 1 only; seeded catalog rows and cached
 * barcode results stay read-only). A new name is written to every language
 * column and the aliases, mirroring addCustomFood; glycemic_load is recomputed
 * whenever carbs or GI change. The foods_au trigger keeps FTS in sync.
 * Returns the fresh row, or null if the id is missing or not custom.
 */
export async function updateFood(
  id: string,
  patch: FoodUpdate
): Promise<Food | null> {
  const db = await getDb();
  const existing = await db.getFirstAsync<Food>(
    "SELECT * FROM foods WHERE id = ? AND is_custom = 1;",
    [id]
  );
  if (!existing) return null;

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  const name = patch.name?.trim();
  if (name) {
    for (const col of ["name_tr", "name_en", "name_de", "name_es", "name_fr"]) {
      fields.push(`${col} = ?`);
      values.push(name);
    }
    fields.push("aliases_json = ?");
    values.push(JSON.stringify([name.toLowerCase()]));
  }
  if (patch.carb_100g !== undefined) {
    fields.push("carb_100g = ?");
    values.push(patch.carb_100g);
  }
  if (patch.glycemic_index !== undefined) {
    fields.push("glycemic_index = ?");
    values.push(patch.glycemic_index);
  }
  if (patch.carb_100g !== undefined || patch.glycemic_index !== undefined) {
    const carb = patch.carb_100g ?? existing.carb_100g;
    const gi = patch.glycemic_index ?? existing.glycemic_index;
    fields.push("glycemic_load = ?");
    values.push(Math.round((gi * carb) / 100));
  }
  if (patch.portion_size_g !== undefined) {
    fields.push("portion_size_g = ?");
    values.push(patch.portion_size_g);
  }
  if (patch.brand_name !== undefined) {
    fields.push("brand_name = ?");
    values.push(patch.brand_name?.trim() || null);
  }
  if (patch.barcode !== undefined) {
    fields.push("barcode = ?");
    values.push(patch.barcode?.trim() || null);
  }
  if (patch.custom_notes !== undefined) {
    fields.push("custom_notes = ?");
    values.push(patch.custom_notes?.trim() || null);
  }

  if (fields.length > 0) {
    values.push(id);
    await db.runAsync(
      `UPDATE foods SET ${fields.join(", ")} WHERE id = ? AND is_custom = 1;`,
      values
    );
  }
  return getFood(id);
}

export async function deleteFood(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM foods WHERE id = ? AND is_custom = 1;", [id]);
}
