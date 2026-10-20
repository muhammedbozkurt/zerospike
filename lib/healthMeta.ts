import type { PeriodTag } from "./db/types";

/**
 * Pure mapping from a local reading to the metadata both health stores take on
 * a glucose write. No native imports, so it is testable under plain tsx.
 *
 * recordId + version make a write idempotent: HealthKit (HKSyncIdentifier +
 * HKSyncVersion) and Health Connect (clientRecordId + clientRecordVersion)
 * both replace the existing sample with the same id when the new version is
 * greater, instead of adding a second one.
 */

export type MealContext = "fasting" | "before_meal" | "after_meal";

export interface HealthWriteMeta {
  recordId: string;
  /** Strictly increasing per record id (epoch ms at write time). */
  version: number;
  mealContext: MealContext | null;
  /** Carb sample that came from a carb estimate, not a measured portion. */
  estimated?: boolean;
}

/** Only tags that state a meal relation map; bedtime/manual/unset say nothing
 *  clinical, so no meal context is written for them. */
export function mealContextFor(tag: PeriodTag | null | undefined): MealContext | null {
  if (tag === "fasting") return "fasting";
  if (tag === "pre_meal") return "before_meal";
  if (tag === "post_meal_2h") return "after_meal";
  return null;
}

export function buildHealthWriteMeta(
  log: { id: string; period_tag?: PeriodTag | null },
  nowMs: number = Date.now()
): HealthWriteMeta {
  return {
    recordId: log.id,
    version: Math.max(1, Math.floor(nowMs)),
    mealContext: mealContextFor(log.period_tag),
  };
}

/**
 * The next sync version for one record: the clock, but never at or below the
 * last version this process wrote for it. Two writes of the same reading inside
 * one millisecond would otherwise carry equal versions, which Health Connect
 * ignores and HealthKit refuses (the older value then stays in the store).
 */
export function nextSyncVersion(previous: number | undefined, nowMs: number): number {
  const now = Math.max(1, Math.floor(nowMs));
  return previous != null && Number.isFinite(previous) && previous >= now ? previous + 1 : now;
}

/** The record id and version are only usable as a sync pair when the id is a
 *  non-blank string and the version a finite positive number. */
export function hasValidSyncKey(meta: Pick<HealthWriteMeta, "recordId" | "version">): boolean {
  return (
    typeof meta.recordId === "string" &&
    meta.recordId.trim().length > 0 &&
    typeof meta.version === "number" &&
    Number.isFinite(meta.version) &&
    meta.version > 0
  );
}

/** Keys and values verified against @kingstinct/react-native-healthkit 14.0.2
 *  (see healthAppleKit.ts); values are passed through AnyMap untouched. */
export function toHealthKitMetadata(meta: HealthWriteMeta): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = { HKWasUserEntered: true };
  // HealthKit rejects an empty sync identifier or a non-positive version with a
  // native exception (not a JS rejection), so the pair is only sent when valid.
  if (hasValidSyncKey(meta)) {
    out.HKMetadataKeySyncIdentifier = meta.recordId;
    out.HKMetadataKeySyncVersion = meta.version;
  }
  // HKBloodGlucoseMealTime: 1 = preprandial, 2 = postprandial.
  if (meta.mealContext === "fasting" || meta.mealContext === "before_meal") {
    out.HKBloodGlucoseMealTime = 1;
  } else if (meta.mealContext === "after_meal") {
    out.HKBloodGlucoseMealTime = 2;
  }
  return out;
}

/** Custom HealthKit metadata key (not an HK* key) that marks a carbohydrate
 *  sample as an estimate. It is replaced together with the sample on a rewrite. */
export const HK_ESTIMATE_KEY = "ZerospikeEstimated";

/** Extra HealthKit metadata of a carbohydrate sample; empty when measured. */
export function carbEstimateMetadata(estimated: boolean | undefined): Record<string, boolean> {
  return estimated ? { [HK_ESTIMATE_KEY]: true } : {};
}

/** i18n keys of the Health Connect NutritionRecord.name. Its metadata has no
 *  custom keys, so the name carries the estimate mark; it never holds the
 *  user's own meal text. */
export const HC_NAME_KEY = "healthSync.recordName";
export const HC_NAME_ESTIMATED_KEY = "healthSync.recordNameEstimated";

/** Record name in the language `t` translates to (the app language at write
 *  time). Pure: the caller supplies the translator so this file stays free of
 *  react-native and i18next. */
export function carbRecordName(estimated: boolean | undefined, t: (key: string) => string): string {
  return t(estimated ? HC_NAME_ESTIMATED_KEY : HC_NAME_KEY);
}

/** react-native-health-connect RelationToMeal: GENERAL 1, FASTING 2,
 *  BEFORE_MEAL 3, AFTER_MEAL 4, UNKNOWN 0. */
export function toRelationToMeal(ctx: MealContext | null): number {
  if (ctx === "fasting") return 2;
  if (ctx === "before_meal") return 3;
  if (ctx === "after_meal") return 4;
  return 0;
}
