/**
 * Estimate mark on carbohydrate samples written to the health store:
 * isEstimatedMeal, the rewrite decision, the write path carrying the flag, the
 * HealthKit metadata object and the Health Connect record name (per app
 * language, present on measured meals too; iOS metadata unchanged).
 * Run: npx tsx scripts/healthEstimateLabel.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (c: number) => void };
import { eq, fake, finish, kv, ok, resetAll, section } from "./healthTestHarness";

const base = { id: "m1", profile_id: "P", logged_at: "2026-10-05T12:00:00.000Z", health_uuid: null };
const estimate = { ...base, food_id: null, portion_g: 0, calculated_carbs_g: 45 };
const weighed = { ...base, food_id: null, portion_g: 150, calculated_carbs_g: 45 };
const catalogue = { ...base, food_id: "f1", portion_g: 0, calculated_carbs_g: 45 };

async function main(): Promise<void> {
  const H = await import("../lib/healthRecords");
  const M = await import("../lib/healthMeta");
  const S = await import("../lib/services/health");
  console.log("zerospike health estimate label test");

  section("A. isEstimatedMeal");
  eq("no food, no weight, carbs -> estimate", H.isEstimatedMeal(estimate as any), true);
  eq("weighed custom meal -> measured", H.isEstimatedMeal(weighed as any), false);
  eq("catalogue food -> measured", H.isEstimatedMeal(catalogue as any), false);
  eq("0 g carbs -> not an estimate", H.isEstimatedMeal({ ...estimate, calculated_carbs_g: 0 } as any), false);
  eq("NaN carbs -> not an estimate", H.isEstimatedMeal({ ...estimate, calculated_carbs_g: "x" } as any), false);

  section("B. mealRecordInput and needsMirror");
  eq("estimate input flagged", (H.mealRecordInput(estimate as any) as any).estimated, true);
  eq("measured input unflagged", (H.mealRecordInput(weighed as any) as any).estimated, undefined);
  const a = H.mealRecordInput(estimate as any);
  const b = H.mealRecordInput(weighed as any);
  eq("same grams, estimate flag changed -> rewrite", H.needsMirror(a, b), true);
  eq("same grams, same flag -> no rewrite", H.needsMirror(a, H.mealRecordInput(estimate as any)), false);
  eq(
    "grams change still rewrites",
    H.needsMirror(a, H.mealRecordInput({ ...estimate, calculated_carbs_g: 50 } as any)),
    true
  );

  section("C. HealthKit metadata and Health Connect name");
  eq("estimate -> custom key", JSON.stringify(M.carbEstimateMetadata(true)), '{"ZerospikeEstimated":true}');
  eq("measured -> no extra key", JSON.stringify(M.carbEstimateMetadata(false)), "{}");
  eq("undefined -> no extra key", JSON.stringify(M.carbEstimateMetadata(undefined)), "{}");
  eq("custom key is not an HK key", M.HK_ESTIMATE_KEY.startsWith("HK"), false);
  const NAMES: Record<string, [string, string]> = {
    tr: ["zerospike · Öğün", "zerospike · Öğün (tahmin)"],
    en: ["zerospike · Meal", "zerospike · Meal (estimate)"],
    de: ["zerospike · Mahlzeit", "zerospike · Mahlzeit (Schätzung)"],
    fr: ["zerospike · Repas", "zerospike · Repas (estimation)"],
    es: ["zerospike · Comida", "zerospike · Comida (estimación)"],
    it: ["zerospike · Pasto", "zerospike · Pasto (stima)"],
    pt: ["zerospike · Refeição", "zerospike · Refeição (estimativa)"],
    ar: ["zerospike · وجبة", "zerospike · وجبة (تقدير)"],
    ja: ["zerospike · 食事", "zerospike · 食事 (推定)"],
  };
  const BUNDLES: Record<string, any> = {};
  for (const lang of Object.keys(NAMES)) {
    const bundle = (await import(`../lib/i18n/locales/${lang}`)).default as any;
    BUNDLES[lang] = bundle;
    const t = (k: string) => k.split(".").reduce((o: any, p) => o?.[p], bundle) as string;
    eq(`${lang} measured name`, M.carbRecordName(false, t), NAMES[lang][0]);
    eq(`${lang} measured name (undefined flag)`, M.carbRecordName(undefined, t), NAMES[lang][0]);
    eq(`${lang} estimate name`, M.carbRecordName(true, t), NAMES[lang][1]);
    ok(`${lang} uses U+00B7, no em-dash`, NAMES[lang][1].includes(String.fromCharCode(0xb7)) && !NAMES[lang][1].includes(String.fromCharCode(0x2014)));
  }
  {
    let lang = "tr";
    const t = (k: string) =>
      k.split(".").reduce((o: any, p) => o?.[p], BUNDLES[lang]) as string;
    const before = M.carbRecordName(true, t);
    lang = "de";
    eq("name follows the write-time language", [before, M.carbRecordName(true, t)].join("|"), `${NAMES.tr[1]}|${NAMES.de[1]}`);
  }
  const hk = M.toHealthKitMetadata({ recordId: "m1", version: 5, mealContext: null, estimated: true });
  ok("sync pair kept", hk.HKMetadataKeySyncIdentifier === "m1" && hk.HKMetadataKeySyncVersion === 5);
  ok("shared glucose mapping does not emit the estimate key", !("ZerospikeEstimated" in hk));

  section("D. write path carries the flag through a rewrite");
  resetAll("ios");
  kv.set("zerospike.healthWriteCarbs.P", "1");
  fake.authorized = true;
  const w1 = await S.mirrorHealthRecord(H.mealRecordInput(estimate as any) as any, []);
  eq("estimate written", w1.outcome, "written");
  eq("provider got estimated=true", fake.samples.get(w1.uuid!)?.meta?.estimated, true);
  eq("sync id intact", fake.samples.get(w1.uuid!)?.meta?.recordId, "m1");
  const w2 = await S.mirrorHealthRecord(H.mealRecordInput({ ...estimate, calculated_carbs_g: 60 } as any) as any, [w1.uuid]);
  eq("rewrite written", w2.outcome, "written");
  eq("rewrite keeps estimated=true", fake.samples.get(w2.uuid!)?.meta?.estimated, true);
  eq("old sample revoked", fake.samples.has(w1.uuid!), false);
  const w3 = await S.mirrorHealthRecord(H.mealRecordInput({ ...weighed, id: "m2" } as any) as any, []);
  eq("measured meal provider flag false", fake.samples.get(w3.uuid!)?.meta?.estimated, false);

  finish();
}

main().catch((e) => {
  console.log("fatal", e);
  process.exit(1);
});
