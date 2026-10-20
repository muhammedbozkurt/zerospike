import { logCrash } from "./analytics";
import { getMealLog, listMealHealthUuids, setMealHealthUuid } from "./db/logs";
import {
  getInjection,
  listInjectionHealthUuids,
  setInjectionHealthUuid,
} from "./db/injections";
import { setHealthRecordHooks } from "./db/healthRecordHooks";
import type { Injection, MealLog } from "./db/types";
import { mealEditMode } from "./mealRoute";
import {
  clearHealthRecordRetryIds,
  deleteHealthRecord,
  getHealthRecordRetryIds,
  hasHealthProvider,
  mirrorHealthRecord,
  retryPendingHealthRecordDeletes,
  revokeHealthRecords,
  type HealthRecordInput,
  type HealthRecordResult,
} from "./services/health";
import type { HealthWriteKind } from "./services/healthTypes";

/**
 * Carbohydrate and insulin entries mirrored to the health store, linked to
 * their rows through health_uuid (meal_logs, injection_logs). The decisions on
 * when a row needs a (re)write are pure and exported for tests; the rest wires
 * lib/db's save and delete hooks to lib/services/health.
 */

const KINDS: readonly HealthWriteKind[] = ["carbs", "insulin"];

/** A meal saved from a carb estimate: no catalogue food, no weight, carbs set.
 *  Derived from existing columns (no schema change), same rule as mealEditMode. */
export function isEstimatedMeal(
  meal: Pick<MealLog, "food_id" | "portion_g" | "calculated_carbs_g">
): boolean {
  const grams = Number(meal.calculated_carbs_g);
  return Number.isFinite(grams) && grams > 0 && mealEditMode(meal) === "carbOnly";
}

export function mealRecordInput(meal: MealLog): HealthRecordInput | null {
  const grams = Number(meal.calculated_carbs_g);
  if (!Number.isFinite(grams) || grams <= 0) return null;
  const input: HealthRecordInput = {
    kind: "carbs",
    id: meal.id,
    profileId: meal.profile_id,
    loggedAt: meal.logged_at,
    grams,
  };
  if (isEstimatedMeal(meal)) input.estimated = true;
  return input;
}

export function injectionRecordInput(injection: Injection): HealthRecordInput | null {
  const units = Number(injection.dose_units);
  if (!Number.isFinite(units) || units <= 0) return null;
  if (injection.insulin_type !== "basal" && injection.insulin_type !== "bolus") return null;
  return {
    kind: "insulin",
    id: injection.id,
    profileId: injection.profile_id,
    loggedAt: injection.logged_at,
    units,
    insulinKind: injection.insulin_type,
  };
}

/** True when a saved row has to be written (again): first save, or a field the
 *  health sample carries changed. A note or tag edit never re-writes. */
export function needsMirror(
  next: HealthRecordInput | null,
  previous: HealthRecordInput | null
): boolean {
  if (!next) return false;
  if (!previous) return true;
  if (next.loggedAt !== previous.loggedAt) return true;
  if (next.kind === "carbs" && previous.kind === "carbs") {
    return next.grams !== previous.grams || Boolean(next.estimated) !== Boolean(previous.estimated);
  }
  if (next.kind === "insulin" && previous.kind === "insulin") {
    return next.units !== previous.units || next.insulinKind !== previous.insulinKind;
  }
  return true;
}

type SetLink = (id: string, uuid: string | null) => Promise<boolean>;

async function applyResult(
  kind: HealthWriteKind,
  id: string,
  result: HealthRecordResult,
  setLink: SetLink
): Promise<void> {
  if (result.outcome !== "written" || !result.uuid) return;
  const linked = await setLink(id, result.uuid);
  // The row was deleted while the write was in flight: the sample has no row
  // that could ever revoke it.
  if (!linked) await revokeHealthRecords(kind, [result.uuid]);
}

async function mirrorRow(
  input: HealthRecordInput,
  held: string | null | undefined,
  setLink: SetLink
): Promise<HealthRecordResult> {
  const result = await mirrorHealthRecord(input, [held]);
  await applyResult(input.kind, input.id, result, setLink);
  return result;
}

async function dropLink(
  kind: HealthWriteKind,
  id: string,
  held: string | null | undefined,
  setLink: SetLink
): Promise<void> {
  if (!held) return;
  await setLink(id, null);
  await deleteHealthRecord(kind, id, held);
}

async function onMealSaved(meal: MealLog, previous: MealLog | null): Promise<void> {
  const next = mealRecordInput(meal);
  if (!next) {
    await dropLink("carbs", meal.id, meal.health_uuid, setMealHealthUuid);
    return;
  }
  const prev = previous ? mealRecordInput(previous) : null;
  if (!needsMirror(next, prev)) return;
  await mirrorRow(next, meal.health_uuid, setMealHealthUuid);
}

async function onInjectionSaved(injection: Injection, previous: Injection | null): Promise<void> {
  const next = injectionRecordInput(injection);
  if (!next) {
    await dropLink("insulin", injection.id, injection.health_uuid, setInjectionHealthUuid);
    return;
  }
  const prev = previous ? injectionRecordInput(previous) : null;
  if (!needsMirror(next, prev)) return;
  await mirrorRow(next, injection.health_uuid, setInjectionHealthUuid);
}

function guarded(op: string, work: () => Promise<void>): void {
  if (!hasHealthProvider()) return;
  void work().catch((err) => logCrash(err, { screen: "health", op }));
}

setHealthRecordHooks({
  mealSaved: (meal, previous) => guarded("mealSaved", () => onMealSaved(meal, previous)),
  injectionSaved: (injection, previous) =>
    guarded("injectionSaved", () => onInjectionSaved(injection, previous)),
  removed: (kind, records) =>
    guarded("recordsRemoved", async () => {
      for (const r of records) await deleteHealthRecord(kind, r.id, r.uuid);
    }),
});

/**
 * Re-attempts the writes that failed while a type's switch was on (opening the
 * app, coming to the foreground), then the queued deletes. Each id's row is
 * re-read: a deleted row simply leaves the queue. Never throws.
 */
let retryInFlight: Promise<void> | null = null;

export function retryHealthRecords(profileId: string): Promise<void> {
  if (retryInFlight) return retryInFlight;
  const run = runRetryHealthRecords(profileId).finally(() => {
    if (retryInFlight === run) retryInFlight = null;
  });
  retryInFlight = run;
  return run;
}

async function runRetryHealthRecords(profileId: string): Promise<void> {
  if (!hasHealthProvider()) return;
  for (const kind of KINDS) {
    try {
      const ids = await getHealthRecordRetryIds(kind, profileId);
      const done: string[] = [];
      for (const id of ids) {
        const row = kind === "carbs" ? await getMealLog(id) : await getInjection(id);
        const input = row
          ? kind === "carbs"
            ? mealRecordInput(row as MealLog)
            : injectionRecordInput(row as Injection)
          : null;
        if (!row || !input || row.profile_id !== profileId) {
          done.push(id);
          continue;
        }
        const setLink = kind === "carbs" ? setMealHealthUuid : setInjectionHealthUuid;
        const res = await mirrorRow(input, row.health_uuid, setLink);
        // "failed" stays queued; skipped/unsupported means the switch went off.
        if (res.outcome !== "failed") done.push(id);
      }
      if (done.length > 0) await clearHealthRecordRetryIds(kind, profileId, done);
      await retryPendingHealthRecordDeletes(kind);
    } catch (err) {
      logCrash(err, { screen: "health", op: `retryHealthRecords.${kind}` });
    }
  }
}

/** How many carbohydrate and insulin samples this app wrote for the profile. */
export async function countHealthRecordCopies(profileId: string): Promise<number> {
  if (!hasHealthProvider()) return 0;
  try {
    const [meals, shots] = await Promise.all([
      listMealHealthUuids(profileId),
      listInjectionHealthUuids(profileId),
    ]);
    return meals.length + shots.length;
  } catch {
    return 0;
  }
}

/** Call BEFORE a bulk clear or profile delete removes the rows: revokes the
 *  carbohydrate and insulin samples of the profile, queueing failures. */
export async function revokeHealthRecordsBeforeDelete(profileId: string): Promise<number> {
  if (!hasHealthProvider()) return 0;
  try {
    const meals = await listMealHealthUuids(profileId);
    const shots = await listInjectionHealthUuids(profileId);
    const a = await revokeHealthRecords("carbs", meals);
    const b = await revokeHealthRecords("insulin", shots);
    return a + b;
  } catch (err) {
    logCrash(err, { screen: "health", op: "revokeRecordsBeforeDelete" });
    return 0;
  }
}
