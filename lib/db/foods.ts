import { getDb } from "./index";
import { inDbTransaction } from "./meals";
import { uuid } from "../uuid";
import { foodName } from "./types";
import { DEFAULT_FOOD_CATEGORY, type FoodCategory } from "./categories";
import { isLocalStaple, queryExpansion, rankBoost } from "../foodMeta";
import {
  fold,
  foodMatchesAny,
  queryVariants,
  rankFoods,
  synonymAlternates,
  type FoodUsage,
} from "../foodSearch";
import { OFF_SOURCE, type OffProduct } from "../services/openFoodFacts";
import type { Food, FoodPortion, Lang, PortionLabelKey } from "./types";

/** Free-tier custom-food cap. */
export const FREE_CUSTOM_FOOD_LIMIT = 10;

/** Default (unsearched) ordering: customs first, the active market's staples
 *  next (lib/foodMeta isLocalStaple: tr/de/fr/es/en), then the active-language
 *  name in that language's alphabetical order. */
function defaultOrder(lang: Lang) {
  return (a: Food, b: Food) => {
    if (a.is_custom !== b.is_custom) return b.is_custom - a.is_custom;
    const sa = isLocalStaple(a, lang) ? 0 : 1;
    const sb = isLocalStaple(b, lang) ? 0 : 1;
    if (sa !== sb) return sa - sb;
    return foodName(a, lang).localeCompare(foodName(b, lang), lang);
  };
}

/**
 * Builds an FTS5 prefix MATCH query from raw user input. Each token becomes a
 * prefix term ("pi" → "pilav"), multi-word input ANDs the terms. Special FTS
 * syntax characters are stripped so user text can't break the query.
 *
 * `extraTerms` (lib/foodMeta queryExpansion, it/pt only) are OR'd onto the
 * typed query as their own prefix terms, so "riso" also surfaces "rice" rows
 * without displacing what the user actually typed - empty for every other
 * language, so their query stays exactly what it always was.
 */
function buildFtsQuery(input: string, extraTerms: readonly string[] = []): string | null {
  const tokens = input
    .toLowerCase()
    .replace(/["'()*:^.\-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const typed = tokens.map((t) => `${t}*`).join(" ");
  const extra = extraTerms
    .map((t) => t.toLowerCase().trim())
    .filter(Boolean)
    .map((t) => `${t}*`);
  if (!typed && extra.length === 0) return null;
  const clauses = [typed, ...extra].filter(Boolean);
  return clauses.length > 1 ? clauses.map((c) => `(${c})`).join(" OR ") : clauses[0];
}

/** meal_logs usage (count and latest log) of the given foods. Every profile
 *  counts unless `profileId` is given. A failure just means no usage signal. */
async function loadUsage(
  db: Awaited<ReturnType<typeof getDb>>,
  ids: readonly string[],
  profileId?: string
): Promise<Map<string, FoodUsage>> {
  const out = new Map<string, FoodUsage>();
  try {
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const marks = chunk.map(() => "?").join(",");
      const rows = await db.getAllAsync<{ food_id: string; c: number; last: string | null }>(
        `SELECT food_id, COUNT(*) AS c, MAX(logged_at) AS last
           FROM meal_logs
          WHERE food_id IN (${marks})${profileId ? " AND profile_id = ?" : ""}
          GROUP BY food_id;`,
        profileId ? [...chunk, profileId] : chunk
      );
      for (const r of rows) out.set(r.food_id, { count: r.c, last: r.last });
    }
  } catch {
    return new Map();
  }
  return out;
}

/**
 * Multi-language instant search. Matching stays cross-language (FTS across all
 * name columns + aliases + brand) so a custom food or a foreign-language name
 * is still found, but RANKING (lib/foodSearch rankFoods) follows the active UI
 * language: exact name, then prefix / word-prefix, then substring, then other
 * languages; inside a group the foods the user has logged come first, then
 * customs, the market's staples and the language's alphabet. Accents, the
 * Turkish dotted/dotless i and German ae/oe/ue/ss are folded, and the TR/DE
 * synonym table adds alternative names. FTS only folds accents, so when it
 * returns few rows a folded scan of the whole table fills in (kasarli,
 * weissbrot). Ordering is done in JS with localeCompare so Turkish/French
 * alphabets sort correctly (expo-sqlite has no ICU collation).
 */
export async function searchFoods(
  query: string,
  lang: Lang,
  limit = 50,
  profileId?: string
): Promise<Food[]> {
  const db = await getDb();
  const trimmed = query.trim();

  if (!trimmed) {
    const rows = await db.getAllAsync<Food>("SELECT * FROM foods LIMIT 2000;");
    return rows.sort(defaultOrder(lang)).slice(0, limit);
  }

  // Pull a wider candidate pool than `limit` so the JS re-rank has material.
  const pool = Math.max(limit * 4, 120);
  // it/pt have no name column of their own (foodName falls back to English),
  // so a query typed in Italian or Portuguese matches nothing on its own;
  // this widens the CANDIDATE POOL only.
  const expansionTerms = queryExpansion(trimmed, lang);
  const synonymTerms = synonymAlternates(trimmed, lang);
  const variants = queryVariants(trimmed, lang);
  const ftsQuery = buildFtsQuery(trimmed, [...expansionTerms, ...synonymTerms]);
  const byId = new Map<string, Food>();
  if (ftsQuery) {
    try {
      const rows = await db.getAllAsync<Food>(
        `SELECT f.* FROM foods_fts fts
           JOIN foods f ON f.id = fts.food_id
         WHERE foods_fts MATCH ?
         ORDER BY rank
         LIMIT ?;`,
        [ftsQuery, pool]
      );
      for (const r of rows) byId.set(r.id, r);
      // Logged foods must not fall off a short query's pool.
      const used = await db.getAllAsync<Food>(
        `SELECT f.* FROM foods_fts fts
           JOIN foods f ON f.id = fts.food_id
         WHERE foods_fts MATCH ?
           AND f.id IN (SELECT DISTINCT food_id FROM meal_logs WHERE food_id IS NOT NULL)
         LIMIT 60;`,
        [ftsQuery]
      );
      for (const r of used) byId.set(r.id, r);
    } catch {
      // A syntax the sanitiser missed: the folded scan below still answers.
    }
  }
  const synonyms = [...expansionTerms, ...synonymTerms].map(fold).filter(Boolean);
  if (byId.size < 10) {
    const all = await db.getAllAsync<Food>("SELECT * FROM foods;");
    const phrases = [...variants, ...synonyms];
    for (const f of all) {
      if (!byId.has(f.id) && foodMatchesAny(f, phrases)) byId.set(f.id, f);
    }
  }

  const rows = [...byId.values()];
  const usage = await loadUsage(db, rows.map((r) => r.id), profileId);
  return rankFoods(rows, { lang, variants, synonyms, usage, now: Date.now() }).slice(0, limit);
}

/** The name column (or expression) SQLite orders a page by, per active
 *  language. it/pt/ar/ja (schema v23) fall back to name_en where their own
 *  column is null - a seeded row the top-up has not filled yet, or a custom /
 *  OFF-cached food, which never gets one - the same fallback foodName() uses. */
const NAME_COLUMN: Record<Lang, string> = {
  tr: "name_tr",
  en: "name_en",
  de: "name_de",
  es: "name_es",
  fr: "name_fr",
  it: "COALESCE(name_it, name_en)",
  pt: "COALESCE(name_pt, name_en)",
  ar: "COALESCE(name_ar, name_en)",
  ja: "COALESCE(name_ja, name_en)",
};

/** How many rows one category page pulls. Must stay comfortably above the
 *  largest seeded category (dishes, 258 after the R11 expansion) or the tail of
 *  the alphabet becomes unreachable outside search; scripts/seed.test.ts pins
 *  this invariant. */
export const FOOD_PAGE_SIZE = 400;

/**
 * How many catalog foods each category holds (customs excluded, which get their
 * own tile). Twelve aggregate rows instead of the whole catalog: the food tab's
 * landing grid only ever shows these COUNTS, and it used to read all 562 rows
 * into memory - on mount, on every language change, and again after every single
 * log write - to call `.length` on twelve buckets.
 */
export async function countFoodsByCategory(): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ category: string; c: number }>(
    "SELECT category, COUNT(*) AS c FROM foods WHERE is_custom = 0 GROUP BY category;"
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.category] = r.c;
  return out;
}

/** The user's own foods, in the same order the full catalog put them in. */
export async function listCustomFoods(lang: Lang): Promise<Food[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Food>(
    "SELECT * FROM foods WHERE is_custom = 1;"
  );
  return rows.sort(defaultOrder(lang));
}

/**
 * defaultOrder, with an extra sort key ahead of it: lib/foodMeta rankBoost
 * floats a lang's everyday staples (bread, rice, kebab for tr; rice, sushi,
 * miso for ja...) to the top of the shelf, so a category page opens on foods
 * that locale actually reaches for first instead of strict alphabetical
 * order. A stable sort, so within a boost tier the locale-aware alphabetical
 * order underneath is untouched.
 *
 * Scoped to the category-shelf page only (below) - search result ordering
 * and the plain custom-foods list keep using defaultOrder unboosted.
 */
function shelfOrder(lang: Lang) {
  const base = defaultOrder(lang);
  return (a: Food, b: Food) => {
    const boost = rankBoost(b.name_en, lang) - rankBoost(a.name_en, lang);
    return boost !== 0 ? boost : base(a, b);
  };
}

/**
 * One category's page of catalog foods.
 *
 * Ordering and paging are SQL's (idx_foods_category serves the filter, the name
 * column gives the page a stable cut), then the page is re-sorted with the same
 * locale-aware comparator the full list used, PLUS the staple boost above -
 * expo-sqlite has no ICU collation, so Turkish/French alphabetical order can
 * only be settled in JS, and the boost has to be a JS pass for the same reason
 * it can't be an SQL ORDER BY. A page holds more rows than any seeded category
 * today (scripts/seed.test.ts pins that invariant), so this reorders the
 * shelf's WHOLE contents in practice; the boost is page-local by construction
 * and would only stop covering a shelf if a category ever outgrew
 * FOOD_PAGE_SIZE and needed a second page.
 */
export async function listFoodsByCategory(
  category: string,
  lang: Lang,
  limit = FOOD_PAGE_SIZE,
  offset = 0
): Promise<Food[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Food>(
    `SELECT * FROM foods
      WHERE is_custom = 0 AND category = ?
      ORDER BY ${NAME_COLUMN[lang]} COLLATE NOCASE
      LIMIT ? OFFSET ?;`,
    [category, limit, offset]
  );
  return rows.sort(shelfOrder(lang));
}

export async function getFood(id: string): Promise<Food | null> {
  const db = await getDb();
  return db.getFirstAsync<Food>("SELECT * FROM foods WHERE id = ?;", [id]);
}

/** Catalogue row by its English name (store capture scenes only). */
export async function getCatalogFoodByEnglishName(name: string): Promise<Food | null> {
  const db = await getDb();
  return db.getFirstAsync<Food>("SELECT * FROM foods WHERE name_en = ? AND is_custom = 0 LIMIT 1;", [name]);
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

/** Deduped, lowercased synonym list; what the FTS index searches on. */
function buildAliases(names: string[]): string {
  const seen = new Set<string>();
  for (const n of names) {
    const key = n.trim().toLowerCase();
    if (key) seen.add(key);
  }
  return JSON.stringify([...seen]);
}

/**
 * A name per language, as Open Food Facts reports them.
 *
 * The table has a NOT NULL column for the first five, so those always get a
 * value (falling back to the product's main name). it/pt/ar/ja (schema v23)
 * have their own nullable columns too: written when the caller supplies one,
 * left NULL otherwise - never force-filled with the main name, so NULL keeps
 * meaning "no dedicated translation" for foodName()'s own fallback and for
 * NAME_COLUMN's COALESCE. Either way they also ride along in aliases_json,
 * which FTS and the LIKE fallback both search, so an Italian or Japanese user
 * finds a scanned product by the name their own shelf prints even when the
 * column itself is NULL.
 */
export interface FoodNames {
  tr: string;
  en: string;
  de: string;
  es: string;
  fr: string;
  it?: string;
  pt?: string;
  ar?: string;
  ja?: string;
}

/**
 * Stores a barcode result fetched from Open Food Facts so the next scan of the
 * same product resolves offline.
 *
 * The row is NOT marked custom: it is catalog data the user did not author, so
 * it must not eat into the free tier's custom-food allowance. `source` records
 * where it came from, which the calculator shows as attribution.
 *
 * `names` carries the product's own translations where it has them, so a cached
 * product reads correctly in whatever language the app is in; a language the
 * product has no name for gets the main one, which is what a single-name product
 * used to get in all five columns. `category` is the shelf guessed from the
 * product's tags and falls back to the column default rather than to a guess.
 *
 * Open Food Facts carries no glycemic index. Rather than guess one, GI and GL
 * stay at zero for the user to fill in; neither feeds the dose estimate.
 * Returns the existing row if this barcode was already cached.
 */
export async function cacheBarcodeFood(input: {
  barcode: string;
  name: string;
  names?: FoodNames;
  brand: string | null;
  category?: FoodCategory;
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
  const pick = (value: string | undefined): string => value?.trim() || name;
  const names: FoodNames = {
    tr: pick(input.names?.tr),
    en: pick(input.names?.en),
    de: pick(input.names?.de),
    es: pick(input.names?.es),
    fr: pick(input.names?.fr),
  };
  // Unlike `pick` above, NOT force-filled with the main name: these columns
  // are nullable specifically so NULL can keep meaning "no dedicated
  // translation" for foodName()'s fallback chain and NAME_COLUMN's COALESCE.
  const pickOptional = (value: string | undefined): string | null =>
    value?.trim() || null;
  const it = pickOptional(input.names?.it);
  const pt = pickOptional(input.names?.pt);
  const ar = pickOptional(input.names?.ar);
  const ja = pickOptional(input.names?.ja);
  // Every language rides along as an alias too (buildAliases lowercases and
  // dedupes), so a product findable only by its it/pt/ar/ja name is still
  // findable there even from a UI language whose own column stayed NULL.
  const aliases = buildAliases([
    name,
    names.tr,
    names.en,
    names.de,
    names.es,
    names.fr,
    it ?? "",
    pt ?? "",
    ar ?? "",
    ja ?? "",
  ]);

  await db.runAsync(
    `INSERT INTO foods
      (id, name_tr, name_en, name_de, name_es, name_fr, name_it, name_pt, name_ar, name_ja,
       aliases_json, category, barcode, carb_100g, glycemic_index, glycemic_load,
       portion_size_g, brand_name, custom_notes, is_custom, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, NULL, 0, ?, ?);`,
    [
      id,
      names.tr,
      names.en,
      names.de,
      names.es,
      names.fr,
      it,
      pt,
      ar,
      ja,
      aliases,
      input.category ?? DEFAULT_FOOD_CATEGORY,
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

/**
 * Same upsert-by-barcode semantics as cacheBarcodeFood, for a name SEARCH hit
 * (lib/services/openFoodFacts searchProducts) instead of a barcode lookup:
 * the caller already has a full OffProduct, so this just forwards its fields
 * with source = 'off'. A product already cached - by an earlier scan or an
 * earlier search - resolves to that same row rather than a duplicate; is_custom
 * stays 0, so it never counts against FREE_CUSTOM_FOOD_LIMIT (see
 * countCustomFoods below, which only counts is_custom = 1).
 */
export async function upsertOffFood(product: OffProduct): Promise<Food> {
  return cacheBarcodeFood({
    barcode: product.barcode,
    name: product.name,
    names: product.names,
    brand: product.brand,
    category: product.category,
    carb_100g: product.carb100g,
    portion_size_g: product.portionG,
    source: OFF_SOURCE,
  });
}

export interface NewFoodInput {
  name: string; // entered in user's language; copied across columns + aliases
  carb_100g: number;
  glycemic_index: number;
  /** Which shelf the food is filed under; the column default when omitted. */
  category?: FoodCategory;
  portion_size_g?: number;
  brand_name?: string | null;
  barcode?: string | null;
  custom_notes?: string | null;
  /** The user's own icon (schema v20), from app/add-food.tsx's emoji grid.
   *  Omitted or null keeps the column at its NULL default, which falls
   *  through to lib/foodMeta emojiFor's own match (see resolveFoodEmoji). */
  emoji?: string | null;
}

/**
 * Adds a custom food. The entered name is written to every language column
 * (so it stays searchable regardless of UI language) and included in aliases.
 *
 * `category` is optional and additive: a caller that does not pass one gets the
 * same "other" the column has always defaulted to, so every existing call site
 * keeps working unchanged.
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
       category, barcode, carb_100g, glycemic_index, glycemic_load,
       portion_size_g, brand_name, custom_notes, is_custom, emoji, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?);`,
    [
      id,
      name,
      name,
      name,
      name,
      name,
      aliases,
      input.category ?? DEFAULT_FOOD_CATEGORY,
      input.barcode?.trim() || null,
      input.carb_100g,
      input.glycemic_index,
      gl,
      input.portion_size_g ?? 100,
      input.brand_name?.trim() || null,
      input.custom_notes?.trim() || null,
      input.emoji?.trim() || null,
      now,
    ]
  );

  const created = await getFood(id);
  if (!created) throw new Error("Failed to create food");
  return created;
}

export type FoodUpdate = Partial<NewFoodInput>;

/**
 * Updates a custom food or a cached barcode result (is_custom = 1, or
 * source = 'off'; the seeded catalog stays read-only). A new name is written
 * to every language column and the aliases, mirroring addCustomFood;
 * glycemic_load is recomputed whenever carbs or GI change. The foods_au
 * trigger keeps FTS in sync. Returns the fresh row, or null if the id is
 * missing or not editable.
 */
export async function updateFood(
  id: string,
  patch: FoodUpdate
): Promise<Food | null> {
  const db = await getDb();
  const existing = await db.getFirstAsync<Food>(
    "SELECT * FROM foods WHERE id = ? AND (is_custom = 1 OR source = 'off');",
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
  if (patch.category !== undefined) {
    fields.push("category = ?");
    values.push(patch.category);
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
  // Explicit null (not just omitted) is how app/add-food.tsx's "clear" button
  // reverts to lib/foodMeta's own emojiFor/category match - see
  // resolveFoodEmoji - so this checks `!== undefined`, same as every other
  // nullable field above.
  if (patch.emoji !== undefined) {
    fields.push("emoji = ?");
    values.push(patch.emoji?.trim() || null);
  }

  if (fields.length > 0) {
    values.push(id);
    await db.runAsync(
      `UPDATE foods SET ${fields.join(", ")} WHERE id = ? AND (is_custom = 1 OR source = 'off');`,
      values
    );
  }
  return getFood(id);
}

/** Deletes a custom food or a cached barcode result; the seeded catalog
 *  (is_custom = 0, source not 'off') is never touched by this.
 *
 *  meal_logs.food_id is ON DELETE SET NULL, so a meal logged with the food would
 *  lose its only name. Meals without a name of their own get `name` first, in the
 *  same transaction, so the history keeps reading "Annemin keki". */
export async function deleteFood(id: string, name: string): Promise<void> {
  const db = await getDb();
  const label = name.trim();
  // inDbTransaction, not withTransactionAsync: BEGIN IMMEDIATE and the shared
  // write lock (see lib/db/meals.ts), so a concurrent import cannot make the
  // lock upgrade fail.
  await inDbTransaction(async () => {
    if (label) {
      await db.runAsync(
        "UPDATE meal_logs SET custom_food_name = ? WHERE food_id = ? AND TRIM(COALESCE(custom_food_name, '')) = '' AND EXISTS (SELECT 1 FROM foods WHERE id = ? AND (is_custom = 1 OR source = 'off'));",
        [label, id, id]
      );
    }
    await db.runAsync(
      "DELETE FROM foods WHERE id = ? AND (is_custom = 1 OR source = 'off');",
      [id]
    );
  });
}

/* ── Portion presets (schema v23, ./types.ts FoodPortion) ──────────────────
 *
 * A per-food list of preset serving sizes; food_portions has no row for a
 * food that offers none, which is the ordinary case for most of the catalog. */

/** One food's presets, in the order the picker should show them. */
export async function listPortions(foodId: string): Promise<FoodPortion[]> {
  const db = await getDb();
  return db.getAllAsync<FoodPortion>(
    "SELECT * FROM food_portions WHERE food_id = ? ORDER BY sort ASC, id ASC;",
    [foodId]
  );
}

/**
 * Replaces one food's whole preset list. Used by the seed side (a catalog
 * update that ships a new preset list for a food) and by any future editor:
 * always the full set at once, since a preset has no identity of its own
 * outside its position in this list.
 */
export async function replacePortions(
  foodId: string,
  rows: ReadonlyArray<readonly [PortionLabelKey, number]>
): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM food_portions WHERE food_id = ?;", [foodId]);
    for (let i = 0; i < rows.length; i++) {
      const [labelKey, grams] = rows[i];
      await db.runAsync(
        "INSERT INTO food_portions (food_id, label_key, grams, sort) VALUES (?, ?, ?, ?);",
        [foodId, labelKey, grams, i]
      );
    }
  });
}
