import { getSugarLog, setSugarLogHealthUuid, updateSugarLog } from "../db/logs";
import {
  deleteGlucoseFromHealth,
  getHealthWriteEnabled,
  hasHealthProvider,
  updateGlucoseInHealth,
} from "./health";
import type { GlucoseEntry } from "../db/journal";
import type { LogTag, PeriodTag } from "../db/types";

/**
 * Correcting a reading that already exists, shared by every surface that offers
 * it: the dashboard's preview rows and the full journal screen
 * (app/journal.tsx). Both open the same sheet on the same row, so both have to
 * write the same thing and keep the same health-store mirror promise -
 * copying this would mean a fix to the mirror landing on one screen and not
 * the other.
 *
 * Deliberately NOT the "new reading" path: that one arms timers, nudges the
 * review prompt and can complete a running post-meal window. A correction does
 * none of it (see submitGlucose in app/(tabs)/index.tsx).
 */
export async function applyGlucoseCorrection(
  previous: GlucoseEntry,
  value: number,
  period: PeriodTag,
  tags: LogTag[],
  loggedAt: Date | null
): Promise<void> {
  await updateSugarLog(previous.id, {
    glucose_level_mgdl: value,
    period_tag: period,
    tags,
    ...(loggedAt ? { logged_at: loggedAt.toISOString() } : {}),
  });
  // Keeps the health-store mirror honest. A corrected reading whose mirrored
  // sample still carried the old value made the two disagree, and neither
  // store has an "update", so the helper revokes and rewrites. Fire-and-forget:
  // the local edit is already saved and a mirror failure must never surface.
  void remirrorEditedGlucose(previous, value, loggedAt);
}

/**
 * Re-mirrors an EDITED reading into the health store: the corrected value/time
 * is written first (same sync id, newer version, so the store replaces the
 * stale sample itself) and the stale one revoked after if it is still a
 * different object, then the new id is recorded on the row - or cleared when
 * the write did not land, so the row never points at a sample that no longer
 * exists.
 *
 * Only touches rows that were actually mirrored, and only while the write toggle
 * is on: with the mirror switched off the old sample stays where it is and its
 * link is kept, so a later delete can still revoke it. Best-effort throughout -
 * the local edit is already saved and a mirror failure must never surface.
 */
export async function remirrorEditedGlucose(
  previous: GlucoseEntry,
  mgdl: number,
  loggedAt: Date | null
): Promise<void> {
  try {
    if (!previous.healthkit_uuid || !hasHealthProvider()) return;
    // Read the stored row FIRST, for its OWNER (X7 / H6): the mirror is per
    // profile, so the write-enabled check has to run against the profile the
    // corrected reading actually belongs to, not whichever one happens to be
    // active. Checking the active profile here and the row's own profile
    // inside updateGlucoseInHealth was two different checks that could
    // disagree; this is now the single check, done with the right id.
    const stored = await getSugarLog(previous.id);
    if (!stored) return;
    if (!(await getHealthWriteEnabled(stored.profile_id))) return;
    const dateIso = (loggedAt ?? new Date(previous.logged_at)).toISOString();
    const uuid = await updateGlucoseInHealth(
      previous.id,
      previous.healthkit_uuid,
      mgdl,
      dateIso,
      stored.period_tag,
      stored.profile_id
    );
    // Same orphan guard as writeGlucoseToHealthIfEnabled: if the row was
    // deleted while the rewrite was in flight, revoke the fresh sample instead
    // of leaving it unlinked in the user's Health app.
    if (uuid && !(await getSugarLog(previous.id))) {
      await deleteGlucoseFromHealth(uuid);
      return;
    }
    await setSugarLogHealthUuid(previous.id, uuid);
  } catch {
    // best-effort mirror: never blocks or reports back to the edit flow
  }
}
