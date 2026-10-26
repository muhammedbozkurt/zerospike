/** G31: a shut Save/Add button says why (meal rows, estimate rows, carb-only
 *  range, custom reminder text).
 *  Run: npx -y tsx scripts/silentRejects.test.ts */
import { readFileSync } from "node:fs";
import { composeRowsBlockSave } from "../lib/mealCompose";
import { carbOnlyAmountError } from "../lib/mealRoute";

let failed = 0;
function eq(name: string, got: unknown, want: unknown): void {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failed++;
    console.log(`  x ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
}
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const food = (g: number) => ({ key: "k" + g, food_id: "f", name: "Rice", portion_g: g, carbs_g_fixed: null }) as never;
eq("no rows: no reason line", composeRowsBlockSave([]), false);
eq("0 g row blocks", composeRowsBlockSave([food(0)]), true);
eq("ok rows", composeRowsBlockSave([food(80)]), false);

eq("carb-only empty", carbOnlyAmountError("", null), false);
eq("carb-only 1500 ok", carbOnlyAmountError("1500", 1500), false);
eq("carb-only 1600", carbOnlyAmountError("1600", null), true);

const rem = src("components/ReminderEditSheet.tsx");
ok("reminder reason line", rem.includes("reminders.customNeedsName"));
const meal = src("components/MealComposeSheet.tsx");
ok("meal reason line", meal.includes("mealCompose.fixRows"));
const est = src("components/CarbEstimateSheet.tsx");
ok("estimate hints", est.includes("carbEstimate.unnamedLeftOut") && est.includes("carbEstimate.amountUnreadable"));
const co = src("components/CarbOnlyMealEdit.tsx");
ok("carb-only reason line", co.includes("carbOnlyAmountError"));

function ok(name: string, cond: boolean): void {
  if (!cond) {
    failed++;
    console.log(`  x ${name}`);
  }
}

if (failed) {
  console.log(`FAIL ${failed}`);
  process.exit(1);
}
console.log("silentRejects ok");
