import type { LogTag, PeriodTag } from "./db/types";
import { mealContextFor } from "./healthMeta";

export interface CorrectionPrevious {
  glucose_level_mgdl: number;
  period_tag: PeriodTag;
  logged_at: string;
  tags: LogTag[];
}

export interface CorrectionPatch {
  glucose_level_mgdl?: number;
  period_tag?: PeriodTag;
  tags?: LogTag[];
  logged_at?: string;
}

/**
 * The columns a reading correction really changes. A field the user left as it
 * was is not written: rewriting the value or the time of an imported Health row
 * with the same figure in another spelling retires its dedup record and lets the
 * next import bring the sample back.
 */
export function glucoseCorrectionPatch(
  previous: CorrectionPrevious,
  value: number,
  period: PeriodTag,
  tags: LogTag[],
  loggedAt: Date | null
): CorrectionPatch {
  const patch: CorrectionPatch = {};
  if (value !== previous.glucose_level_mgdl) patch.glucose_level_mgdl = value;
  if (period !== previous.period_tag) patch.period_tag = period;
  if (JSON.stringify(tags) !== JSON.stringify(previous.tags)) patch.tags = tags;
  if (loggedAt && loggedAt.getTime() !== new Date(previous.logged_at).getTime()) {
    patch.logged_at = loggedAt.toISOString();
  }
  return patch;
}

/**
 * Whether the Health mirror of a corrected reading has to be rewritten: the
 * sample carries the value, the time and the meal relation of the period.
 */
export function correctionNeedsMirror(previous: CorrectionPrevious, patch: CorrectionPatch): boolean {
  if (patch.glucose_level_mgdl !== undefined || patch.logged_at !== undefined) return true;
  return (
    patch.period_tag !== undefined &&
    mealContextFor(patch.period_tag) !== mealContextFor(previous.period_tag)
  );
}
