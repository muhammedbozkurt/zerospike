import type { DateRange } from "../insights";

/**
 * The journal feed query, kept dependency-free (no expo-sqlite import) so
 * scripts/journal.test.ts executes the REAL SQL against a scratch database -
 * the same arrangement as v8Sql/v9Sql/v11Sql and the migration test.
 *
 * ONE ordered, limited UNION over the three log tables. The three tables used to
 * be queried and limited separately and merged in JS, which read `limit` rows of
 * every kind to display `limit` rows of the merged feed (300 → 900) and made the
 * limit mean nothing in particular.
 *
 * The date range is part of the SQL for the same reason: reports and exports ask
 * for a SPAN, and finding that span inside "the newest N rows" silently returned
 * an incomplete document once the profile had more history than N.
 */

/** Placeholder order: profile_id (+ range bounds) per branch, then the limit. */
export function journalFeedArgs(
  profileId: string,
  limit: number,
  range?: DateRange
): (string | number)[] {
  const args: (string | number)[] = [];
  for (let branch = 0; branch < 3; branch++) {
    args.push(profileId);
    if (range) {
      args.push(
        new Date(range.start).toISOString(),
        new Date(range.end).toISOString()
      );
    }
  }
  // The med branch, last in the union. Its bounds are epoch MILLISECONDS, not
  // ISO text: med_logs.taken_at is an INTEGER column (schema v16), and SQLite
  // compares an integer against a string by type before value, so ISO bounds
  // here would silently match no medication row at all.
  args.push(profileId);
  if (range) args.push(range.start, range.end);
  args.push(limit);
  return args;
}

/**
 * `withRange` must match the args built above. `ord` reproduces the old merge
 * order for entries sharing a timestamp (a meal save writes its reading and the
 * meal at the same instant), so the feed reads exactly as it did before.
 *
 * The med branch (schema v16) is the one table whose time column is not ISO text
 * but epoch milliseconds, so it is converted to that same ISO instant INSIDE the
 * union. Without the conversion nothing sorts: SQLite orders by type first, so
 * every integer timestamp would sink below every string one and medication
 * entries would sit in a block at the end of the feed instead of in the day they
 * belong to. `%f` is seconds with the fraction, which makes the produced string
 * byte-identical to the `Date#toISOString()` the other three branches store.
 *
 * `excludeCalculatorInjections` drops the bolus row a meal save auto-writes
 * (injection_logs.source = 'calculator') from the injection branch, so the
 * dashboard's journal can stop showing it as a second line directly under the
 * meal it belongs to. It is an opt-in filter, not a default: the row is still
 * the only place active-insulin (IOB) is computed from, and a report or export
 * built on this same query must keep seeing it, so every caller other than the
 * dashboard's own journal list leaves this false. The condition lives in the
 * WHERE clause of the branch, inside the UNION, so it is applied before the
 * outer ORDER BY / LIMIT rather than after - filtering post-LIMIT would spend
 * the row budget on rows that then get hidden, showing fewer than intended.
 */
export function journalFeedSql(
  withRange: boolean,
  excludeCalculatorInjections = false
): string {
  const bounds = (col: string) =>
    withRange ? ` AND ${col} BETWEEN ? AND ?` : "";
  const notCalculator = excludeCalculatorInjections
    ? " AND (i.source IS NULL OR i.source <> 'calculator')"
    : "";
  return `SELECT * FROM (
       SELECT 'glucose' AS kind, s.id AS id, s.logged_at AS logged_at, s.tags AS tags,
              0 AS ord,
              s.glucose_level_mgdl AS glucose_level_mgdl, s.period_tag AS period_tag,
              s.source AS source,
              NULL AS food_id, NULL AS sugar_log_id, NULL AS custom_food_name,
              NULL AS portion_g, NULL AS calculated_carbs_g, NULL AS insulin_dose_units,
              NULL AS photo_uri_local, NULL AS personal_note,
              NULL AS name_tr, NULL AS name_en, NULL AS name_de, NULL AS name_es,
              NULL AS name_fr, NULL AS category,
              NULL AS site, NULL AS site_point, NULL AS dose_units,
              NULL AS insulin_type, NULL AS bolus_kind, NULL AS note,
              s.healthkit_uuid AS healthkit_uuid, NULL AS med_name,
              NULL AS insulin_product_id, NULL AS insulin_product_other
         FROM sugar_logs s
        WHERE s.profile_id = ?${bounds("s.logged_at")}
       UNION ALL
       SELECT 'meal', m.id, m.logged_at, m.tags,
              1,
              NULL, NULL, NULL,
              m.food_id, m.sugar_log_id, m.custom_food_name,
              m.portion_g, m.calculated_carbs_g, m.insulin_dose_units,
              m.photo_uri_local, m.personal_note,
              f.name_tr, f.name_en, f.name_de, f.name_es, f.name_fr, f.category,
              NULL, NULL, NULL, NULL, NULL, NULL,
              NULL, NULL,
              NULL, NULL
         FROM meal_logs m LEFT JOIN foods f ON f.id = m.food_id
        WHERE m.profile_id = ?${bounds("m.logged_at")}
       UNION ALL
       SELECT 'injection', i.id, i.logged_at, i.tags,
              2,
              NULL, NULL, i.source,
              NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
              NULL, NULL, NULL, NULL, NULL, NULL,
              i.site, i.site_point, i.dose_units, i.insulin_type, i.bolus_kind, i.note,
              NULL, NULL,
              i.insulin_product_id, i.insulin_product_other
         FROM injection_logs i
        WHERE i.profile_id = ?${bounds("i.logged_at")}${notCalculator}
       UNION ALL
       SELECT 'med', d.id,
              strftime('%Y-%m-%dT%H:%M:%fZ', d.taken_at / 1000.0, 'unixepoch'),
              NULL,
              3,
              NULL, NULL, NULL,
              NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
              NULL, NULL, NULL, NULL, NULL, NULL,
              NULL, NULL, NULL, NULL, NULL, d.note,
              NULL, d.name,
              NULL, NULL
         FROM med_logs d
        WHERE d.profile_id = ?${withRange ? " AND d.taken_at BETWEEN ? AND ?" : ""}
     )
     ORDER BY logged_at DESC, ord
     LIMIT ?;`;
}
