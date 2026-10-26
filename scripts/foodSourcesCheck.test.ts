/**
 * 2.5.0 source scan of mixed dishes and fibre-rich seeds (docs/food-sources.md,
 * "Karma yemek taramasi 2026-10-27"): pins the 100 g carbohydrate values the
 * scan settled on, so a later edit cannot quietly put the unsourced ones back.
 *
 * Run: npx -y tsx scripts/foodSourcesCheck.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (c: number) => void };

import { SEED_FOODS } from "../lib/db/seed";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  x ${name}${detail ? ": " + detail : ""}`);
  }
}

const carbOf = (en: string): number | undefined => {
  const rows = SEED_FOODS.filter((f) => f.en === en);
  return rows.length === 1 ? rows[0].carb : undefined;
};

/* Changed: the mean of the independent sources (USDA FNDDS, USDA Branded,
 * Open Food Facts, Matvaretabellen where it has the dish) sat more than 15 %
 * away from the old value. */
const changed: [string, number][] = [
  ["Jambalaya", 12],
  ["Tteokbokki", 21],
  ["Chilaquiles", 15],
  ["Shepherd's pie", 11],
  ["Gumbo", 7],
];

/* Kept: total carbohydrate by difference, because their fibre is under the
 * 25 g/100 g line above which the catalog switches to available carbohydrate
 * (Chia 34.4 g and Flaxseed 27.3 g fibre -> 8 and 2). USDA SR Legacy:
 * poppy 171330 = 28.13 (fibre 19.5), desiccated coconut 170170 = 23.65
 * (fibre 16.3), almonds 170567 = 21.55 (fibre 12.5). */
const kept: [string, number][] = [
  ["Poppy seeds", 28],
  ["Desiccated coconut", 24],
  ["Almond", 22],
  ["Chia seeds", 8],
  ["Flaxseed", 2],
];

for (const [en, want] of [...changed, ...kept]) {
  const got = carbOf(en);
  ok(`${en} carb ${want}`, got === want, `got ${got}`);
}

console.log(`foodSourcesCheck: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
