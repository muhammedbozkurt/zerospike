/**
 * Pure decision layer for the Apple Health WRITE mirror.
 *
 * It lives outside lib/services/health.ts because that module pulls in Expo /
 * native code, which cannot be loaded under plain Node - and this is exactly
 * the part that has to be provable (scripts/healthProfile.test.ts).
 *
 * The rule it encodes: mirroring readings to Apple Health is a PER PROFILE
 * opt-in. The flag used to be one value for the whole device, so on a shared
 * (family / caregiver) install a reading logged under one profile could land in
 * another person's Health account.
 */

export interface HealthWriteDecisionInput {
  /** The stored mirror toggle, as read for {@link enabledProfileId}. */
  writeEnabledForProfile: boolean;
  /** Profile the reading being mirrored belongs to. */
  recordProfileId: string | null | undefined;
  /** Profile the toggle above was read for (normally the active profile). */
  enabledProfileId: string | null | undefined;
}

/**
 * True only when the toggle is on AND the reading belongs to the very profile
 * that toggle was read for. An unknown profile on either side is a "no": there
 * is nothing to match, and a silent write into the wrong Health account is a
 * worse outcome than a missing mirror.
 */
export function shouldWriteToHealth(input: HealthWriteDecisionInput): boolean {
  const { writeEnabledForProfile, recordProfileId, enabledProfileId } = input;
  if (!writeEnabledForProfile) return false;
  if (!recordProfileId || !enabledProfileId) return false;
  return recordProfileId === enabledProfileId;
}

/** What storage holds for the mirror flag right now. */
export interface WriteFlagStored {
  /** Value at "<base>.<profileId>", or null when this profile has none yet. */
  scoped: string | null;
  /** Value at the retired device-wide "<base>" key, or null once cleared. */
  legacy: string | null;
}

/** What a read of the mirror flag resolves to, plus the storage repair it owes. */
export interface WriteFlagPlan {
  enabled: boolean;
  /** Value to write to the scoped key, or null when nothing needs writing. */
  adoptScoped: string | null;
  /** Whether the device-wide key must be removed. */
  clearLegacy: boolean;
}

/**
 * Resolves a mirror-flag read and, on the FIRST read that still finds the old
 * device-wide value, hands it to this one profile and retires the shared key.
 *
 * Idempotent by construction: the adopt branch only runs while `scoped` is
 * null, and it is the same pass that clears `legacy`, so a second run sees
 * scoped set and legacy gone and asks for no writes at all. Any later profile
 * finds nothing to inherit, which is the whole point of the hand-off.
 */
export function planWriteFlagRead({ scoped, legacy }: WriteFlagStored): WriteFlagPlan {
  if (scoped != null) {
    return { enabled: scoped === "1", adoptScoped: null, clearLegacy: legacy != null };
  }
  if (legacy == null) return { enabled: false, adoptScoped: null, clearLegacy: false };
  return { enabled: legacy === "1", adoptScoped: legacy, clearLegacy: true };
}
