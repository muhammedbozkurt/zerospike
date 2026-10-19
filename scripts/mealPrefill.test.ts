/**
 * Opening a saved meal (carb estimate rows have portion 0) must keep its carbs:
 *
 *   npx tsx scripts/mealPrefill.test.ts
 */
import { hasMealWeight, mealPrefill } from "../lib/mealPrefill";

declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

let failed = 0;
function eq<T>(name: string, actual: T, expected: T): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failed++;
    console.log(`  FAIL ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

// Open, change nothing but the time, save: est.carbs = carb_100g * portion / 100.
function resaved(log: { portion_g: number; calculated_carbs_g: number }): number {
  const p = mealPrefill(log);
  return (p.carb_100g * p.portion_g) / 100;
}

eq("estimate row (portion 0) keeps 43.1 g on open and save", resaved({ portion_g: 0, calculated_carbs_g: 43.1 }), 43.1);
eq("estimate row opens as 100 g", mealPrefill({ portion_g: 0, calculated_carbs_g: 43.1 }).portion_g, 100);
eq("weighed meal keeps its portion", mealPrefill({ portion_g: 150, calculated_carbs_g: 30 }).portion_g, 150);
eq("weighed meal reproduces its carbs", resaved({ portion_g: 150, calculated_carbs_g: 30 }), 30);
eq("negative or NaN portion is treated as no weight", [hasMealWeight(-5), hasMealWeight(NaN), hasMealWeight(0)], [false, false, false]);
eq("positive portion has weight", hasMealWeight(0.5), true);

console.log(failed === 0 ? "mealPrefill: all passed" : `mealPrefill: ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
