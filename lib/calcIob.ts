import { activeInsulinBreakdown, type IobBreakdown, type InsulinActionProfile } from "./iob";
import type { Injection } from "./db/types";

type CalcIobRow = Pick<Injection, "insulin_type" | "dose_units" | "logged_at" | "meal_log_id">;

/**
 * Active insulin as the calculator should see it for ONE record.
 * - Editing a meal: its own bolus row is the dose being corrected, not insulin
 *   already on board, so it is left out.
 * - A record dated earlier than now: active insulin is measured at the record's
 *   time (doses logged after it count for nothing there), not at this moment.
 */
export function calculatorIob(
  injections: CalcIobRow[],
  opts: {
    mealLogId?: string | null;
    at?: Date | null;
    now?: Date;
    bolusProfile?: InsulinActionProfile;
    basalProfile?: InsulinActionProfile;
  }
): IobBreakdown {
  const rows = opts.mealLogId
    ? injections.filter((i) => !(i.meal_log_id === opts.mealLogId && i.insulin_type === "bolus"))
    : injections;
  return activeInsulinBreakdown(rows, {
    now: opts.at ?? opts.now ?? new Date(),
    bolusProfile: opts.bolusProfile,
    basalProfile: opts.basalProfile,
  });
}
