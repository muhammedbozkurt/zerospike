/**
 * The schema v23 statements, kept in a dependency-free module so the migration
 * test (scripts/migration.test.ts) can execute the REAL SQL against a scratch
 * database - the same arrangement as v13Sql/v14Sql/v16Sql/v17Sql/v18Sql/v20Sql.
 *
 * v23 widens the food catalogue with four more name columns (name_it, name_pt,
 * name_ar, name_ja - all nullable, unlike the original five which are NOT NULL
 * DEFAULT ''), and adds food_portions, a per-food list of preset serving sizes
 * ("1 slice" = 30 g) the calculator can offer instead of a bare gram field.
 *
 * The new name columns force foods_fts to be rebuilt: FTS5 has no ALTER TABLE
 * ADD COLUMN, so the only way to widen it is DROP + CREATE with the new column
 * list, then repopulate from `foods` (the table is NOT external-content, so
 * there is no automatic "rebuild" command - the repopulate is a plain INSERT
 * ... SELECT). The three sync triggers (foods_ai/ad/au) are dropped and
 * recreated alongside it so they write the two new columns too.
 */

import { PORTION_LABEL_KEYS } from "./types";

export const V23_FOODS_COLUMNS: { name: string; type: string }[] = [
  { name: "name_it", type: "TEXT" },
  { name: "name_pt", type: "TEXT" },
  { name: "name_ar", type: "TEXT" },
  { name: "name_ja", type: "TEXT" },
];

/** Portion preset label, a closed enum resolved from i18n (`portions.<key>`) -
 *  never free text, so it stays translated and searchable the same way a food
 *  name is. Re-exported straight from PORTION_LABEL_KEYS in ./types (the CHECK
 *  below is built from it) so the two can never drift apart. */
export const V23_PORTION_LABEL_KEYS: readonly string[] = PORTION_LABEL_KEYS;

/** food_id is TEXT: foods.id is a UUID string, not an integer. ON DELETE
 *  CASCADE, so removing a custom food (the only kind whose portions this app
 *  ever writes to today) removes its presets with it - see replacePortions in
 *  ./foods.ts. */
export const V23_CREATE_FOOD_PORTIONS = `
  CREATE TABLE IF NOT EXISTS food_portions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    food_id TEXT NOT NULL,
    label_key TEXT NOT NULL CHECK (label_key IN (${V23_PORTION_LABEL_KEYS.map((k) => `'${k}'`).join(",")})),
    grams REAL NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (food_id) REFERENCES foods (id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_food_portions_food ON food_portions (food_id);
`;

export const V23_DROP_TRIGGERS = `
  DROP TRIGGER IF EXISTS foods_ai;
  DROP TRIGGER IF EXISTS foods_ad;
  DROP TRIGGER IF EXISTS foods_au;
`;

export const V23_DROP_FTS = `DROP TABLE IF EXISTS foods_fts;`;

/** Ten name columns (was six) + aliases + brand, keyed by the food UUID. Same
 *  shape a fresh install's createSchemaV1 creates directly (see ./index.ts). */
export const V23_CREATE_FTS = `
  CREATE VIRTUAL TABLE IF NOT EXISTS foods_fts USING fts5(
    food_id UNINDEXED,
    name_tr, name_en, name_de, name_es, name_fr, name_it, name_pt, name_ar, name_ja,
    aliases, brand,
    tokenize = 'unicode61 remove_diacritics 2'
  );
`;

export const V23_CREATE_TRIGGERS = `
  CREATE TRIGGER IF NOT EXISTS foods_ai AFTER INSERT ON foods BEGIN
    INSERT INTO foods_fts (food_id, name_tr, name_en, name_de, name_es, name_fr,
                            name_it, name_pt, name_ar, name_ja, aliases, brand)
    VALUES (new.id, new.name_tr, new.name_en, new.name_de, new.name_es, new.name_fr,
            new.name_it, new.name_pt, new.name_ar, new.name_ja,
            new.aliases_json, COALESCE(new.brand_name, ''));
  END;

  CREATE TRIGGER IF NOT EXISTS foods_ad AFTER DELETE ON foods BEGIN
    DELETE FROM foods_fts WHERE food_id = old.id;
  END;

  CREATE TRIGGER IF NOT EXISTS foods_au AFTER UPDATE ON foods BEGIN
    DELETE FROM foods_fts WHERE food_id = old.id;
    INSERT INTO foods_fts (food_id, name_tr, name_en, name_de, name_es, name_fr,
                            name_it, name_pt, name_ar, name_ja, aliases, brand)
    VALUES (new.id, new.name_tr, new.name_en, new.name_de, new.name_es, new.name_fr,
            new.name_it, new.name_pt, new.name_ar, new.name_ja,
            new.aliases_json, COALESCE(new.brand_name, ''));
  END;
`;

/** Repopulates foods_fts from the live `foods` table after the drop + create
 *  above. Only run on the MIGRATION path: a fresh install's foods table is
 *  still empty at this point (createSchemaV1 seeds it afterwards), so there is
 *  nothing to copy and the insert trigger fires per row exactly as before. */
export const V23_REBUILD_FTS = `
  INSERT INTO foods_fts (food_id, name_tr, name_en, name_de, name_es, name_fr,
                          name_it, name_pt, name_ar, name_ja, aliases, brand)
  SELECT id, name_tr, name_en, name_de, name_es, name_fr,
         name_it, name_pt, name_ar, name_ja, aliases_json, COALESCE(brand_name, '')
  FROM foods;
`;
