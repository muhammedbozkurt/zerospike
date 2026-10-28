import type { InsulinType, UserProfile } from "./db/types";
import { insulinModeOf } from "./insulinMode";

/**
 * What the Injection form opens on for a profile. A profile that takes only one
 * kind of insulin opens on that kind (basal with its daily amount ready); only a
 * profile using both lets the most recent entry choose, and falls back to bolus.
 * The dose stays empty for bolus: it is never filled for the user.
 */
export function injectionFormDefaults(
  profile: Pick<UserProfile, "insulin_mode" | "basal_daily_units"> | null | undefined,
  lastType: InsulinType | null = null
): { type: InsulinType; dose: number } {
  const mode = insulinModeOf(profile);
  const type: InsulinType =
    mode === "basal" ? "basal" : mode === "bolus" ? "bolus" : (lastType ?? "bolus");
  return { type, dose: type === "basal" ? (profile?.basal_daily_units ?? 0) : 0 };
}
