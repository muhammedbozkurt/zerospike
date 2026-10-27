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
  /** lib/calcSetup.ts - the ratios sheet's one-time auto-open marker. */
  "zerospike.ratiosConfirmPrompted",
  /** lib/calcSetup.ts - the pre-2.4 sheet's flag; nothing reads it, deleting a profile still sweeps it. */
  "zerospike.calcSetupDismissed",
  /** lib/healthFirstImport.ts - the one-time first Apple Health import marker. */
  "zerospike.healthFirstImportDone",
  /** lib/reportName.ts - the optional name printed on the PDF report. */
  "zerospike.reportName",
  /** lib/services/health.ts - per-type Health write switches, background sync, last sync. */
  "zerospike.healthWriteCarbs",
  "zerospike.healthWriteInsulin",
  "zerospike.healthBgSync",
  "zerospike.healthLastSync",
  "zerospike.healthWriteStatus",
  /** lib/services/health.ts - where the HealthKit anchored glucose read resumes. */
  "zerospike.healthHkAnchor",
  /** lib/services/health.ts - retry queues, `<base>.<kind>.<profileId>`. */
  "zerospike.healthWritePending",
  "zerospike.healthWritePending.carbs",
  "zerospike.healthWritePending.insulin",
  /** lib/cgm/state.ts - how this profile gets its readings (manual, cgm, nightscout). */
  "zerospike.cgmMode",
  /** lib/cgm/state.ts - the one-time "switch to CGM" answer. */
  "zerospike.cgmOffer",
  /** lib/cgm/reminderMode.ts - measurement reminders the user switched back on in sensor mode. */
  "zerospike.cgmGlucoseOptIn",
  /** lib/cgm/postMealLink.ts - 2-hour values waiting for sensor readings. */
  "zerospike.cgmPostMealPending",
  /** lib/useCgmWindow.ts - the sensor curve window (3, 6 or 12 hours) last chosen. */
  "zerospike.cgmCurveHours",
  /** lib/nightscout/sync.ts - the "Delete data" floor; a disconnect keeps it, a profile delete clears it. */
  "zerospike.nightscoutFloor",
] as const;

/** The concrete keys one profile owns. The scoped form is always
 *  `<base>.<profileId>`, the shape every owner above already writes. */
export function profileScopedKeys(profileId: string): string[] {
  return PROFILE_SCOPED_KEY_BASES.map((base) => `${base}.${profileId}`);
}
