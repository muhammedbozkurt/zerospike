import type { PeriodTag, UserProfile } from "./db/types";

export type GlucoseStatus = "normal" | "elevated" | "high";

/** Diagnostic palette (matches tailwind.config). */
export const STATUS_COLOR: Record<GlucoseStatus, string> = {
  normal: "#10b981", // emerald
  elevated: "#f59e0b", // amber
  high: "#f43f5e", // rose
};

export const STATUS_BORDER: Record<GlucoseStatus, string> = {
  normal: "border-l-normal",
  elevated: "border-l-elevated",
  high: "border-l-high",
};

export const STATUS_TEXT: Record<GlucoseStatus, string> = {
  normal: "text-normal",
  elevated: "text-elevated",
  high: "text-high",
};

/** Fasting/pre-meal/bedtime compare to the fasting target; post-meal to its own. */
function maxFor(
  tag: PeriodTag,
  profile: Pick<UserProfile, "target_fasting_max" | "target_postmeal_max">
): number {
  switch (tag) {
    case "post_meal_2h":
      return profile.target_postmeal_max;
    case "fasting":
    case "pre_meal":
    case "bedtime":
      return profile.target_fasting_max;
    case "manual":
    default:
      // Neutral manual reading: use the more lenient post-meal threshold.
      return profile.target_postmeal_max;
  }
}

/**
 * Classifies a reading against the user's personal targets.
 * - normal:   at/under target (and not hypo)
 * - elevated: up to ~25% above target
 * - high:     beyond that, OR hypoglycemia (< 70 mg/dL) which needs attention
 */
export function classifyGlucose(
  value: number,
  tag: PeriodTag,
  profile: Pick<UserProfile, "target_fasting_max" | "target_postmeal_max">
): GlucoseStatus {
  if (value < 70) return "high";
  const max = maxFor(tag, profile);
  if (value <= max) return "normal";
  if (value <= max * 1.25) return "elevated";
  return "high";
}
