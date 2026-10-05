import { getSugarLog, updateSugarLog } from "../db/logs";
import { getHealthWriteEnabled, hasHealthProvider, updateGlucoseInHealth } from "./health";
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
  void remirrorEditedGlucose(previous);
}

/**
 * Re-mirrors an EDITED reading into the health store (updateGlucoseInHealth:
 * the stored values are written in line behind any write of the reading still
 * in flight, the stale sample revoked after, the new id linked on the row - or
 * the link cleared when the write did not land).
 *
 * NOT gated on `previous.healthkit_uuid`: that is the screen's copy, loaded
 * before the first write of a just-logged reading had linked, so a correction
 * made in that window was dropped and Health kept the old value. Whether the
 * reading is mirrored is decided on the stored row inside the row lock.
 *
 * Only while the write toggle is on: with the mirror switched off the old
 * sample stays where it is and its link is kept, so a later delete can still
 * revoke it. Best-effort throughout - the local edit is already saved and a
 * mirror failure must never surface.
 */
export async function remirrorEditedGlucose(previous: GlucoseEntry): Promise<void> {
  try {
    if (!hasHealthProvider()) return;
    // Read the stored row FIRST, for its OWNER (X7 / H6): the mirror is per
    // profile, so the write-enabled check has to run against the profile the
    // corrected reading actually belongs to, not whichever one happens to be
    // active. Checking the active profile here and the row's own profile
    // inside updateGlucoseInHealth was two different checks that could
    // disagree; this is now the single check, done with the right id.
    const stored = await getSugarLog(previous.id);
    if (!stored) return;
    if (!(await getHealthWriteEnabled(stored.profile_id))) return;
    // Links (or unlinks) the row and runs the orphan guard itself, inside the
    // row lock; a second link from here could land after a later operation's.
    await updateGlucoseInHealth(previous.id, previous.healthkit_uuid, stored.profile_id);
  } catch {
    // best-effort mirror: never blocks or reports back to the edit flow
  }
}
