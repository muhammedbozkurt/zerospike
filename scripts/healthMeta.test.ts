/**
 * lib/healthMeta.ts: pure mapping of a reading to HealthKit / Health Connect
 * write metadata.
 *
 * Run: npx tsx scripts/healthMeta.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import {
  buildHealthWriteMeta,
  hasValidSyncKey,
  mealContextFor,
  toHealthKitMetadata,
  toRelationToMeal,
} from "../lib/healthMeta";

let passed = 0;
let failed = 0;
function eq<T>(name: string, actual: T, expected: T): void {
  if (actual === expected) passed++;
  else {
    failed++;
    console.log(`  ✗ ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

eq("fasting", mealContextFor("fasting"), "fasting");
eq("pre_meal", mealContextFor("pre_meal"), "before_meal");
eq("post_meal_2h", mealContextFor("post_meal_2h"), "after_meal");
eq("bedtime has no context", mealContextFor("bedtime"), null);
eq("manual has no context", mealContextFor("manual"), null);
eq("unset has no context", mealContextFor("unset"), null);
eq("missing tag", mealContextFor(undefined), null);

const m = buildHealthWriteMeta({ id: "abc", period_tag: "post_meal_2h" }, 1760000000123.9);
eq("record id is the row id", m.recordId, "abc");
eq("version is whole ms", m.version, 1760000000123);
eq("context carried", m.mealContext, "after_meal");
eq("version never below 1", buildHealthWriteMeta({ id: "x" }, 0).version, 1);
eq("later write has a greater version", buildHealthWriteMeta({ id: "x" }, 2000).version > buildHealthWriteMeta({ id: "x" }, 1000).version, true);

const hk = toHealthKitMetadata(m);
eq("HK sync id key", hk.HKMetadataKeySyncIdentifier, "abc");
eq("HK sync version key", hk.HKMetadataKeySyncVersion, 1760000000123);
eq("HK user entered", hk.HKWasUserEntered, true);
eq("HK postprandial", hk.HKBloodGlucoseMealTime, 2);
eq("HK fasting is preprandial", toHealthKitMetadata({ ...m, mealContext: "fasting" }).HKBloodGlucoseMealTime, 1);
eq("HK before meal is preprandial", toHealthKitMetadata({ ...m, mealContext: "before_meal" }).HKBloodGlucoseMealTime, 1);
eq("HK no meal time when unknown", toHealthKitMetadata({ ...m, mealContext: null }).HKBloodGlucoseMealTime, undefined);
eq("blank record id sends no sync keys", toHealthKitMetadata({ ...m, recordId: "  " }).HKMetadataKeySyncIdentifier, undefined);
eq("blank record id still marks user entered", toHealthKitMetadata({ ...m, recordId: "" }).HKWasUserEntered, true);
eq("NaN version sends no sync keys", toHealthKitMetadata({ ...m, version: NaN }).HKMetadataKeySyncVersion, undefined);
eq("zero version sends no sync keys", toHealthKitMetadata({ ...m, version: 0 }).HKMetadataKeySyncIdentifier, undefined);
eq("valid pair is accepted", hasValidSyncKey(m), true);
eq("meal time is only ever 1 or 2", [1, 2].includes(toHealthKitMetadata(m).HKBloodGlucoseMealTime as number), true);

eq("HC unknown", toRelationToMeal(null), 0);
eq("HC fasting", toRelationToMeal("fasting"), 2);
eq("HC before", toRelationToMeal("before_meal"), 3);
eq("HC after", toRelationToMeal("after_meal"), 4);

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
