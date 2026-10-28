import { activeInsulinBreakdown, type IobBreakdown, type InsulinActionProfile } from "./iob";
import type { Injection } from "./db/types";

type CalcIobRow = Pick<Injection, "id" | "insulin_type" | "dose_units" | "logged_at">;

/**
 * Active insulin as the calculator should see it for ONE record.
 * - Editing a meal: only the bolus row being edited (excludeInjectionId) is left
 *   out; it is the dose under correction, not insulin already on board. A row
 *   turned into basal or a second calculator row of the meal still counts.
 * - A record dated earlier than now: doses logged up to the record's time are
 *   measured at that time; doses logged after it (but already taken) are
 *   measured now, so a back-dated record never drops them. When unsure, active
 *   insulin is over-counted, never under-counted. A record time in the future
 *   is treated as now.
 */
export function calculatorIob(
  injections: CalcIobRow[],
  opts: {
    excludeInjectionId?: string | null;
    at?: Date | null;
    now?: Date;
    bolusProfile?: InsulinActionProfile;
    basalProfile?: InsulinActionProfile;
  }
): IobBreakdown {
  const now = opts.now ?? new Date();
  const rows = opts.excludeInjectionId
    ? injections.filter((i) => i.id !== opts.excludeInjectionId)
    : injections;
  const profiles = { bolusProfile: opts.bolusProfile, basalProfile: opts.basalProfile };
  if (!opts.at || opts.at.getTime() >= now.getTime()) {
    return activeInsulinBreakdown(rows, { ...profiles, now });
  }
  const atMs = opts.at.getTime();
  const upToAt = rows.filter((r) => new Date(r.logged_at).getTime() <= atMs);
  const afterAt = rows.filter((r) => new Date(r.logged_at).getTime() > atMs);
  const early = activeInsulinBreakdown(upToAt, { ...profiles, now: opts.at });
  const late = activeInsulinBreakdown(afterAt, { ...profiles, now });
  return {
    bolus: Math.round((early.bolus + late.bolus) * 100) / 100,
    basal: Math.round((early.basal + late.basal) * 100) / 100,
  };
}
