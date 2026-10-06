/**
 * The schema v24 statements, kept in a dependency-free module so the tests can
 * execute the REAL SQL against a scratch database - the same arrangement as
 * v13Sql..v23Sql.
 *
 * v24 adds analytics_queue, the on-device outbox of the Supabase analytics sink
 * (lib/analytics/queue.ts): one row per event waiting to be sent, deleted once
 * the server has accepted its batch. It is operational telemetry, not user
 * data, so it has no profile_id and no foreign key: nothing in it is tied to a
 * profile, and deleting a profile or clearing its logs never touches it.
 *
 * CREATE TABLE IF NOT EXISTS only: no existing table is altered or rebuilt, so
 * nothing already stored can be lost and a re-run is a no-op (the v14/v16/v17/
 * v18 pattern). `id` is AUTOINCREMENT so ids only ever grow, which is what
 * keeps "oldest first" and "trim the oldest" correct after deletes. `props` is
 * the event's JSON object, `ts` its ISO-8601 time, `is_pro` the entitlement at
 * the moment it was logged. `batch_id` stays NULL until a send is first
 * attempted: those rows are then tagged with the id the request carries, so a
 * retry (even after the app was killed mid-request) resends exactly the same
 * rows under the same id and the server can tell it has seen the batch.
 */

export const V24_CREATE_ANALYTICS_QUEUE = `
  CREATE TABLE IF NOT EXISTS analytics_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    props TEXT NOT NULL DEFAULT '{}',
    ts TEXT NOT NULL,
    session_id TEXT NOT NULL,
    is_pro INTEGER NOT NULL DEFAULT 0,
    batch_id TEXT
  );`;

/** Create-only DDL; shared by migrateToV24 and createSchemaV1's fresh-install path. */
export const V24_CREATE: string[] = [V24_CREATE_ANALYTICS_QUEUE];
