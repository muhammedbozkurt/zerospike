/**
 * The schema v14 statements, kept dependency-free so the migration test
 * (scripts/migration.test.ts) executes the REAL SQL against a scratch database -
 * the same arrangement as v8Sql/v9Sql/v11Sql/v12Sql/v13Sql.
 *
 * v14 adds ONE table and touches nothing else:
 *
 *   - app_meta   a key/value store for facts about the database itself.
 *
 * Its first and only key is the seed catalog version (see ./seedVersion.ts).
 * Until now the food catalog was written once, on the very first launch, and an
 * install that already existed never saw a food added afterwards: seedFoods()
 * returns early the moment it finds a single seeded row. Everyone already using
 * the app was therefore frozen on the catalog they installed with.
 *
 * A version marker is what makes a TOP-UP possible and safe to repeat: the app
 * compares the stored number with the current one, and only when it is behind
 * does it read the catalog and insert the foods this database does not have yet.
 * The comparison is one indexed lookup, so the launch path stays as cheap as the
 * early return it replaces.
 *
 * Why a table rather than AsyncStorage (where the one-off v8 onboarding carry
 * keeps its flag): this fact describes the DATABASE. It has to travel with the
 * database file through a backup, a restore or a device transfer, and it has to
 * be wrong in the same direction as the data if either is ever rolled back. A
 * marker stored somewhere else can say "already topped up" about a database that
 * was replaced underneath it.
 *
 * CREATE TABLE IF NOT EXISTS and nothing more: no existing table is read,
 * written, rebuilt or dropped, so an interrupted run leaves every row exactly as
 * it was and a re-run is a no-op.
 */

/**
 * Deliberately generic. `key` is the primary key, so a lookup is an index seek
 * and a write is one upsert; both columns are NOT NULL because a meta row with
 * no name or no value is not a fact about anything.
 */
export const V14_CREATE_APP_META = `
  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );`;

/** Create-only DDL; applied in order, each statement independently idempotent. */
export const V14_CREATE: string[] = [V14_CREATE_APP_META];

/** Reads one meta value. Returns no row when the key was never written. */
export const V14_READ_META = "SELECT value FROM app_meta WHERE key = ?;";

/**
 * Writes one meta value. INSERT OR REPLACE rather than an upsert clause: the
 * table is two columns wide with the key as its primary key, so replacing the
 * row and updating it are the same thing, and the older form is understood by
 * every SQLite build the app can land on.
 */
export const V14_WRITE_META =
  "INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?);";
