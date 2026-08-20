/**
 * The schema v20 statement, kept in a dependency-free module so the migration
 * test (scripts/migration.test.ts) can execute the REAL SQL against a scratch
 * database - the same arrangement as
 * v13Sql/v14Sql/v15Sql/v16Sql/v17Sql/v18Sql/v19Sql.
 *
 * v20 adds ONE column to the food catalogue (schema v1, see lib/db/index.ts
 * createSchemaV1):
 *
 *   - emoji   the user's own icon for a food they can edit (custom, or an
 *             Open Food Facts barcode cache - see the isEditableFood rule in
 *             app/(tabs)/food.tsx), picked from app/add-food.tsx's emoji
 *             grid. NULL until they pick one, and NULL forever for the
 *             seeded catalogue - a seeded row is never editable and always
 *             shows lib/foodMeta emojiFor's own keyword match instead (see
 *             resolveFoodEmoji, also in lib/foodMeta, the one place that
 *             decides food.emoji vs emojiFor for every surface that draws a
 *             per-dish plate).
 *
 * A plain ALTER TABLE ADD COLUMN (no CHECK, no rebuild): the v8/v9/v11 lesson
 * is that a rebuild is the only thing that risks a row, and this column needs
 * none. `V20_FOODS_COLUMNS` is consumed twice - once (guarded) by
 * migrateToV20 for a migrating install, and once (unconditionally, since the
 * table was JUST created) by createSchemaV1's fresh-install path in
 * ./index.ts - so both paths run the exact same ALTER statement onto the
 * exact same freshly-created foods table, and end up with byte-identical
 * foods DDL.
 */

export const V20_FOODS_COLUMNS: { name: string; type: string }[] = [
  { name: "emoji", type: "TEXT" },
];
