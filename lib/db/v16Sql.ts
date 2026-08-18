/**
 * v15 → v16 migration SQL, in one place so scripts/migration.test.ts runs the
 * REAL statements (matching the v13/v14/v15 pattern).
 *
 * v16 adds oral medication tracking: a med_logs table (what the user took, and
 * when) and the user_profiles.oral_meds_enabled flag that decides whether the
 * surfaces for it are shown at all.
 *
 * Create-only plus one guarded ADD COLUMN. No table is rebuilt and no row is
 * read or rewritten, so an interrupted run cannot cost an entry (the v8/v9/v11
 * lesson) and a re-run is a no-op.
 *
 * `taken_at` / `created_at` are epoch MILLISECONDS (INTEGER), not the ISO text
 * the older log tables store. The journal feed converts taken_at to that same
 * ISO string so one ordered UNION still sorts across kinds - see ./journalSql.
 *
 * `name` is nullable: an entry with no name is still a record that something was
 * taken at a time, and refusing it would be refusing the fastest way to log.
 * There is no dose column and no CHECK on the name: the app stores what the user
 * writes and never names a substance, a dose or a schedule of its own.
 */

export const V16_CREATE: string[] = [
  `CREATE TABLE IF NOT EXISTS med_logs (
     id TEXT PRIMARY KEY NOT NULL,
     profile_id TEXT NOT NULL,
     taken_at INTEGER NOT NULL,
     name TEXT,
     note TEXT,
     created_at INTEGER NOT NULL,
     FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE
   );`,
  // The per-profile read, in feed order. Leading with profile_id also indexes the
  // foreign-key CHILD column, so deleting a profile no longer table-scans this
  // table to cascade (see ./v12Sql for why that has to be declared).
  `CREATE INDEX IF NOT EXISTS idx_med_profile ON med_logs (profile_id, taken_at DESC);`,
  // Time alone, for the range reads that span profiles (report / export windows).
  `CREATE INDEX IF NOT EXISTS idx_med_taken_at ON med_logs (taken_at);`,
];

/**
 * 1 when the profile shows the oral-medication surfaces. NOT NULL DEFAULT 0, so
 * every existing profile keeps exactly the app it had until it opts in - the
 * flag is presentation only and never enters a calculation.
 */
export const V16_ADD_ORAL_MEDS_ENABLED =
  "ALTER TABLE user_profiles ADD COLUMN oral_meds_enabled INTEGER NOT NULL DEFAULT 0;";
