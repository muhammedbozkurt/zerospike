/**
 * Every AsyncStorage key that is kept PER PROFILE, in one list (X9).
 *
 * Deleting a profile removes its rows from SQLite (ON DELETE CASCADE, plus the
 * explicit reminders sweep in lib/db/profiles.ts), but its AsyncStorage flags
 * were left behind forever: the Apple Health write opt-in, the two dismissed
 * dashboard hints, the injection rotation cycle start, the screenshot seed
 * marker. Harmless in the sense that nothing reads them once the profile is
 * gone, but they accumulate, they carry a health preference the user asked to
 * remove with the profile, and a recycled id would silently inherit them.
 *
 * The base names are duplicated here rather than imported: their owners are
 * screens and services that pull in Expo/React Native, and this list has to
 * stay importable from anywhere (including a plain Node test). Every entry is
 * pinned by scripts/profileScopedKeys.test.ts against the real source files, so
 * a rename that forgets this list fails there instead of silently orphaning.
 */
export const PROFILE_SCOPED_KEY_BASES = [
  /** lib/services/health.ts - the Apple Health WRITE opt-in (K3-5). */
  "zerospike.healthWriteEnabled",
  /** app/(tabs)/index.tsx - "tap a row to edit it" hint, dismissed once. */
  "zerospike.editHintDismissed",
  /** app/(tabs)/index.tsx - the "finish setting up" row, dismissed once. */
  "zerospike.finishSetupDismissed",
  /** lib/rotationCycle.ts - when this profile's injection rotation started. */
  "zerospike.rotationCycleStart",
  /** lib/db/screenshotSeed.ts - which language this profile was seeded in. */
  "zerospike.screenshotSeededLang.v16",
  /** lib/calcSetup.ts - the calculator's first-use number sheet, put away once. */
  "zerospike.calcSetupDismissed",
] as const;

/** The concrete keys one profile owns. The scoped form is always
 *  `<base>.<profileId>`, the shape every owner above already writes. */
export function profileScopedKeys(profileId: string): string[] {
  return PROFILE_SCOPED_KEY_BASES.map((base) => `${base}.${profileId}`);
}
