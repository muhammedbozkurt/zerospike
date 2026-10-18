/**
 * Multi-food meal composition (lib/mealCompose.ts):
 *
 *   npx tsx scripts/mealCompose.test.ts
 */

declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import {
  addComposeItem,
  composeCanSave,
  composeItemCarbs,
  composeItemFromFood,
  composeMealInput,
  composeTemplateItems,
  composeTotals,
  parseGramsInput,
  removeComposeItem,
  setComposePortion,
  type ComposeItem,
} from "../lib/mealCompose";
import { templateCarbs } from "../lib/mealTemplates";
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

console.log(`mealCompose: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
