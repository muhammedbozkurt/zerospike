import AsyncStorage from "@react-native-async-storage/async-storage";

import { getDb } from "./index";
import { uuid } from "../uuid";
import type { Reminder, ReminderType } from "./types";
import { getProfile, listProfiles } from "./profiles";
import {
  adoptOrphanReminders,
  bridgeLegacyReminders,
  type LegacyReminderPrefs,
} from "./remindersBridge";

/**
 * The reminders registry (schema v17, see ./v17Sql): a single table backing
 * every scheduled local reminder the app manages - basal, oral medication,
 * glucose, and any number of user-defined custom ones.
 *
 * PROFILE-SCOPED since schema v19 (see ./v19Sql): every row belongs to the
 * profile that created it (`profile_id`), and every function below reads or
 * writes only ONE profile's rows - the caller's explicit `profileId`, or (when
 * omitted) whichever profile is currently active, resolved the same way
 * lib/services/notifications.ts's own readActiveProfile does (AsyncStorage's
 * "zerospike.activeProfile" key, falling back to the first profile), so this
 * file never depends on lib/store. A row that predates v19 carries NULL until
 * it is adopted by exactly one profile at runtime - see ensureProfileScoped
 * below and adoptOrphanReminders in ./remindersBridge.ts; that hand-off is
 * deliberately NOT part of the schema migration (a migration step cannot know
 * which profile is "active" - see the note atop ./migrations.ts).
 *
 * This file only stores rows and orders them, following the same shape as
 * lib/db/meds.ts and lib/db/mealTemplates.ts. Turning a row into an actual OS
 * notification - permission, the per-profile insulin/oral-meds gates, the
 * identifier scheme - lives in lib/services/notifications.ts (applyReminders),
 * which now also resolves and passes the active profile through to every call
 * here so the whole apply pass works off exactly one profile's rows.
 *
 * DELIVERY (schema v19 `alarm_enabled`, default-on since v21): the column is
 * the user's stored PREFERENCE, never a statement about the device. An Android
 * or iOS < 26 row carries 1 just like any other, and shouldUseAlarm
 * (lib/alarmSelect.ts) is what decides at RUNTIME whether that preference can
 * actually be honoured - so a phone that later moves to iOS 26 starts ringing
 * without any row having to be rewritten (the AlarmKit permission is still
 * asked for separately). `alarm_user_set` (schema v21) records whether the
 * preference is the user's own choice or something the app defaulted for them;
 * only the two surfaces the user can actually touch (the badge in
 * app/settings/reminders.tsx, the switch in components/ReminderEditSheet.tsx)
 * ever set it.
 */

/** The most reminders a user can keep at once, PER PROFILE (schema v19; a
 *  device-level ceiling before profile scoping). */
export const MAX_REMINDERS = 10;

const ACTIVE_PROFILE_KEY = "zerospike.activeProfile";

/** Mirrors readActiveProfile in lib/services/notifications.ts: the registry is
 *  read from outside React too (applyReminders, the widget snapshot), so it
 *  resolves the active profile the same way rather than depending on
 *  lib/store. Never throws - a failed lookup resolves to null, same as "no
 *  profile yet" (onboarding never opened, or a wiped device). */
async function activeProfileId(): Promise<string | null> {
  try {
    const saved = await AsyncStorage.getItem(ACTIVE_PROFILE_KEY);
    const profile = saved ? await getProfile(saved) : null;
    if (profile) return profile.id;
    const fallback = (await listProfiles())[0];
    return fallback?.id ?? null;
  } catch {
    return null;
  }
}

/** Set once adoptOrphanReminders has confirmed the app_meta flag is set (by
 *  this call or an earlier one), so every later call in this process skips
 *  straight past it instead of re-reading app_meta on every single read. */
let profileScopeConfirmed = false;

/**
 * Runs the one-time orphaned-row hand-off (see adoptOrphanReminders in
 * ./remindersBridge.ts), best-effort, against the real database. Called from
 * every profile-scoped read/write below - NOT only from applyReminders - so a
 * user upgrading from before v19 sees their existing reminders immediately,
 * without first needing to grant notification permission or otherwise reach
 * whatever happens to call applyReminders first.
 */
async function ensureProfileScoped(profileId: string | null): Promise<void> {
  if (profileScopeConfirmed) return;
  try {
    const db = await getDb();
    profileScopeConfirmed = await adoptOrphanReminders(db, profileId);
  } catch {
    // best-effort; retried on the next call (profileScopeConfirmed stays false)
  }
}

/** Resolves which profile a call should scope to - `explicit` when given
 *  (even if undefined was never passed, i.e. the caller cares), else the
 *  active profile - and opportunistically runs the orphan hand-off above. */
async function resolveProfileId(explicit?: string): Promise<string | null> {
  const id = explicit !== undefined ? explicit : await activeProfileId();
  await ensureProfileScoped(id);
  return id;
}

/** A profile's reminders, in the user's own order. Defaults to the active
 *  profile when `profileId` is omitted. Returns [] when no profile could be
 *  resolved at all (never throws for that - see resolveProfileId). */
export async function listReminders(profileId?: string): Promise<Reminder[]> {
  const db = await getDb();
  const id = await resolveProfileId(profileId);
  if (id == null) return [];
  return db.getAllAsync<Reminder>(
    "SELECT * FROM reminders WHERE profile_id = ? ORDER BY sort ASC, created_at ASC;",
    [id]
  );
}

/** Looked up by id, which is globally unique - no profile scoping needed once
 *  the caller already has a row (from a profile-scoped list) in hand. */
export async function getReminder(id: string): Promise<Reminder | null> {
  const db = await getDb();
  return db.getFirstAsync<Reminder>(
    "SELECT * FROM reminders WHERE id = ?;",
    [id]
  );
}

/**
 * Every ENABLED basal reminder, deliberately not profile-scoped by default
 * (hub card B3): a ringing AlarmKit alarm hands back no reminder id at all
 * (native gap, see app/_layout.tsx's alarm consume()), so
 * lib/services/basalConfirm.ts's resolveBasalReminderByTime has to search
 * every profile's own basal row by TIME instead, and can only do that with
 * every candidate in hand up front. `profileId` (hub card B4) narrows the
 * same read to one profile's own row, for the caller that already KNOWS
 * which profile a reminderId-less open is about (task package A's dashboard
 * button) and only needs its time, not a search across every profile. A
 * disabled row is excluded either way, since it cannot be the row that just
 * rang. Read-only.
 */
export async function listAllBasalReminders(profileId?: string): Promise<Reminder[]> {
  const db = await getDb();
  if (profileId) {
    return db.getAllAsync<Reminder>(
      "SELECT * FROM reminders WHERE type = 'basal' AND enabled = 1 AND profile_id = ?;",
      [profileId]
    );
  }
  return db.getAllAsync<Reminder>(
    "SELECT * FROM reminders WHERE type = 'basal' AND enabled = 1;"
  );
}

export async function countReminders(profileId?: string): Promise<number> {
  const db = await getDb();
  const id = await resolveProfileId(profileId);
  if (id == null) return 0;
  const row = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) AS c FROM reminders WHERE profile_id = ?;",
    [id]
  );
  return row?.c ?? 0;
}

/** Whether one more reminder can be added without crossing MAX_REMINDERS, for
 *  the active profile (or `profileId` when given). */
export async function canAddReminder(profileId?: string): Promise<boolean> {
  return (await countReminders(profileId)) < MAX_REMINDERS;
}

export interface NewReminderInput {
  type: ReminderType;
  label?: string | null;
  time: string;
  /** Defaults to on, matching the column's own DEFAULT 1. */
  enabled?: boolean;
  /** How this reminder should be delivered - see ReminderUpdate.alarmEnabled
   *  below. Defaults to ON (2.3.0): a new reminder is born as an alarm, the
   *  same way `enabled` is born on, and the user turns it into a plain
   *  notification if they prefer. The column's own DEFAULT stays 0 because
   *  every INSERT here writes the value explicitly; nothing reaches the
   *  column default. */
  alarmEnabled?: boolean;
  /** Whether the value above is the USER's own choice (schema v21). Only the
   *  two surfaces they can touch pass this; onboarding and every internal
   *  writer leave it out, so their rows stay eligible for a future default
   *  change. */
  alarmUserSet?: boolean;
  /** The row's owner (schema v19). Optional and resolved from the active
   *  profile when omitted (see resolveProfileId) - every caller written before
   *  profile scoping landed never passes this, and keeps compiling and
   *  behaving exactly as it did before, as long as a profile is active (always
   *  true past onboarding's first step). */
  profileId?: string;
}

/**
 * Adds a reminder at the end of ONE profile's list (the active profile, or
 * `input.profileId`). Throws once that profile already has MAX_REMINDERS
 * stored: a full list is a deliberate ceiling the caller has to react to (a
 * disabled "add" button, a message), not a case to fail into silently. Also
 * throws when no profile can be resolved at all (see resolveProfileId) -
 * every real call site already has one active by the time it reaches here, so
 * this is a defensive backstop, not a path any user should hit.
 */
export async function createReminder(
  input: NewReminderInput
): Promise<Reminder> {
  const db = await getDb();
  const profileId = await resolveProfileId(input.profileId);
  if (!profileId) {
    throw new Error("createReminder: no active profile to attach the reminder to");
  }
  if ((await countReminders(profileId)) >= MAX_REMINDERS) {
    throw new Error(
      `createReminder: limit of ${MAX_REMINDERS} reminders reached`
    );
  }
  const id = uuid();
  const next = await db.getFirstAsync<{ next: number | null }>(
    "SELECT MAX(sort) + 1 AS next FROM reminders WHERE profile_id = ?;",
    [profileId]
  );
  await db.runAsync(
    `INSERT INTO reminders (id, type, label, time, enabled, sort, created_at, profile_id, alarm_enabled, alarm_user_set)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      id,
      input.type,
      input.label ?? null,
      input.time,
      input.enabled === false ? 0 : 1,
      next?.next ?? 0,
      Date.now(),
      profileId,
      input.alarmEnabled === false ? 0 : 1,
      input.alarmUserSet ? 1 : 0,
    ]
  );
  return (await getReminder(id))!;
}

export interface ReminderUpdate {
  type?: ReminderType;
  label?: string | null;
  time?: string;
  enabled?: boolean;
  /** How this reminder should be delivered - see reminders.alarm_enabled
   *  (schema v19, default-on since v21) and applyReminders in
   *  lib/services/notifications.ts, which is what actually turns the preference
   *  into a real alarm vs. a plain notification. Stored platform-independently:
   *  a device with no AlarmKit still saves the preference as-is (see this
   *  file's own header note). */
  alarmEnabled?: boolean;
  /** Marks the value above as the USER's own choice (schema v21). Sent only by
   *  the per-row badge (app/settings/reminders.tsx) and the sheet's own switch
   *  once it has been touched. */
  alarmUserSet?: boolean;
}

/** Partial update of a reminder. Returns the fresh row, or null if it is gone. */
export async function updateReminder(
  id: string,
  patch: ReminderUpdate
): Promise<Reminder | null> {
  const db = await getDb();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (patch.type !== undefined) {
    fields.push("type = ?");
    values.push(patch.type);
  }
  if (patch.label !== undefined) {
    fields.push("label = ?");
    values.push(patch.label);
  }
  if (patch.time !== undefined) {
    fields.push("time = ?");
    values.push(patch.time);
  }
  if (patch.enabled !== undefined) {
    fields.push("enabled = ?");
    values.push(patch.enabled ? 1 : 0);
  }
  if (patch.alarmEnabled !== undefined) {
    fields.push("alarm_enabled = ?");
    values.push(patch.alarmEnabled ? 1 : 0);
  }
  if (patch.alarmUserSet !== undefined) {
    fields.push("alarm_user_set = ?");
    values.push(patch.alarmUserSet ? 1 : 0);
  }
  if (fields.length > 0) {
    values.push(id);
    await db.runAsync(
      `UPDATE reminders SET ${fields.join(", ")} WHERE id = ?;`,
      values
    );
  }
  return getReminder(id);
}

/** Deletes a reminder. Its notification is torn down separately (see
 *  applyReminders in lib/services/notifications.ts, which sweeps any
 *  "zerospike-rem-" identifier no longer backed by a row). */
export async function deleteReminder(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM reminders WHERE id = ?;", [id]);
}

/**
 * Writes the user's own arrangement: sort becomes the position in
 * `orderedIds`. One transaction, mirroring reorderTemplates in
 * ./mealTemplates.ts.
 */
export async function reorderReminders(
  orderedIds: readonly string[]
): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.runAsync("UPDATE reminders SET sort = ? WHERE id = ?;", [
        i,
        orderedIds[i],
      ]);
    }
  });
}

/**
 * Runs the one-time legacy-prefs bridge (see ./remindersBridge) against the
 * real database. Returns whether THIS call actually seeded the table -
 * lib/services/notifications.ts uses that to know whether the pre-registry
 * fixed-id notifications still need cancelling.
 *
 * `profileId` (schema v19) is who any seeded row belongs to; resolved from the
 * active profile when omitted, same as every other function here.
 */
export async function applyLegacyRemindersBridge(
  prefs: LegacyReminderPrefs,
  profileId?: string
): Promise<boolean> {
  const db = await getDb();
  const id = profileId !== undefined ? profileId : await activeProfileId();
  return bridgeLegacyReminders(db, prefs, uuid, undefined, id);
}

/**
 * Collapses accidental duplicate "basal" rows into one, WITHIN one profile.
 * type=basal is meant to stay a singleton per profile (see syncBasalReminderRow
 * below), but a legacy-bridge race during onboarding could seed a second one
 * before that bridge learned to check for an existing row (see
 * ./remindersBridge.ts) - and a device that already has the duplicate needs to
 * self-heal without going through onboarding again. Keeps the OLDEST row (by
 * created_at, ties broken by sort) exactly as it is - its time and enabled
 * state are never touched here - and deletes every other basal row of the
 * SAME profile. A no-op, and cheap, once at most one exists.
 */
export async function dedupeBasalReminderRows(profileId?: string): Promise<void> {
  const rows = await listReminders(profileId);
  const basalRows = rows.filter((r) => r.type === "basal");
  if (basalRows.length <= 1) return;
  const [, ...extra] = [...basalRows].sort(
    (a, b) => a.created_at - b.created_at || a.sort - b.sort
  );
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const row of extra) {
      await db.runAsync("DELETE FROM reminders WHERE id = ?;", [row.id]);
    }
  });
}

/**
 * Creates or updates ONE profile's single basal row to match a profile
 * setup's choice - app/onboarding.tsx and app/profile-setup.tsx both used to
 * hand this off to the legacy prefs.basal/basalTime bridge instead
 * (applyLegacyRemindersBridge above), which only ever runs ONCE per device: a
 * second profile, or a restarted onboarding attempt after an earlier one
 * already fired the bridge, silently had its basal choice do nothing.
 *
 * `time` is only written into an EXISTING row when `timeTouched` is true: an
 * untouched default must never clobber a time the SAME profile already set
 * for itself (each profile keeps its own basal row since schema v19 - before
 * it, the schedule was device-wide and this guarded against clobbering a
 * DIFFERENT profile's time). A brand new row always gets `time`, touched or
 * not - it has to start somewhere.
 *
 * `profileId` (schema v19) defaults to the active profile, matching every
 * other function here - onboarding/profile-setup never pass it explicitly,
 * relying on the active profile already being the one they just set up (see
 * lib/store/AppContext.tsx's setActiveProfileId, which writes the active-
 * profile key BEFORE either screen's own save step runs).
 *
 * Returns false only when a new row was needed and that profile's
 * MAX_REMINDERS was already reached; the caller decides how to surface that
 * (an existing row is always updated in place, never blocked by the limit).
 */
export async function syncBasalReminderRow(
  showsBasal: boolean,
  time: string,
  timeTouched: boolean,
  profileId?: string
): Promise<boolean> {
  await dedupeBasalReminderRows(profileId);
  const rows = await listReminders(profileId);
  const basalRow = rows.find((r) => r.type === "basal") ?? null;

  if (!showsBasal) {
    if (basalRow && basalRow.enabled === 1) {
      await updateReminder(basalRow.id, { enabled: false });
    }
    return true;
  }

  if (basalRow) {
    await updateReminder(basalRow.id, {
      enabled: true,
      ...(timeTouched ? { time } : {}),
    });
    return true;
  }

  if (rows.length >= MAX_REMINDERS) return false;
  await createReminder({ type: "basal", time, enabled: true, profileId });
  return true;
}
