/**
 * The catalog's own version number, kept OUT of ./seed.ts on purpose.
 *
 * lib/db/index.ts has to answer "does this install already have the current
 * catalog?" on every cold start, and ./seed.ts is a 1000-plus element literal it
 * deliberately does not parse unless it is about to insert from it. So the
 * question is answered from this two-constant module instead: the number is read
 * on every launch, the data behind it almost never.
 *
 * BUMP THIS whenever SEED_FOODS gains rows. Nothing else triggers the top-up,
 * and without a bump the new foods only ever reach fresh installs.
 *
 *   1  the original 562-food catalog (implicit: installs that predate the
 *      marker report 0, which is treated the same as 1 for our purposes since
 *      the top-up is keyed on names, not on the number)
 *   2  the expansion to 1152 foods
 *   3  the name_it/name_pt/name_ar/name_ja + food_portions schema (v23); also
 *      the version that makes syncSeedCatalog (./index.ts) start comparing
 *      every already-seeded row against the catalog's own current values, not
 *      just inserting what is missing - see selectFoodsToUpdate below.
 *   4  household-measure presets for ~300 more foods (./seedPortions) and the
 *      ./seedCarb file for source-tagged new rows (empty so far). Existing
 *      untouched rows get the presets via the same update path; edited or
 *      custom rows are never reached.
 *   5  value corrections from the USDA/OFF audit (docs/food-sources.md): 100 g
 *      carb for polenta, spinach borek, pasta, pita, fried rice, boiled potato,
 *      chia and flaxseed, corrected household grams in ./seedPortions, the
 *      Salep rows reconciled, and the 10 sourced rows in ./seedCarb now carry
 *      it/pt/ar/ja names and presets. Existing untouched rows catch up through
 *      the same update path.
 *   6  second audit round: more 100 g carb corrections (mixed dishes, polenta,
 *      rice pilaf), biscotti/chouquette/gummy/multigrain presets, and
 *      selectFoodsToUpdate now follows RENAMED_EN so a renamed untouched row
 *      (Flapjack, Chouquette) gets its name_en and values updated in place.
 *   7  household-measure presets for the meal-compose scene foods that had
 *      none (Ciabatta, Camembert, Filter coffee, the tea rows). Untouched rows
 *      get them through the same update path.
 *   8  USDA household cups for cooked pasta shapes, egg noodles, sticky rice,
 *      teff, spelt, pearl barley, oat bran, rice and buckwheat flour and a
 *      sheep-milk glass (./seedPortions), so the US cup chips have a gram
 *      figure for them. Untouched rows get them through the same update path.
 *   9  sourced 100 g carb corrections for jambalaya, tteokbokki, chilaquiles,
 *      shepherd's pie and gumbo (docs/food-sources.md). Untouched rows catch up
 *      through the same update path.
 */

// A type-only import: erased at build time, so reading this module never pulls
// the catalog itself into memory. That is the whole point of the split.
import type { PortionLabelKey } from "./types";
import type { SeedFood } from "./seed";

export const SEED_CATALOG_VERSION = 9;

/** The app_meta key the number above is stored under (schema v14). */
export const SEED_CATALOG_VERSION_KEY = "seed_catalog_version";

/**
 * How a food name is compared. Case-insensitive because "Ekmek" and "ekmek" are
 * the same food to the person reading the list, and trimmed because a stray
 * space is not a different food either.
 *
 * Invariant lowercasing, NOT the Turkish one the rest of the app uses for
 * display. This key is matched against name_en, and Turkish casing turns an
 * uppercase "I" into "ı": a user who typed a food in capitals would stop
 * matching the catalog entry with the same name and get a second, duplicate row.
 * The identity of a stored string is not a language question.
 */
export function seedNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * English names that changed between catalog releases, old name first. The
 * top-up matches purely on name_en (selectMissingFoods below), so a rename in
 * lib/db/seed.ts looks, to an install that predates it, exactly like the old
 * food got deleted and a new one got added: it still has a row named
 * "Gingerbread", the catalog now ships "Gingerbread cookie", the names do not
 * match, and the top-up inserts the "new" food as a permanent duplicate.
 *
 * Every rename EVER made to an `en:` field belongs here, added in the same
 * commit as the rename. HUMAN-TODO.md carries the pre-commit tripwire for
 * this (`git diff HEAD -- lib/db/seed.ts | grep '^-' | grep 'en:'`): any old
 * `en:` name the diff removes must either reappear unchanged elsewhere in the
 * catalog or get an entry here.
 */
const RENAMED_EN: Readonly<Record<string, string>> = {
  Gingerbread: "Gingerbread cookie",
  "Chouquette (plain cream puff)": "Chouquette (cream puff)",
  Flapjack: "Flapjack (oat bar)",
};

/** RENAMED_EN, keyed and valued the same way names are compared (seedNameKey). */
const RENAMED_EN_KEYS: ReadonlyMap<string, string> = new Map(
  Object.entries(RENAMED_EN).map(([oldName, newName]) => [
    seedNameKey(oldName),
    seedNameKey(newName),
  ])
);

/**
 * Which catalog foods a database does not have yet: the top-up's entire
 * decision, kept pure so it can be tested against a real database without the
 * native SQLite module (scripts/migration.test.ts).
 *
 * `existingNames` is EVERY name_en in the foods table, not just the seeded ones.
 * Matching against the user's own rows too is deliberate: someone who long ago
 * typed in a food we are only now shipping should keep theirs and should not end
 * up looking at two rows with the same name. Nothing here decides to overwrite
 * anything; the caller only ever INSERTs what comes back.
 *
 * An existing row carrying a since-renamed name (RENAMED_EN) also marks the
 * NEW name as known, so a rename never reads as a missing food on an install
 * that still has the old one.
 */
export function selectMissingFoods(
  catalog: readonly SeedFood[],
  existingNames: Iterable<string | null | undefined>
): SeedFood[] {
  const known = new Set<string>();
  for (const name of existingNames) {
    const key = seedNameKey(name ?? "");
    if (!key) continue;
    known.add(key);
    const renamedTo = RENAMED_EN_KEYS.get(key);
    if (renamedTo) known.add(renamedTo);
  }
  return catalog.filter((f) => !known.has(seedNameKey(f.en)));
}

/** The `foods` columns selectFoodsToUpdate needs to decide whether a row is
 *  still what the catalog says it should be. Pulled from ALL rows by the
 *  caller (like selectMissingFoods above), never from a pre-filtered query:
 *  the is_custom/source check below is what excludes an edited row, done in
 *  JS so it stays testable without the native SQLite module. */
export interface ExistingSeedFoodRow {
  id: string;
  name_en: string | null;
  name_tr: string;
  name_de: string;
  name_es: string;
  name_fr: string;
  name_it: string | null;
  name_pt: string | null;
  name_ar: string | null;
  name_ja: string | null;
  carb_100g: number;
  glycemic_index: number;
  portion_size_g: number;
  is_custom: number;
  source: string | null;
}

/** A pending change to one already-seeded row; only the fields that actually
 *  differ from the catalog are present, so the caller's UPDATE only ever
 *  touches what changed. */
export interface SeedFoodUpdate {
  id: string;
  /** Present only when the row still carries a name_en listed in RENAMED_EN. */
  name_en?: string;
  name_tr?: string;
  name_de?: string;
  name_es?: string;
  name_fr?: string;
  name_it?: string;
  name_pt?: string;
  name_ar?: string;
  name_ja?: string;
  carb_100g?: number;
  glycemic_index?: number;
  glycemic_load?: number;
  portion_size_g?: number;
  /** Present only when the catalog gives this food a preset list; the caller
   *  replaces the food's whole food_portions set with it (lib/db/foods.ts
   *  replacePortions), unconditionally - a preset has no identity of its own
   *  to diff against the stored set field by field. */
  portions?: ReadonlyArray<readonly [PortionLabelKey, number]>;
}

/**
 * Which already-seeded rows need to catch up with a catalog value that
 * changed since they were inserted (a corrected carb figure, a fixed
 * translation, a newly-added it/pt/ar/ja name or preset list) - the other
 * half of what a catalog version bump can mean, alongside selectMissingFoods'
 * brand-new rows.
 *
 * Scoped to is_custom = 0 AND source IS NULL - a row the user has renamed,
 * corrected or turned into their own is neither anymore, so it drops out of
 * this set the moment they touch it and this function can never reach it.
 * Matched the same way selectMissingFoods matches, by name_en (RENAMED_EN is
 * not consulted here: a renamed row's OLD name_en no longer equals any
 * catalog entry's `en`, so it simply stops matching anything, exactly like an
 * install that has not been topped up yet for that food's insert side).
 */
export function selectFoodsToUpdate(
  catalog: readonly SeedFood[],
  existingRows: readonly ExistingSeedFoodRow[]
): SeedFoodUpdate[] {
  const byNameEn = new Map<string, SeedFood>();
  for (const f of catalog) byNameEn.set(seedNameKey(f.en), f);

  const existingKeys = new Set(existingRows.map((r) => seedNameKey(r.name_en ?? "")));

  const updates: SeedFoodUpdate[] = [];
  for (const row of existingRows) {
    if (row.is_custom !== 0 || row.source !== null) continue;
    const key = seedNameKey(row.name_en ?? "");
    if (!key) continue;
    let seed = byNameEn.get(key);
    let renamedTo: string | undefined;
    if (!seed) {
      const newKey = RENAMED_EN_KEYS.get(key);
      const target = newKey ? byNameEn.get(newKey) : undefined;
      if (!newKey || !target || existingKeys.has(newKey)) continue;
      seed = target;
      renamedTo = target.en;
    }

    const update: SeedFoodUpdate = { id: row.id };
    let changed = false;
    if (renamedTo !== undefined) {
      update.name_en = renamedTo;
      changed = true;
    }

    if (seed.tr !== row.name_tr) {
      update.name_tr = seed.tr;
      changed = true;
    }
    if (seed.de !== row.name_de) {
      update.name_de = seed.de;
      changed = true;
    }
    if (seed.es !== row.name_es) {
      update.name_es = seed.es;
      changed = true;
    }
    if (seed.fr !== row.name_fr) {
      update.name_fr = seed.fr;
      changed = true;
    }
    if (typeof seed.it === "string" && seed.it !== row.name_it) {
      update.name_it = seed.it;
      changed = true;
    }
    if (typeof seed.pt === "string" && seed.pt !== row.name_pt) {
      update.name_pt = seed.pt;
      changed = true;
    }
    if (typeof seed.ar === "string" && seed.ar !== row.name_ar) {
      update.name_ar = seed.ar;
      changed = true;
    }
    if (typeof seed.ja === "string" && seed.ja !== row.name_ja) {
      update.name_ja = seed.ja;
      changed = true;
    }

    if (seed.carb !== row.carb_100g || seed.gi !== row.glycemic_index) {
      update.carb_100g = seed.carb;
      update.glycemic_index = seed.gi;
      update.glycemic_load = Math.round((seed.gi * seed.carb) / 100);
      changed = true;
    }

    const seedPortionSize = seed.portion ?? 100;
    if (seedPortionSize !== row.portion_size_g) {
      update.portion_size_g = seedPortionSize;
      changed = true;
    }

    if (seed.portions && seed.portions.length > 0) {
      update.portions = seed.portions;
      changed = true;
    }

    if (changed) updates.push(update);
  }
  return updates;
}
