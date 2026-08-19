/**
 * The schema v18 statements, kept in a dependency-free module so the migration
 * test (scripts/migration.test.ts) can execute the REAL SQL against a scratch
 * database - the same arrangement as v13Sql/v14Sql/v16Sql/v17Sql.
 *
 * v18 adds the per-profile medication NAME REGISTRY (the "meds" table): a short
 * list of names the user has already typed once, most-recently-used first, so
 * logging a repeat medication is a tap instead of retyping. It is completely
 * separate from med_logs (schema v16, the diary of what was actually taken and
 * when, see lib/db/meds.ts) - renaming or deleting a saved name here never
 * rewrites or deletes a single past diary entry.
 *
 * CREATE TABLE/INDEX IF NOT EXISTS plus ONE idempotent backfill (below): no
 * existing table is altered or rebuilt, so nothing already stored can be lost
 * and a re-run is a no-op (the v14/v16/v17 pattern).
 */

/**
 * `name` is NOT NULL (unlike med_logs.name, which allows an unnamed entry): a
 * saved shortcut with no name is not a shortcut for anything. `profile_id` +
 * `name` is UNIQUE, so the same name is never saved twice for one profile -
 * upsertMedUse (./meds.ts) relies on exactly that to tell "already saved" from
 * "first time" apart. `last_used_at` / `created_at` are epoch MILLISECONDS,
 * like med_logs.taken_at, not the ISO text the older log tables carry.
 */
export const V18_CREATE_MEDS = `
  CREATE TABLE IF NOT EXISTS meds (
    id TEXT PRIMARY KEY NOT NULL,
    profile_id TEXT NOT NULL,
    name TEXT NOT NULL,
    last_used_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (profile_id, name),
    FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE
  );`;

/** The profile's own list, most-recently-used first (listSavedMeds in
 *  ./meds.ts); also the foreign-key CHILD column (see ./v12Sql for why that
 *  needs its own index rather than relying on SQLite's automatic parent-side
 *  one). */
export const V18_INDEX_MEDS_PROFILE =
  "CREATE INDEX IF NOT EXISTS idx_meds_profile ON meds (profile_id, last_used_at DESC);";

/** Create-only DDL; applied in order, each statement independently idempotent. */
export const V18_CREATE: string[] = [V18_CREATE_MEDS, V18_INDEX_MEDS_PROFILE];

/**
 * The one-time backfill (migrateToV18 only, in ./migrations.ts - never part of
 * a fresh install, which has no med_logs history to backfill from): every
 * profile's distinct non-blank med_logs.name becomes a seed row, so an
 * existing user's saved list starts already populated instead of empty. Same
 * name filter as distinctMedNames used to use (./meds.ts). `last_used_at` (and
 * `created_at`, seeded to the same value) is the most recent `taken_at` that
 * name was actually logged at.
 *
 * INSERT OR IGNORE plus the UNIQUE(profile_id, name) constraint is what makes
 * this idempotent: an install already migrated - or resumed after a kill
 * between this statement and migrateToV18's stamp - inserts nothing a first
 * run already did. That covers every real case: the stamp lands in the SAME
 * transaction as this statement (see migrateToV18 in ./migrations.ts), so
 * nothing the user does afterwards - including renaming a saved name through
 * the registry (lib/db/meds.ts's renameMed) - can be followed by this
 * statement running again against the row it renamed.
 *
 * The id is generated in SQL (`lower(hex(randomblob(16)))`), not the app's own
 * uuid() (lib/uuid.ts): that helper pulls in expo-crypto, and this file has to
 * stay runnable by scripts/migration.test.ts under plain Node (see the
 * dependency-free note at the top of ./migrations.ts). It is never read back
 * as an RFC4122 UUID, only compared for equality, so the shape difference from
 * the app's own ids has no effect on anything that reads this table.
 */
export const V18_SEED_FROM_MED_LOGS = `
  INSERT OR IGNORE INTO meds (id, profile_id, name, last_used_at, created_at)
  SELECT lower(hex(randomblob(16))),
         profile_id,
         name,
         MAX(taken_at),
         MAX(taken_at)
  FROM med_logs
  WHERE name IS NOT NULL AND name <> ''
  GROUP BY profile_id, name;`;
