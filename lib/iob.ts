import type { Injection } from "./db/types";

/**
 * Insulin on Board (IOB) — estimated *active* insulin still working from
 * recently logged BOLUS injections. Its whole purpose is safety: it lets the
 * app warn against "stacking" (dosing again while a prior dose is still active),
 * a common cause of hypoglycemia.
 *
 * Model: a simple, transparent LINEAR decay over the duration of insulin action
 * (DIA). Fraction remaining = 1 − elapsed / DIA, clamped to [0, 1]. We keep the
 * model deliberately simple so it can be explained on the sources screen; it is
 * an educational ESTIMATE from the user's own logs, never a directive, and any
 * dose that uses it stays fully editable.
 *
 * Basal (long-acting) injections are excluded — basal is not a mealtime
 * correction reservoir, so counting it would over-state active bolus insulin.
 */

/** Duration of insulin action for rapid-acting analogues (hours). */
export const DEFAULT_DIA_HOURS = 4;

type IobInjection = Pick<Injection, "insulin_type" | "dose_units" | "logged_at">;

/**
 * Active insulin (units, rounded to 0.01) at `now` from logged bolus doses
 * within the last DIA hours. Returns 0 when nothing is active.
 */
export function activeInsulin(
  injections: IobInjection[],
  now: Date = new Date(),
  diaHours: number = DEFAULT_DIA_HOURS
): number {
  const nowMs = now.getTime();
  const diaMs = Math.max(diaHours, 0.1) * 3_600_000;
  let iob = 0;
  for (const inj of injections) {
    if (inj.insulin_type !== "bolus") continue;
    const dose = inj.dose_units;
    if (dose == null || !Number.isFinite(dose) || dose <= 0) continue;
    const elapsed = nowMs - new Date(inj.logged_at).getTime();
    if (elapsed < 0 || elapsed >= diaMs) continue; // future / fully decayed
    iob += dose * (1 - elapsed / diaMs);
  }
  return Math.round(iob * 100) / 100;
}
