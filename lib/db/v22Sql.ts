/**
 * The schema v22 statements, kept in a dependency-free module so the migration
 * test (scripts/migration.test.ts) can execute the REAL SQL against a scratch
 * database - the same arrangement as v8Sql..v21Sql.
 *
 * v22 does two independent things:
 *
 *   a) Two nullable free-text columns on user_profiles - basal_insulin_other /
 *      bolus_insulin_other - for a product the insulin catalog (see
 *      ../insulinCatalog) does not carry. Populated only when the matching
 *      *_insulin_id is the catalog's OTHER_PRODUCT_ID ("other"). Plain
 *      guarded ADD COLUMNs, exactly like v15/v16/v19/v20/v21: no table is
 *      rebuilt and no row is read or rewritten by this part.
 *
 *   b) "unset" joins the period_tag value set (see ../periodTag and
 *      ./types PeriodTag) - what a Health import now carries instead of a
 *      guessed period, because a guess about WHEN something was eaten is not
 *      the same fact as an imported READING and dressing it up as one is
 *      misleading (see lib/periodTag.ts's own header). SQLite cannot ALTER a
 *      CHECK constraint, so sugar_logs is rebuilt with 'unset' added to it -
 *      the same "SQLite can't widen a CHECK in place" reason v8/v9/v11
 *      rebuilt injection_logs. The widened CHECK is a strict superset of the
 *      old one, so every existing row's period_tag - whatever it already
 *      was - stays valid and is copied unchanged; nothing but period_tag is
 *      ever set to 'unset', and even that is a separate, targeted UPDATE
 *      (V22_SELECT_HEALTH_ROWS + the chunked backfill in migrateToV22), never
 *      part of the copy itself.
 *
 *   c) Two nullable free-text columns on injection_logs -
 *      insulin_product_id / insulin_product_other - so an injection carries
 *      its OWN product, not just a dose. The profile's basal_insulin_id
 *      (schema v15) is only ever a PREFILL source for a new entry
 *      (app/(tabs)/injection.tsx); once a row is logged it must not shift
 *      when the profile's product is changed later, so the row keeps its own
 *      copy. Same shape as (a) - insulin_product_other holds the free-text
 *      name when insulin_product_id is the catalog's OTHER_PRODUCT_ID. No
 *      CHECK: the catalog id set is validated in TypeScript (see
 *      ../insulinCatalog), and free text cannot be constrained either way.
 *      Plain guarded ADD COLUMNs; injection_logs itself is not rebuilt.
 */

export const V22_PROFILE_COLUMNS: { name: string; type: string }[] = [
  { name: "basal_insulin_other", type: "TEXT" },
  { name: "bolus_insulin_other", type: "TEXT" },
];

export const V22_INJECTION_COLUMNS: { name: string; type: string }[] = [
  { name: "insulin_product_id", type: "TEXT" },
  { name: "insulin_product_other", type: "TEXT" },
];

/** The full v22 period_tag value set, shared by the rebuilt CHECK below and by
 *  createSchemaV1's fresh-install DDL (lib/db/index.ts), so both paths end up
 *  with the same sugar_logs shape. */
export const V22_PERIOD_TAG_LIST = [
  "fasting",
  "pre_meal",
  "post_meal_2h",
  "bedtime",
  "manual",
  "unset",
] as const;

const PERIOD_TAG_SQL_LIST = V22_PERIOD_TAG_LIST.map((t) => `'${t}'`).join(",");

/** A half-finished previous attempt must not contribute rows to this one. */
export const V22_DROP_SCRATCH = "DROP TABLE IF EXISTS sugar_logs_v22;";

export const V22_CREATE_SUGAR_LOGS = `
  CREATE TABLE sugar_logs_v22 (
    id TEXT PRIMARY KEY NOT NULL,
    profile_id TEXT NOT NULL,
    glucose_level_mgdl INTEGER NOT NULL,
    period_tag TEXT NOT NULL DEFAULT 'manual'
      CHECK (period_tag IN (${PERIOD_TAG_SQL_LIST})),
    source TEXT NOT NULL DEFAULT 'manual',
    logged_at TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    healthkit_uuid TEXT,
    FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE
  );
`;

/** Copies every reading verbatim. Every value an old row could already hold is
 *  still valid under the widened CHECK above, so - unlike v9's site rebuild,
 *  which also renamed values - no fallback CASE is needed. */
export const V22_COPY_SUGAR_LOGS = `
  INSERT INTO sugar_logs_v22
    (id, profile_id, glucose_level_mgdl, period_tag, source, logged_at, tags, healthkit_uuid)
  SELECT id, profile_id, glucose_level_mgdl, period_tag, source, logged_at, tags, healthkit_uuid
  FROM sugar_logs;
`;

export const V22_DROP_OLD_SUGAR_LOGS = "DROP TABLE sugar_logs;";
export const V22_RENAME_SUGAR_LOGS =
  "ALTER TABLE sugar_logs_v22 RENAME TO sugar_logs;";
export const V22_SUGAR_INDEX =
  "CREATE INDEX IF NOT EXISTS idx_sugar_profile ON sugar_logs (profile_id, logged_at DESC);";

/** Only the rows the backfill below can ever touch. */
export const V22_SELECT_HEALTH_ROWS =
  "SELECT id, logged_at, period_tag FROM sugar_logs WHERE source = 'health';";

/** UPDATEs run in id chunks this size, well under SQLite's default 999-bound-
 *  parameter ceiling (one bound value per id in the IN list). */
export const V22_BACKFILL_CHUNK_SIZE = 500;

/**
 * The pre-v22 automatic guess a Health import's period_tag used to carry
 * (lib/services/health.ts's now-removed pickTagForHour - see ../periodTag for
 * what replaced it), reproduced here ONLY so this migration can recognise a
 * row that still carries it untouched.
 */
export function legacyAutoPeriodTag(
  hour: number
): "bedtime" | "fasting" | "manual" {
  if (hour >= 22 || hour < 1) return "bedtime";
  if (hour < 9) return "fasting";
  return "manual";
}

/**
 * True when a source='health' row's stored period_tag is STILL exactly what
 * the old hour-based guess would have produced for its logged_at - i.e. the
 * user never touched it and it is safe to blank out. False for any row whose
 * tag was changed by hand, which is the whole reason this checks equality
 * instead of unconditionally overwriting every health row.
 *
 * `logged_at` is UTC ISO text; the guess it reproduces read the LOCAL wall
 * clock, so this goes through `Date` in TypeScript rather than SQL's
 * strftime, which has no notion of the device's own timezone.
 */
export function matchesLegacyAutoPeriodTag(
  loggedAtIso: string,
  periodTag: string
): boolean {
  const hour = new Date(loggedAtIso).getHours();
  return legacyAutoPeriodTag(hour) === periodTag;
}
