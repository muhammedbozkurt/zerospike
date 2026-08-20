import type * as SQLite from "expo-sqlite";

import { V14_READ_META, V14_WRITE_META } from "./v14Sql";

/**
 * The one-time move of the pre-registry basal/med/glucose reminder settings
 * into the reminders table (schema v17, see ./v17Sql). `SQLite.SQLiteDatabase`
 * is imported as a TYPE ONLY - erased at build time, never loading the native
 * expo-sqlite module - exactly like lib/db/migrations.ts, so this same function
 * runs unmodified against a real on-device database (from lib/db/reminders.ts)
 * and against the node:sqlite adapter in scripts/migration.test.ts.
 *
 * Called from lib/services/notifications.ts, on the first call of its apply
 * flow - never from initDatabase(), which must not grow a dependency on the
 * notifications service (see the post-mortem note at the top of
 * lib/db/migrations.ts for why a migration step has to stay self-contained).
 * app_meta.remindersBridgedV1 guards it so it can never run twice, however many
 * times it is called, this process or a future one.
 *
 * Only the reminder types that were actually ON in the legacy prefs get a row:
 * a reminder that was never scheduled has no notification to preserve, so
 * nothing is created for it either. The legacy NotificationPrefs fields
 * (basal/basalTime/med/medTime/glucose/glucoseTime) are left exactly as they
 * were - other code may still read them - this table is simply what decides,
 * from here on, what actually gets scheduled.
 */

export const REMINDERS_BRIDGE_KEY = "remindersBridgedV1";

export interface LegacyReminderPrefs {
  basal: boolean;
  basalTime: string;
  med: boolean;
  medTime: string;
  glucose: boolean;
  glucoseTime: string;
}

/**
 * Runs the bridge if (and only if) it has never run before. Returns whether
 * THIS call actually seeded the table - false when it was already bridged, so
 * the caller knows whether the pre-registry fixed-id notifications still need
 * tearing down (they only ever need it once, the moment the table takes over).
 *
 * `makeId` / `now` are injected rather than calling lib/uuid.ts / Date.now()
 * directly, so this stays free of any runtime import a test cannot satisfy
 * under plain Node (lib/uuid.ts's expo-crypto call needs the Expo runtime).
 *
 * `profileId` (schema v19) is who any seeded row belongs to - the active
 * profile at the moment this first (and only) run happens, or null when none
 * could be resolved. Threading it through here, rather than leaving seeded
 * rows to be picked up later by adoptOrphanReminders below, means a bridge
 * that fires on a genuinely fresh v19 install (this table's own flag can still
 * be unset the very first time a NEW device applies its notification prefs,
 * if some legacy pref defaults to on) never creates an orphaned row in the
 * first place - see the ownership note on ./v19Sql for why a migration step
 * cannot do this itself. Also scopes the "does this type already have a row"
 * dedupe check (see below) to this SAME profile: a row onboarding/profile
 * setup already wrote straight to the registry (syncBasalReminderRow, see
 * ./reminders.ts) for the SAME profile must still block a duplicate, while a
 * different profile's row of the same type must not.
 */
export async function bridgeLegacyReminders(
  db: SQLite.SQLiteDatabase,
  prefs: LegacyReminderPrefs,
  makeId: () => string,
  now: () => number = Date.now,
  profileId: string | null = null
): Promise<boolean> {
  const already = await db.getFirstAsync<{ value: string }>(V14_READ_META, [
    REMINDERS_BRIDGE_KEY,
  ]);
  if (already) return false;

  // A row of a given type may already exist by the time this runs: onboarding
  // (app/onboarding.tsx) and profile setup (app/profile-setup.tsx) both write
  // the basal row straight to the registry (syncBasalReminderRow, see
  // ./reminders.ts) BEFORE they call applyNotificationPrefs, which is what
  // triggers this bridge on a device that has never run it. Seeding "basal"
  // again here from the very same legacy prefs those callers just wrote would
  // duplicate the row they already created. Checked per-type rather than
  // short-circuiting the whole bridge, so a genuinely fresh install with real
  // legacy glucose/med prefs (upgrade path) still gets the types that have no
  // row yet.
  const existingTypes = new Set(
    (
      await db.getAllAsync<{ type: string }>(
        "SELECT DISTINCT type FROM reminders WHERE profile_id = ?;",
        [profileId]
      )
    ).map((r) => r.type)
  );

  const seeds: { type: "basal" | "med" | "glucose"; time: string }[] = [];
  if (prefs.basal && !existingTypes.has("basal")) {
    seeds.push({ type: "basal", time: prefs.basalTime });
  }
  if (prefs.med && !existingTypes.has("med")) {
    seeds.push({ type: "med", time: prefs.medTime });
  }
  if (prefs.glucose && !existingTypes.has("glucose")) {
    seeds.push({ type: "glucose", time: prefs.glucoseTime });
  }

  // One transaction: either every seeded row lands together with the flag that
  // says bridging happened, or none of it does - a kill mid-way must not leave
  // the flag set with rows missing, or rows present without the flag (which
  // would duplicate them on the very next call).
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < seeds.length; i++) {
      const seed = seeds[i];
      await db.runAsync(
        `INSERT INTO reminders (id, type, label, time, enabled, sort, created_at, profile_id)
         VALUES (?, ?, NULL, ?, 1, ?, ?, ?);`,
        [makeId(), seed.type, seed.time, i, now(), profileId]
      );
    }
    await db.runAsync(V14_WRITE_META, [REMINDERS_BRIDGE_KEY, "true"]);
  });
  return true;
}

/* ── One-time profile-scope adoption (schema v19) ──────────────────────────
 *
 * Every reminder row that existed before v19 has profile_id NULL - the table
 * used to be device-level, like NotificationPrefs (see ./v17Sql), and the
 * ALTER that added the column cannot itself guess an owner (see the note atop
 * ./migrations.ts on why a migration step must stay self-contained). This is
 * the runtime hand-off that assigns every such row to ONE profile - the
 * active one at the moment this first successfully runs - so the table
 * becomes genuinely profile-scoped. Driven from lib/db/reminders.ts, which is
 * also where "the active profile" is resolved (see readActiveProfile's own
 * pattern in lib/services/notifications.ts) - this file stays dependency-free
 * so scripts/migration.test.ts can run it against node:sqlite, exactly like
 * bridgeLegacyReminders above.
 */

export const REMINDERS_PROFILE_SCOPE_KEY = "remindersProfileScopedV1";

/**
 * Adopts every orphaned (profile_id IS NULL) row into `activeProfileId`, once,
 * ever - guarded by app_meta exactly like bridgeLegacyReminders's own flag.
 *
 * Returns true once the flag is confirmed set - whether THIS call set it, or
 * an earlier one already had - so a caller can cache that and stop asking.
 * Returns false ONLY when there is nothing to adopt into yet (no active
 * profile could be resolved): the flag is deliberately left unset in that
 * case, so the very next call (once a profile exists) tries again instead of
 * silently orphaning the rows forever. That "next call" can be later in the
 * SAME process once a profile becomes active (unlike bridgeLegacyReminders,
 * which only retries on the next launch) - callers are free to poll this
 * cheaply since the guard itself is a single indexed lookup once it is set.
 */
export async function adoptOrphanReminders(
  db: SQLite.SQLiteDatabase,
  activeProfileId: string | null
): Promise<boolean> {
  const already = await db.getFirstAsync<{ value: string }>(V14_READ_META, [
    REMINDERS_PROFILE_SCOPE_KEY,
  ]);
  if (already) return true;
  if (!activeProfileId) return false;

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      "UPDATE reminders SET profile_id = ? WHERE profile_id IS NULL;",
      [activeProfileId]
    );
    await db.runAsync(V14_WRITE_META, [REMINDERS_PROFILE_SCOPE_KEY, "true"]);
  });
  return true;
}
