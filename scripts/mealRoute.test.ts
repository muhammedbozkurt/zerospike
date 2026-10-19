/**
 * Which editor a saved meal opens in, and what the carb-only save writes:
 *
 *   npx tsx scripts/mealRoute.test.ts
 */
import { carbOnlyPatch, mealEditMode, mealEditRoute, parseCarbGrams } from "../lib/mealRoute";
import { mealPrefill } from "../lib/mealPrefill";

declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare const require: (id: string) => { readFileSync: (p: string, enc: string) => string };

let failed = 0;
function eq<T>(name: string, actual: T, expected: T): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failed++;
    console.log(`  FAIL ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

eq("estimate meal (no food, no weight, named) -> carbOnly", mealEditMode({ food_id: null, portion_g: 0, custom_food_name: "2 slices of bread" }), "carbOnly");
eq("same via display_name", mealEditMode({ food_id: null, portion_g: 0, display_name: "Toast" }), "carbOnly");
eq("catalogue food, no weight -> calculator", mealEditMode({ food_id: "f1", portion_g: 0, custom_food_name: null }), "calculator");
eq("catalogue food with weight -> calculator", mealEditMode({ food_id: "f1", portion_g: 150 }), "calculator");
eq("weighed custom food -> calculator", mealEditMode({ food_id: null, portion_g: 120, custom_food_name: "Soup" }), "calculator");
eq("template meal (weight from totals) -> calculator", mealEditMode({ food_id: null, portion_g: 340, custom_food_name: "Breakfast" }), "calculator");
eq("nameless row -> calculator", mealEditMode({ food_id: null, portion_g: 0, custom_food_name: "  " }), "calculator");
eq("journal placeholder name -> calculator", mealEditMode({ food_id: null, portion_g: 0, display_name: "-" }), "calculator");
eq("NaN weight counts as no weight", mealEditMode({ food_id: null, portion_g: NaN, custom_food_name: "x" }), "carbOnly");
eq("negative weight counts as no weight", mealEditMode({ food_id: null, portion_g: -4, custom_food_name: "x" }), "carbOnly");
eq("tiny positive weight is a weight", mealEditMode({ food_id: null, portion_g: 0.5, custom_food_name: "x" }), "calculator");
eq("empty food id string is no food", mealEditMode({ food_id: "", portion_g: 0, custom_food_name: "x" }), "carbOnly");

eq("route carries only the id", mealEditRoute({ id: "m1", food_id: null, portion_g: 0 }), { pathname: "/calculator", params: { mealLogId: "m1" } });

eq("carbs parse: valid", parseCarbGrams(43.14), 43.1);
eq("carbs parse: null", parseCarbGrams(null), null);
eq("carbs parse: negative", parseCarbGrams(-1), null);
eq("carbs parse: absurd", parseCarbGrams(5000), null);
eq("carbs parse: zero allowed", parseCarbGrams(0), 0);

const patch = carbOnlyPatch({ carbs: 43.1, name: " Toast ", note: "  ", loggedAtIso: null });
eq("save keeps weight 0", patch.portion_g, 0);
eq("save writes the edited carbs", patch.calculated_carbs_g, 43.1);
eq("save never writes a dose", Object.prototype.hasOwnProperty.call(patch, "insulin_dose_units"), false);
eq("save trims the name, blank note is null", [patch.custom_food_name, patch.personal_note], ["Toast", null]);
eq("untouched time is not written", Object.prototype.hasOwnProperty.call(patch, "logged_at"), false);
eq("moved time is written", carbOnlyPatch({ carbs: 1, name: "a", note: "n", loggedAtIso: "2026-01-01T10:00:00.000Z" }).logged_at, "2026-01-01T10:00:00.000Z");

eq("open and save keeps carbs and weight 0", [patch.calculated_carbs_g, patch.portion_g], [43.1, 0]);
eq("old calculator prefill would have invented 100 g", mealPrefill({ portion_g: 0, calculated_carbs_g: 43.1 }).portion_g, 100);

const fs = require("fs");
const screen = fs.readFileSync("components/CarbOnlyMealEdit.tsx", "utf8");
eq("carb-only screen has no dose arithmetic", /estimateInsulin|insulin_dose_units|logInjection|iob/i.test(screen), false);
const calc = fs.readFileSync("app/calculator.tsx", "utf8");
eq("calculator routes carbOnly meals away", /mode === "carbOnly"[\s\S]*<CarbOnlyMealEdit/.test(calc), true);
const rows = fs.readFileSync("components/useJournalRows.tsx", "utf8");
const food = fs.readFileSync("app/(tabs)/food.tsx", "utf8");
eq("both entry points use mealEditRoute", [/mealEditRoute\(entry\)/.test(rows), /mealEditRoute\(meal\)/.test(food)], [true, true]);
eq("no direct mealLogId push left", /params:\s*\{\s*mealLogId/.test(rows + food), false);

console.log(failed === 0 ? "mealRoute: all passed" : `mealRoute: ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
