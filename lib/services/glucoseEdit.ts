import { Platform } from "react-native";

import { getSugarLog, setSugarLogHealthUuid, updateSugarLog } from "../db/logs";
import {
  deleteGlucoseFromHealth,
  getHealthWriteEnabled,
  updateGlucoseInHealth,
} from "./health";
import type { GlucoseEntry } from "../db/journal";
import type { LogTag, PeriodTag } from "../db/types";

/**
 * Correcting a reading that already exists, shared by every surface that offers
 * it: the dashboard's preview rows and the full journal screen
 * (app/journal.tsx). Both open the same sheet on the same row, so both have to
 * write the same thing and keep the same Apple Health promise - copying this
 * would mean a fix to the mirror landing on one screen and not the other.
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
  // Keeps the Apple Health mirror honest. A corrected reading whose mirrored
  // sample still carried the old value made the two disagree, and HealthKit has
  // no "update", so the helper revokes and rewrites. Fire-and-forget: the local
  // edit is already saved and a mirror failure must never surface.
  void remirrorEditedGlucose(previous, value, loggedAt);
}

/**
 * Re-mirrors an EDITED reading into Apple Health: the stale sample is revoked and
 * the corrected value/time written in its place (HealthKit has no update), then
 * the new UUID is recorded on the row - or cleared when the write did not land,
 * so the row never points at a sample that no longer exists.
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
    if (!previous.healthkit_uuid || Platform.OS !== "ios") return;
    if (!(await getHealthWriteEnabled())) return;
    const dateIso = (loggedAt ?? new Date(previous.logged_at)).toISOString();
    const uuid = await updateGlucoseInHealth(previous.healthkit_uuid, mgdl, dateIso);
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
