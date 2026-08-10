import type { Injection } from "./db/types";
import { DEFAULT_BASAL_PROFILE, DEFAULT_BOLUS_PROFILE } from "./insulinCatalog";

/**
 * Insulin on Board (IOB): an estimate of how much of a recently logged BOLUS
 * dose is still active. It exists so the app can surface when a new dose
 * would stack on top of one still working, a common cause of low readings.
 *
 * Model: a bi-exponential insulin activity curve, the same shape used by
 * open-source closed-loop projects, shaped by the chosen product's
 * time-to-peak and total duration of action (see lib/insulinCatalog.ts).
 * A peakless product (long-acting basal, or any product whose peak falls at
 * or past half its duration, where the curve below is undefined) falls back
 * to a straight linear decay instead. This stays an ESTIMATE built from the
 * user's own logs and the product's typical published figures, not a
 * per-person measurement, and never a directive; any dose that uses it stays
 * fully editable.
 *
 * Basal (long-acting) injections are tracked separately (see
 * activeInsulinBreakdown below): basal is not a mealtime correction reserve,
 * so activeInsulin() counts bolus doses only.
 */

export interface InsulinActionProfile {
  /** hours to peak effect; null for a peakless curve (most long-acting basal) */
  peakHours: number | null;
  /** total duration of action (DIA), in hours */
  durationHours: number;
}

/**
 * Fraction of a dose still active `hoursElapsed` after it was taken, in
 * [0, 1]. Outside [0, durationHours) a dose contributes nothing: negative
 * elapsed time is a future-dated log, and past the duration it has fully
 * decayed.
 */
export function remainingFraction(
  hoursElapsed: number,
  profile: InsulinActionProfile
): number {
  const td = Math.max(profile.durationHours, 0.1);
  if (hoursElapsed < 0 || hoursElapsed >= td) return 0;

  const tp = profile.peakHours;
  // The bi-exponential curve below is only defined for tp < td/2; past that
  // (and for a peakless basal, tp === null) it stops describing a sane decay,
  // so fall back to the simple linear model instead of extrapolating garbage.
  if (tp == null || tp >= td / 2) {
    return clamp01(1 - hoursElapsed / td);
  }

  const tau = (tp * (1 - tp / td)) / (1 - (2 * tp) / td);
  const a = (2 * tau) / td;
  const scale = 1 / (1 - a + (1 + a) * Math.exp(-td / tau));
  const t = hoursElapsed;
  const remaining =
    1 -
    scale *
      (1 - a) *
      (((t * t) / (tau * td * (1 - a)) - t / tau - 1) * Math.exp(-t / tau) + 1);
  // The curve can drift a hair outside [0, 1] from floating-point rounding
  // near its endpoints, so it is clamped rather than trusted verbatim.
  return clamp01(remaining);
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

type IobInjection = Pick<Injection, "insulin_type" | "dose_units" | "logged_at">;

export interface IobOptions {
  now?: Date;
  /** the user's selected bolus (mealtime) product; defaults to a generic rapid profile */
  bolusProfile?: InsulinActionProfile;
  /** the user's selected basal (long-acting) product; defaults to a generic basal profile */
  basalProfile?: InsulinActionProfile;
}

export interface IobBreakdown {
  /** estimated units still active from logged meal/correction (bolus) doses */
  bolus: number;
  /** estimated units still active from logged background (basal) doses */
  basal: number;
}

/**
 * Active insulin (units, rounded to 0.01), bolus and basal doses estimated
 * separately from each product's own action curve.
 */
export function activeInsulinBreakdown(
  injections: IobInjection[],
  options: IobOptions = {}
): IobBreakdown {
  const nowMs = (options.now ?? new Date()).getTime();
  const bolusProfile = options.bolusProfile ?? DEFAULT_BOLUS_PROFILE;
  const basalProfile = options.basalProfile ?? DEFAULT_BASAL_PROFILE;

  let bolus = 0;
  let basal = 0;
  for (const inj of injections) {
    const dose = inj.dose_units;
    if (dose == null || !Number.isFinite(dose) || dose <= 0) continue;
    const elapsedHours = (nowMs - new Date(inj.logged_at).getTime()) / 3_600_000;
    if (inj.insulin_type === "bolus") {
      bolus += dose * remainingFraction(elapsedHours, bolusProfile);
    } else if (inj.insulin_type === "basal") {
      basal += dose * remainingFraction(elapsedHours, basalProfile);
    }
  }
  return {
    bolus: Math.round(bolus * 100) / 100,
    basal: Math.round(basal * 100) / 100,
  };
}

/**
 * Active insulin (units, rounded to 0.01) from logged BOLUS doses only. This
 * is the value used for anti-stacking: basal is excluded, see the module note
 * above.
 */
export function activeInsulin(
  injections: IobInjection[],
  options: IobOptions = {}
): number {
  return activeInsulinBreakdown(injections, options).bolus;
}
