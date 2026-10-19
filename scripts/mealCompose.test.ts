/**
 * Multi-food meal composition (lib/mealCompose.ts):
 *
 *   npx tsx scripts/mealCompose.test.ts
 */

declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import {
  addComposeItem,
  addEstimateLines,
  composeCanSave,
  composeCanSaveTemplate,
  composeHasEstimate,
  setEstimateCarbs,
  updateEstimateLine,
  composeItemCarbs,
  composeItemFromFood,
  composeMealInput,
  composeTemplateItems,
  composeTotals,
  parseGramsInput,
  pruneDrafts,
  removeComposeItem,
  setComposePortion,
  type ComposeItem,
} from "../lib/mealCompose";
import { templateCarbs } from "../lib/mealTemplates";
import { mealEditMode } from "../lib/mealRoute";
import { SCENE_LANGS, sceneFoods, sceneLang, sceneStarters } from "../lib/mealScene";
import { SEED_FOODS } from "../lib/db/seed";
import { seedNameKey } from "../lib/db/seedVersion";
import type { Food } from "../lib/db/types";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  x ${name}${detail ? ": " + detail : ""}`);
  }
}

const item = (id: string, carb: number, g: number): ComposeItem => ({
  key: id,
  food_id: id,
  name: id,
  category: "grains",
  carb_100g: carb,
  portion_g: g,
});

ok("carbs = g x carb/100", composeItemCarbs(item("a", 28, 150)) === 42);
ok("rounds to one decimal", composeItemCarbs(item("a", 13.3, 33)) === 4.4, String(composeItemCarbs(item("a", 13.3, 33))));
ok("zero grams -> 0", composeItemCarbs(item("a", 28, 0)) === 0);
ok("negative grams -> 0", composeItemCarbs(item("a", 28, -50)) === 0);
ok("NaN grams -> 0", composeItemCarbs(item("a", 28, NaN)) === 0);
ok("NaN carb -> 0", composeItemCarbs(item("a", NaN, 100)) === 0);

const two = [item("a", 13.3, 33), item("b", 28, 150)];
ok("total sums rounded rows", composeTotals(two).carbs_g === 46.4, String(composeTotals(two).carbs_g));
ok("total portion", composeTotals(two).portion_g === 183);
ok("total count", composeTotals(two).count === 2);
ok("empty total", composeTotals([]).carbs_g === 0 && composeTotals([]).count === 0);

ok(
  "same total as the template rule",
  templateCarbs(
    two.map((i) => ({
      food_id: i.food_id,
      name_snapshot: i.name,
      carb_100g_snapshot: i.carb_100g,
      portion_g: i.portion_g,
      carbs_g_fixed: null,
      food: null,
    }))
  ) === composeTotals(two).carbs_g
);

ok("parse comma decimal", parseGramsInput("12,5") === 12.5);
ok("parse empty", parseGramsInput("") === 0);
ok("parse junk", parseGramsInput("abc") === 0);
ok("parse negative", parseGramsInput("-5") === 0);
ok("parse capped", parseGramsInput("999999") === 9999);
ok("parse rounds", parseGramsInput("10.04") === 10);

const food = {
  id: "f1",
  category: "fruit",
  carb_100g: 12,
  portion_size_g: 120,
} as unknown as Food;
ok("food default portion", composeItemFromFood(food, "Elma").portion_g === 120);
ok(
  "food without portion -> 100",
  composeItemFromFood({ ...food, portion_size_g: 0 } as Food, "Elma").portion_g === 100
);

const added = addComposeItem([], item("a", 10, 100));
ok("add once", addComposeItem(added, item("a", 10, 100)).length === 1);
ok("add second", addComposeItem(added, item("b", 10, 100)).length === 2);
ok("remove", removeComposeItem(added, "a").length === 0);
ok("set portion", setComposePortion(added, "a", 55.55)[0].portion_g === 55.6);
ok("set portion clamps negative", setComposePortion(added, "a", -3)[0].portion_g === 0);
ok("set portion NaN", setComposePortion(added, "a", NaN)[0].portion_g === 0);
ok("set portion leaves others", setComposePortion(two, "a", 10)[1].portion_g === 150);

ok("cannot save empty", !composeCanSave([]));
ok("cannot save zero-gram row", !composeCanSave([item("a", 10, 0), item("b", 10, 100)]));
ok("can save", composeCanSave(two));

const meal = composeMealInput(two);
ok("meal name joins", meal.custom_food_name === "a + b");
ok("meal carbs", meal.calculated_carbs_g === 46.4);
ok("meal portion", meal.portion_g === 183);
ok("meal name capped", composeMealInput([item("x".repeat(300), 1, 1)]).custom_food_name.length === 120);

const tpl = composeTemplateItems(two);
ok("template items map", tpl.length === 2 && tpl[1].portion_g === 150 && tpl[1].carb_100g_snapshot === 28);

// ── estimate lines, carb-only mixed meals (D1-A) ────────────────────────────
const est = (name: string, qty: number, unit: string, carbs: number) => ({
  name,
  quantity: qty,
  unit,
  grams_carb: carbs,
});
const mixed = addEstimateLines(two, [est("Ekmek", 2, "dilim", 28), est("Süt", 1, "bardak", 12.2)]);
ok("estimate lines appended", mixed.length === 4 && mixed[2].estimate === true && mixed[3].estimate === true);
ok("estimate keys are fresh and unique", new Set(mixed.map((i) => i.key)).size === 4 && mixed[2].key === "est:0" && mixed[3].key === "est:1");
ok("second batch continues numbering", addEstimateLines(mixed, [est("Çay", 1, "bardak", 10)])[4].key === "est:2");
ok("estimate carbs are the fixed figure", composeItemCarbs(mixed[2]) === 28 && composeItemCarbs(mixed[3]) === 12.2);
ok("estimate portion stays 0", mixed[2].portion_g === 0);
ok("mixed total adds rows and estimates", composeTotals(mixed).carbs_g === 86.6, String(composeTotals(mixed).carbs_g));
ok("setComposePortion leaves an estimate line alone", setComposePortion(mixed, "est:0", 500)[2].portion_g === 0);
ok("setEstimateCarbs edits only estimate lines", setEstimateCarbs(mixed, "est:0", 31.25)[2].carbs_g_fixed === 31.3 && setEstimateCarbs(mixed, "a", 5)[0].carbs_g_fixed === undefined);
ok("setEstimateCarbs clamps negative", setEstimateCarbs(mixed, "est:0", -4)[2].carbs_g_fixed === 0);
ok("hasEstimate", composeHasEstimate(mixed) && !composeHasEstimate(two));
const edited = updateEstimateLine(mixed, "est:0", { name: " Tost ", quantity: 3, unit: " dilim ", grams_carb: 41.26 });
ok("updateEstimateLine edits name, amount, unit and carbs", edited[2].name === "Tost" && edited[2].quantity === 3 && edited[2].unit === "dilim" && edited[2].carbs_g_fixed === 41.3);
ok("updateEstimateLine leaves food rows and other lines alone", edited[0] === mixed[0] && edited[3] === mixed[3] && updateEstimateLine(mixed, "a", { name: "x" })[0].name === mixed[0].name);
ok("updateEstimateLine blank name blocks saving", !composeCanSave(updateEstimateLine(mixed, "est:0", { name: "  " })));
ok("updateEstimateLine partial patch keeps the rest", updateEstimateLine(mixed, "est:0", { grams_carb: 5 })[2].name === "Ekmek");

const mixedMeal = composeMealInput(mixed);
ok("mixed meal: portion_g 0", mixedMeal.portion_g === 0, String(mixedMeal.portion_g));
ok("mixed meal: food_id null", mixedMeal.food_id === null);
ok("mixed meal: no dose", mixedMeal.insulin_dose_units === 0);
ok("mixed meal: carbs 86.6", mixedMeal.calculated_carbs_g === 86.6);
ok("mixed meal: carbOnly flag", mixedMeal.carbOnly === true);
ok("mixed meal: name carries the estimate amount", mixedMeal.custom_food_name === "a + b + Ekmek (2 dilim) + Süt (1 bardak)", mixedMeal.custom_food_name);
ok(
  "mixed meal reopens carb-only (mealEditMode)",
  mealEditMode({ food_id: mixedMeal.food_id, portion_g: mixedMeal.portion_g, custom_food_name: mixedMeal.custom_food_name, calculated_carbs_g: mixedMeal.calculated_carbs_g }) === "carbOnly"
);
const plainMeal = composeMealInput(two);
ok("plain meal: still its summed portion", plainMeal.portion_g === 183 && plainMeal.carbOnly === false);
ok(
  "plain meal still opens in the calculator",
  mealEditMode({ food_id: plainMeal.food_id, portion_g: plainMeal.portion_g, custom_food_name: plainMeal.custom_food_name, calculated_carbs_g: plainMeal.calculated_carbs_g }) === "calculator"
);
const forced = composeMealInput(two, { carbOnly: true });
ok("carbOnly option zeroes the portion", forced.portion_g === 0 && forced.calculated_carbs_g === 46.4 && forced.carbOnly);
ok("carbOnly:false on an estimate meal is honoured only by the caller", composeMealInput(mixed, { carbOnly: false }).carbOnly === false);
ok("zero-gram estimate (black coffee) can be saved", composeCanSave([...two, ...addEstimateLines([], [est("Kahve", 1, "fincan", 0)])]));
ok("nameless estimate line cannot be saved", !composeCanSave(addEstimateLines([], [est("-", 1, "x", 5)])));
ok("estimate-only meal can be saved", composeCanSave(addEstimateLines([], [est("Ekmek", 2, "dilim", 28)])));

ok("template save closed with an estimate line", !composeCanSaveTemplate(mixed));
ok("template items empty with an estimate line", composeTemplateItems(mixed).length === 0);
ok("template save open for plain foods", composeCanSaveTemplate(two) && composeTemplateItems(two).length === 2);
ok("template save closed for an empty meal", !composeCanSaveTemplate([]));

// ── meal scene (4): 9 languages ─────────────────────────────────────────────
const byEnName = new Map(SEED_FOODS.map((f) => [seedNameKey(f.en), f]));
const pendingMeasures: string[] = [];
ok("scene covers the 9 app languages", SCENE_LANGS.length === 9);
for (const lang of SCENE_LANGS) {
  const foods = sceneFoods(lang);
  ok(`${lang}: three scene foods`, foods.length === 3);
  ok(`${lang}: three distinct foods`, new Set(foods.map((f) => f.en)).size === 3);
  ok(`${lang}: starters are the scene foods`, JSON.stringify(sceneStarters(lang)) === JSON.stringify(foods.map((f) => f.en)));
  for (const sf of foods) {
    const seed = byEnName.get(seedNameKey(sf.en));
    ok(`${lang}: "${sf.en}" exists in the catalogue`, !!seed);
    ok(`${lang}: "${sf.en}" grams sane`, sf.grams > 0 && sf.grams <= 500);
    if (seed && !(seed.portions && seed.portions.length > 0)) pendingMeasures.push(`${lang}:${sf.en}`);
  }
}
ok("scene locale normalisation", sceneLang("tr-TR") === "tr" && sceneLang("pt_BR") === "pt" && sceneLang("AR") === "ar" && sceneLang("xx") === "en" && sceneLang("") === "en");
console.log(`  (scene foods still without a measure, P6 seedPortions fills them: ${pendingMeasures.length ? pendingMeasures.join(", ") : "none"})`);

{
  const first = addEstimateLines([], [{ name: "Bread", quantity: 2, unit: "slice", grams_carb: 28 }]);
  const drafts = { [first[0].key]: { name: "Bread" } };
  const removed = removeComposeItem(first, first[0].key);
  const kept = pruneDrafts(drafts, removed);
  ok("removing an estimate line drops its draft", Object.keys(kept).length === 0);
  const again = addEstimateLines(removed, [{ name: "Coffee", quantity: 1, unit: "cup", grams_carb: 0 }]);
  ok("re-added line gets a clean draft slot", kept[again[0].key] === undefined);
  ok("prune keeps drafts of rows still listed", pruneDrafts(drafts, first) === drafts);
}

console.log(`mealCompose: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
